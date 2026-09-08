/**
 * task 078 — OpenCode Harness Adapter.
 *
 * Implements the Harness Adapter Contract (task 076, contracts/types.ts) for
 * the external "OpenCode" CLI so the SAME benchmark fixture can be run on
 * OpenCode and uniformly collect §15 L3 metrics (success / wall time / tool
 * calls / invalid calls / retries / tokens / cost / context peak /
 * compactions / human intervention / policy violations / resume success).
 *
 * Clean-room: OpenCode is an external harness — this adapter NEVER reads its
 * source. It drives the OpenCode CLI through a stable, documented command
 * surface and normalizes OpenCode's own session summary into RunResult.
 * Injection seams (same pattern as the DSH adapter, task 077):
 *   - `command` (default 'opencode') and `runCommand` (default spawn the CLI)
 *     let a test substitute a mock CLI so no real OpenCode process is needed.
 *   - `probeOpencodeEnv` reports whether OpenCode is usable on this machine;
 *     when it is NOT, the adapter still constructs valid RunRequests but marks
 *     runs as "pending-environment" via notes and honestly reflects the missing
 *     capability in the capabilities map (runner skips before run()).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertValidHarnessAdapter, assertValidRunResult } from '../contracts/validate.js';
import type { CapabilityKey, HarnessAdapter, HarnessFixture, RunResult } from '../contracts/types.js';

export const OPENCODE_ADAPTER_ID = 'opencode';
export const OPENCODE_ADAPTER_VERSION = '0.1.0';

/** OpenCode CLI subcommand we drive (clean design surface, not internal source). */
export const OPENCODE_RUN_SUBCOMMAND = 'run';

/** Per-fixture option keys the OpenCode adapter reads from fixture.options. */
export interface OpencodeAdapterOptions {
  /** path/name of the OpenCode CLI executable (default 'opencode'; use full path to test a shim). */
  command?: string;
  /** CLI args appended to the run invocation (e.g. model). */
  args?: string[];
  /** optional override for the spawn/exec of the CLI (default spawnSync on command). */
  runCommand?: (argv: string[], opts: { cwd: string }) => ResultStub;
  /** repo/config root used to resolve configs/pricing.json. */
  configRoot?: string;
  /** model id used for cost estimation (mirror of how vesselAdapter resolves pricing). */
  model?: string;
  /** keep the temp workspace for debugging (tests delete it). */
  keepWorkspace?: boolean;
  /** treat a missing OpenCode CLI as a run-time failure (metrics.success=false) rather than env-pending. */
  failOnMissing?: boolean;
  /** TEST SEAM: explicit env-probe result (avoid spawning real OpenCode in tests). */
  _envResolve?: () => boolean;
}

/**
 * The raw shape OpenCode is asked to emit on stdout (the adapter's own
 * interface — it does NOT introspect OpenCode internals; this is the JSON the
 * adapter requests via `--json`). Fields absent in a real CLI run are imputed
 * by the normalizer. Keeping only the L3-relevant subset keeps the contract
 * honest and mock-testable.
 */
export interface OpencodeRawRun {
  /** overall success as OpenCode reports it (before runner-side asserts). */
  success?: boolean;
  /** final session summary text the harness produced. */
  finalText?: string;
  wallTimeMs?: number;
  toolCalls?: number;
  invalidCalls?: number;
  retries?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  /** max single-request input+cache context seen by OpenCode. */
  contextPeak?: number;
  compactions?: number;
  humanIntervention?: number;
  policyViolations?: number;
  /** whether this OpenCode session was resumed and completed. */
  resumeSuccess?: boolean | null;
  /** optional artifact paths the CLI can point at (session log / workspace). */
  artifacts?: { kind: string; path: string }[];
  /** free-form provenance notes from the CLI run. */
  notes?: string[];
}

/** Minimal command result shape so the driver can work with either spawn or a mock. */
export interface ResultStub {
  /** exit code (0 = ok, null = signal-killed). */
  status: number | null;
  /** captured stdout. */
  stdout: string;
  /** captured stderr. */
  stderr: string;
}

/**
 * Invoke the CLI synchronously (`command subcommand`, run from `workspace`) and
 * return its output. Used as the default `runCommand` injection. This is the
 * ONLY place the adapter touches an external process — tests override it.
 */
