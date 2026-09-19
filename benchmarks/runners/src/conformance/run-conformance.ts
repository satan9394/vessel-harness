/**
 * Cross-Harness Conformance — runnable entry (V1.5 proof).
 *
 * Runs the shared benchmark fixtures across the available harness adapters and
 * writes a conformance report (JSON + markdown) via the 083 report module.
 *
 * Offline by default: only the Vessel self-adapter runs, deterministically on
 * the scripted mock, so this is safe in CI and consumes no third-party quota.
 * `--live` additionally includes the external harness adapters (dsh / opencode /
 * codex / claude-code / pi) whose CLI probe passes — that DOES drive real
 * harnesses and can consume their quota, so it is opt-in.
 *
 * Usage:
 *   tsx benchmarks/runners/src/conformance/run-conformance.ts [--all | --scenarios B001,B002] [--live] [--out <dir>]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HarnessAdapter, HarnessFixture } from '../contracts/types.js';
import { vesselAdapter, VESSEL_ADAPTER_ID } from '../contracts/vessel.js';
import { dshAdapter, probeDshEnv } from '../adapters/dsh.js';
import { opencodeAdapter, probeOpencodeEnv } from '../adapters/opencode.js';
import { codexAdapter, probeCodexEnv } from '../adapters/codex.js';
import { claudeAdapter, probeClaudeEnv } from '../adapters/claude.js';
import { piAdapter, probePiEnv } from '../adapters/pi.js';
import { buildReportFromRunResults, writeReportFiles, renderCliSummary } from '../report/report.js';
import { runConformance, resultsFromCells, summarizeCells, checkThresholds, type ConformanceThresholds } from './driver.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCENARIOS_DIR = path.join(REPO_ROOT, 'benchmarks', 'scenarios');
const FIXTURES_DIR = path.join(REPO_ROOT, 'benchmarks', 'fixtures');
const DEFAULT_OUT = path.join(REPO_ROOT, 'benchmarks', 'reports', 'conformance');

interface Args {
  all: boolean;
  scenarios: string[];
  live: boolean;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { all: false, scenarios: [], live: false, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--all') args.all = true;
    else if (a === '--live') args.live = true;
    else if (a === '--scenarios') args.scenarios = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') args.out = path.resolve(argv[++i] ?? DEFAULT_OUT);
  }
  return args;
}

/** Every scenario id that has both a manifest and a fixture directory. */
function availableScenarioIds(): string[] {
  if (!fs.existsSync(SCENARIOS_DIR)) return [];
  return fs
    .readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .filter((id) => fs.existsSync(path.join(FIXTURES_DIR, id)))
    .sort();
}

function fixtureFor(id: string): HarnessFixture {
  return {
    id,
    workspaceRoot: path.join(FIXTURES_DIR, id),
    taskFile: 'task.md',
    options: { configRoot: REPO_ROOT, model: 'mock-model' },
  };
}

/** Adapters available for this run. External ones only with --live AND a passing probe. */
function selectAdapters(live: boolean): HarnessAdapter[] {
  const adapters: HarnessAdapter[] = [vesselAdapter];
  if (!live) return adapters;
  const external: Array<[string, HarnessAdapter, () => boolean]> = [
    ['dsh', dshAdapter, probeDshEnv],
    ['opencode', opencodeAdapter, probeOpencodeEnv],
    ['codex', codexAdapter, probeCodexEnv],
    ['claude-code', claudeAdapter, probeClaudeEnv],
    ['pi', piAdapter, probePiEnv],
  ];
  for (const [name, adapter, probe] of external) {
    let ok = false;
    try {
      ok = probe();
    } catch {
      ok = false;
    }
    if (ok) adapters.push(adapter);
    else console.error(`[conformance] skip external harness "${name}": CLI not usable on this machine`);
  }
  return adapters;
}

/**
 * A minimal, conservative regression gate. Invalid tool calls should never
 * happen, so that is the one default. Policy violations are deliberately NOT
 * gated here: the safety scenarios (S00x) exist to provoke a denial, so >0 is
 * the correct outcome for them and the per-scenario `pass` criteria already
 * check it. Tighten per-adapter limits once a cross-harness baseline is recorded.
 */
const THRESHOLDS: ConformanceThresholds = {
  maxInvalidCalls: { '*': 0 },
};

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const ids = args.all ? availableScenarioIds() : args.scenarios.length > 0 ? args.scenarios : availableScenarioIds();
  if (ids.length === 0) {
    console.error('[conformance] no scenarios selected (use --all or --scenarios <ids>)');
    return 2;
  }
  const missing = ids.filter((id) => !fs.existsSync(path.join(FIXTURES_DIR, id)));
  if (missing.length > 0) {
    console.error(`[conformance] scenarios without a fixture dir: ${missing.join(', ')}`);
    return 2;
  }

  const adapters = selectAdapters(args.live);
  const fixtures = ids.map(fixtureFor);
  console.error(
    `[conformance] ${fixtures.length} fixtures × ${adapters.length} adapters ` +
      `(${adapters.map((a) => a.id).join(', ')})${args.live ? ' [live]' : ' [offline]'}`,
  );

  const cells = await runConformance({
    adapters,
    fixtures,
    onCell: (c) => {
      const detail = c.status === 'run' ? (c.result!.metrics.success ? 'ok' : 'fail') : (c.skipReason ?? c.error ?? '');
      console.error(`  ${c.adapterId} × ${c.fixtureId}: ${c.status}${detail ? ` (${detail})` : ''}`);
    },
  });

  const summary = summarizeCells(cells);
  const results = resultsFromCells(cells);
  const report = buildReportFromRunResults(results, {
    source: `cross-harness conformance (${args.live ? 'live' : 'offline'})`,
    modelsByAdapter: Object.fromEntries(adapters.map((a) => [a.id, a.id === VESSEL_ADAPTER_ID ? 'mock-model' : 'harness-default'])),
  });
  const { mdPath, jsonPath } = writeReportFiles(report, args.out);
  const violations = checkThresholds(cells, THRESHOLDS);

  console.log(renderCliSummary(report));
  console.error(`[conformance] cells: ${summary.run} run / ${summary.skipped} skipped / ${summary.error} error (of ${summary.total})`);
  console.error(`[conformance] report: ${mdPath}`);
  console.error(`[conformance] report: ${jsonPath}`);
  if (violations.length > 0) {
    for (const v of violations) console.error(`[conformance] THRESHOLD ${v.adapterId} ${v.rule}: actual=${v.actual} limit=${v.limit}`);
    return 1;
  }
  if (summary.error > 0) return 1;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`[conformance] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