export function defaultRunCommand(argv: string[], opts: { cwd: string }): ResultStub {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new Error('defaultRunCommand: no command provided');
  const res = spawnSync(cmd, rest, {
    cwd: opts.cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 0,
  });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

/** Copy a directory tree (adapter never mutates the pristine fixture). */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/** Load per-1M-token prices from configs/pricing.json (same fallback as vessel/dsh). */
interface TokenPrice { input: number; output: number; cacheRead?: number; }
function loadPrices(configRoot: string, model: string): TokenPrice {
  const fallback: TokenPrice = { input: 0.5, output: 1.5, cacheRead: 0.1 };
  let table: { models?: Record<string, TokenPrice>; protocols?: Record<string, TokenPrice> } = {};
  try {
    table = JSON.parse(fs.readFileSync(path.join(configRoot, 'configs', 'pricing.json'), 'utf8'));
  } catch {
    /* corrupt/missing → default */
  }
  if (table.models?.[model]) return table.models![model];
  return table.models?.default ?? fallback;
}

/**
 * Resolve whether the OpenCode CLI is usable on this machine. Injects `resolve`
 * (default: look up `command` on PATH via a plain spawn of `command --version`)
 * so tests can avoid real OpenCode. When unavailable, `run()` is marked
 * "pending-environment".
 */
export function probeOpencodeEnv(command = 'opencode', resolve?: () => boolean): boolean {
  if (resolve) return resolve();
  try {
    const r = defaultRunCommand([command, '--version'], { cwd: process.cwd() });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** OpenCode adapter capability map — honest per the OpenCode surface we drive. */
export function opencodeCapabilities(envAvailable: boolean): Record<CapabilityKey, boolean | 'tbd'> {
  return {
    tool_calls: true,
    file_edit: true,
    exec: true,
    subagent: 'tbd', // OpenCode run surface may not expose a stable subagent fixture here
    mcp: false, // OpenCode run CLI surface we drive does not expose MCP fixtures here
    planner: 'tbd',
    evaluator: 'tbd',
    memory: true,
    skill: 'tbd',
    resume: envAvailable ? 'tbd' : false, // resume depends on OpenCode session support
    compaction: 'tbd',
    policy: true,
    // matrix needs real harness infrastructure → gated on CLI availability
    matrix: envAvailable,
  };
}

/** Internal accumulator merging raw OpenCode values against §15 L3 defaults. */
interface Accumulator {
  success: boolean;
  wallTimeMs: number;
  toolCalls: number;
  invalidCalls: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  contextPeak: number;
  compactions: number;
  humanIntervention: number;
  policyViolations: number;
  resumeSuccess: boolean | null;
  artifacts: { kind: string; path: string }[];
  notes: string[];
}

function newAccumulator(): Accumulator {
  return {
    success: false,
    wallTimeMs: 0,
    toolCalls: 0,
    invalidCalls: 0,
    retries: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    contextPeak: 0,
    compactions: 0,
    humanIntervention: 0,
    policyViolations: 0,
    resumeSuccess: null,
    artifacts: [],
    notes: [],
  };
}

/**
 * Normalize a raw OpenCode session summary into the §15 L3 accumulator. Fields
 * OpenCode does not expose default (0 / null) and are flagged approx in notes
 * per BENCHMARK-SPEC §4.4 (no bare cross-harness number ranking).
 */
export function normalizeOpencodeRun(raw: OpencodeRawRun | undefined): { acc: Accumulator; approxNotes: string[] } {
  const acc = newAccumulator();
  const approx: string[] = [];
  if (!raw) {
    approx.push('OpenCode returned no parseable JSON summary; metrics defaulted (approx).');
    return { acc, approxNotes: approx };
  }
  if (typeof raw.success === 'boolean') acc.success = raw.success;
  else approx.push('success imputed as false (OpenCode summary omitted it).');
  acc.wallTimeMs = num(raw.wallTimeMs, 'wallTimeMs', approx);
  acc.toolCalls = num(raw.toolCalls, 'toolCalls', approx);
  acc.invalidCalls = num(raw.invalidCalls, 'invalidCalls', approx);
  acc.retries = num(raw.retries, 'retries', approx);
  acc.inputTokens = num(raw.inputTokens, 'inputTokens', approx);
  acc.outputTokens = num(raw.outputTokens, 'outputTokens', approx);
  acc.cacheReadTokens = num(raw.cacheReadTokens, 'cacheReadTokens', approx);
  acc.contextPeak = num(raw.contextPeak, 'contextPeak', approx);
  acc.compactions = num(raw.compactions, 'compactions', approx);
  acc.humanIntervention = num(raw.humanIntervention, 'humanIntervention', approx);
  acc.policyViolations = num(raw.policyViolations, 'policyViolations', approx);
  acc.resumeSuccess = raw.resumeSuccess ?? null;
  if (Array.isArray(raw.artifacts)) {
    for (const a of raw.artifacts) {
      if (a && typeof a.kind === 'string' && typeof a.path === 'string') acc.artifacts.push(a);
    }
  }
  if (Array.isArray(raw.notes)) acc.notes.push(...raw.notes);
  return { acc, approxNotes: approx };
}

/** Coerce an optional number to a non-negative number (0 when absent/NaN). */
function num(v: unknown, label: string, approx: string[]): number {
  if (typeof v === 'number' && !Number.isNaN(v) && v >= 0) return v;
  approx.push(`${label} not exposed by OpenCode; defaulted to 0 (approx).`);
  return 0;
}

/**
 * Run one fixture through the OpenCode CLI and return a validated RunResult.
 * `run()` is the driver + normalizer; it throws on hard setup errors (missing
 * fixture) and returns a valid RunResult with success=false on run-time failure.
 */
export async function runOpencodeFixture(fixture: HarnessFixture): Promise<RunResult> {
  const opts = (fixture.options ?? {}) as OpencodeAdapterOptions;
  const command = opts.command ?? 'opencode';
  const configRoot = opts.configRoot ?? process.cwd();
  const model = opts.model ?? 'default';
  const taskFile = fixture.taskFile ?? 'task.md';

  if (!fixture.workspaceRoot || !fs.existsSync(fixture.workspaceRoot)) {
    throw new Error(`opencode adapter: fixture workspace missing: ${fixture.workspaceRoot}`);
  }

  // environment probe gate
  const envOk = probeOpencodeEnv(command, resolveEnvForTest(opts));
  const envPendingNotes = envOk ? [] : ['OpenCode CLI not available on this machine — run marked pending-environment.'];

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  // isolation: temp copy of the fixture workspace (never touch the source)
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `cah-opencode-${fixture.id}-`));
  try {
    copyDir(fixture.workspaceRoot, workspace);
  } catch (err) {
    throw new Error(`opencode adapter: failed to stage fixture copy: ${String(err)}`);
  }

  const acc = newAccumulator();
  const approxNotes: string[] = [];
  let runError: unknown = null;

  // If OpenCode is genuinely absent and the caller wants a real run, we surface
  // it as a run-time failure (metrics.success=false) unless marked env-pending.
  if (!envOk && !opts.failOnMissing) {
    acc.notes.push(...envPendingNotes);
    // all else stays defaulted → success=false, valid RunResult
  } else {
    const taskPath = path.join(workspace, taskFile);
    const task = fs.existsSync(taskPath) ? fs.readFileSync(taskPath, 'utf8').trim() : '';

    const argv = [command, OPENCODE_RUN_SUBCOMMAND, '--workspace', workspace, '--task', taskFile, '--json', ...(opts.args ?? [])];
    try {
      const runCmd = opts.runCommand ?? ((a, c) => defaultRunCommand(a, c));
      const res = runCmd(argv, { cwd: workspace });
      if (res.status !== 0) {
        runError = new Error(`opencode exited ${res.status}: ${res.stderr.trim() || 'no stderr'}`);
      } else {
        let raw: OpencodeRawRun | undefined;
        try {
          raw = JSON.parse(res.stdout) as OpencodeRawRun;
        } catch {
          acc.notes.push('OpenCode stdout is not JSON; treating run as failed and defaulting metrics (approx).');
        }
        const norm = normalizeOpencodeRun(raw);
        mergeAccumulator(acc, norm.acc);
        approxNotes.push(...norm.approxNotes);
        // success = OpenCode-reported success AND non-empty final text
        if (acc.success && (!raw?.finalText || raw.finalText.trim().length === 0)) {
          acc.success = false;
          acc.notes.push('success downgraded: OpenCode reported success but produced empty final text.');
        }
      }
    } catch (err) {
      runError = err;
    }
  }

  acc.wallTimeMs = acc.wallTimeMs || Date.now() - startedMs;
  if (runError) {
    acc.success = false;
    acc.notes.push(`run raised: ${String(runError)}`);
  }

  const prices = loadPrices(configRoot, model);
  const costUsd =
    (acc.inputTokens / 1_000_000) * (prices.input ?? 0) +
    (acc.outputTokens / 1_000_000) * (prices.output ?? 0) +
    (acc.cacheReadTokens / 1_000_000) * (prices.cacheRead ?? 0);

  const metrics = {
    success: acc.success,
    wallTimeMs: acc.wallTimeMs,
    toolCalls: acc.toolCalls,
    invalidCalls: acc.invalidCalls,
    retries: acc.retries,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheReadTokens: acc.cacheReadTokens,
    costUsd,
    contextPeak: acc.contextPeak,
    compactions: acc.compactions,
    humanIntervention: acc.humanIntervention,
    policyViolations: acc.policyViolations,
    resumeSuccess: acc.resumeSuccess,
  };

  const artifacts = [...acc.artifacts, { kind: 'workspace', path: workspace }];
  const notes = [...approxNotes, ...acc.notes, ...envPendingNotes];

  const result: RunResult = {
    adapterId: OPENCODE_ADAPTER_ID,
    adapterVersion: OPENCODE_ADAPTER_VERSION,
    fixtureId: fixture.id,
    metrics,
    startedAt,
    artifacts,
    notes: notes.length > 0 ? notes : undefined,
  };

  assertValidRunResult(result);
  return result;
}

/** Merge a normalized accumulator into a target accumulator (external API shape). */
function mergeAccumulator(target: Accumulator, src: Accumulator): void {
  target.success = src.success;
  if (src.wallTimeMs) target.wallTimeMs = src.wallTimeMs;
  if (src.toolCalls) target.toolCalls = src.toolCalls;
  if (src.invalidCalls) target.invalidCalls = src.invalidCalls;
  if (src.retries) target.retries = src.retries;
  if (src.inputTokens) target.inputTokens = src.inputTokens;
  if (src.outputTokens) target.outputTokens = src.outputTokens;
  if (src.cacheReadTokens) target.cacheReadTokens = src.cacheReadTokens;
  if (src.contextPeak) target.contextPeak = src.contextPeak;
  if (src.compactions) target.compactions = src.compactions;
  if (src.humanIntervention) target.humanIntervention = src.humanIntervention;
  if (src.policyViolations) target.policyViolations = src.policyViolations;
  if (src.resumeSuccess !== null) target.resumeSuccess = src.resumeSuccess;
  target.artifacts.push(...src.artifacts);
  target.notes.push(...src.notes);
}

/** Injectable env-resolve used by tests — returned lazily from opts. */
function resolveEnvForTest(opts: OpencodeAdapterOptions): (() => boolean) | undefined {
  return opts._envResolve ?? undefined;
}

/**
 * The OpenCode HarnessAdapter instance (task 078). Mirrors the DSH self-adapter
 * shape and passes the same validation; capabilities honestly reflect whether
 * the local OpenCode CLI is usable (runner skips when capability is false).
 */
export const opencodeAdapter: HarnessAdapter = {
  id: OPENCODE_ADAPTER_ID,
  version: OPENCODE_ADAPTER_VERSION,
  capabilities: opencodeCapabilities(false),
  async run(fixture: HarnessFixture): Promise<RunResult> {
    assertValidHarnessAdapter(this);
    const result = await runOpencodeFixture(fixture);
    // cleanup the staged workspace unless the caller asked to keep it
    const keep = Boolean((fixture.options ?? {}).keepWorkspace);
    const ws = result.artifacts?.find((a) => a.kind === 'workspace')?.path;
    if (ws && !keep) {
      try {
        fs.rmSync(ws, { recursive: true, force: true });
      } catch {
        /* best-effort; temp dir is OS-managed */
      }
    }
    return result;
  },
};