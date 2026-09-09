/**
 * task 082 — Real-Model Benchmark Lane tests.
 *
 * Covers: scenario-set validation (registry shape/tier/runnable), lane
 * execution with an injected mock provider, §15 L3 collection aggregation,
 * report emission, no-credential degradation (pending-environment, no throw),
 * and error handling (missing fixture / thrown resolver).
 *
 * NOTE (deletion铁律): tests keep temp dirs under os.tmpdir() — OS-managed
 * scratch — and never invoke permanent deletion.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { MockProvider } from '@vessel/llm';
import type { ChatProvider } from '@vessel/shared';
import { validateRunResult } from '../contracts/validate.js';
import { loadManifest, OFFLINE_SCRIPTS } from '../runner.js';
import {
  LANE_MODELS,
  LANE_SCENARIOS,
  runRealModelLane,
  probeModelApi,
  scenarioAppliesToModel,
  renderLaneMarkdown,
  type LaneModel,
  type LaneScenarioEntry,
} from './real-model-lane.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function mockResolver(provider: ChatProvider | null): () => Promise<ChatProvider | null> {
  return async () => provider;
}

function mockProvider(text = 'LANE-MOCK-ANSWER'): ChatProvider {
  return new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text } }], { model: 'mock-model' });
}

/** A small scenarios override that is quick and deterministic for execution tests. */
const EXEC_SET: LaneScenarioEntry[] = [
  { id: 'B001', tier: 'flash', runnable: true },
  { id: 'B002', tier: 'flash', runnable: false, note: 'skipped-by-design' },
];

describe('lane — scenario-set validation (§15.1 L2 固定 20-50 场景)', () => {
  it('exposes a fixed default registry (all existing assets + V1.1-D lanes) inside the 20-50 target', () => {
    const ids = LANE_SCENARIOS.map((s) => s.id);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids.length).toBeLessThanOrEqual(50);
    expect(ids.length).toBe(25);
    // unique ids
    expect(new Set(ids).size).toBe(ids.length);
    // known scenario ids (B001-B027 existing + safety S001-S008)
    for (const id of ids) expect(id).toMatch(/^(B\d{3}|S\d{3})$/);
    // V1.1-D capability lanes are present
    for (const id of ['B024', 'B025', 'B026', 'B027']) expect(ids).toContain(id);
  });

  it('every entry carries a valid tier and all runnable ones are executable L1 assets', () => {
    for (const s of LANE_SCENARIOS) {
      expect(['pro', 'flash', 'both']).toContain(s.tier);
      // runnable set only includes fixtures that exist as L1 assets
      if (s.runnable) {
        expect(fs.existsSync(path.join(REPO_ROOT, 'benchmarks', 'fixtures', s.id, 'task.md'))).toBe(true);
      }
    }
    const runnable = LANE_SCENARIOS.filter((s) => s.runnable);
    expect(runnable.length).toBe(13); // B001-B005 + S001-S008
  });

  it('documentation: every V1.1-D scenario manifest + fixture is registered and offline-drivable', () => {
    // V1.1-D lanes must be present in LANE_SCENARIOS (enumerated for the 20-50
    // set), carry a loadable manifest, a fixture with task.md, and an offline
    // mock script so the deterministic offline lane can drive them.
    for (const id of ['B024', 'B025', 'B026', 'B027']) {
      const entry = LANE_SCENARIOS.find((s) => s.id === id);
      expect(entry).toBeDefined();
      expect(entry!.runnable).toBe(false); // deterministic-mock feature lane
      const manifest = loadManifest(REPO_ROOT, id);
      expect(manifest.harness).toBeDefined(); // has a capability driver
      expect(fs.existsSync(path.join(REPO_ROOT, 'benchmarks', 'fixtures', id, 'task.md'))).toBe(true);
      expect(Array.isArray(OFFLINE_SCRIPTS[id])).toBe(true); // offline mock script drives it
    }
  });

  it('annotation: pro tier carries task-style scenarios + feature lanes; flash carries light/safety', () => {
    const proIds = LANE_SCENARIOS.filter((s) => s.tier === 'pro').map((s) => s.id);
    const flashIds = LANE_SCENARIOS.filter((s) => s.tier === 'flash').map((s) => s.id);
    expect(proIds).toContain('B003'); // implement
    expect(proIds).toContain('B004'); // refactor
    expect(proIds).toContain('B005'); // exec
    expect(flashIds).toContain('B001'); // read+answer
    expect(flashIds).toContain('S001'); // safety
    // V1.1-D lanes annotated
    expect(proIds).toContain('B024'); // streaming
    expect(flashIds).toContain('B026'); // steering
    // scenarios are feature lanes (runnable:false) — not driven on a real model
    for (const id of ['B024', 'B025', 'B026', 'B027']) {
      expect(LANE_SCENARIOS.find((s) => s.id === id)?.runnable).toBe(false);
    }
    // scenarioAppliesToModel gate
    const pro = LANE_MODELS[0]!;
    const flash = LANE_MODELS[1]!;
    expect(scenarioAppliesToModel(LANE_SCENARIOS.find((s) => s.id === 'B003')!, pro)).toBe(true);
    expect(scenarioAppliesToModel(LANE_SCENARIOS.find((s) => s.id === 'B003')!, flash)).toBe(false);
    expect(scenarioAppliesToModel(LANE_SCENARIOS.find((s) => s.id === 'S001')!, flash)).toBe(true);
  });

  it('models default to DeepSeek V4 Pro / Flash with distinct tiers', () => {
    expect(LANE_MODELS.map((m) => m.id)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
    expect(LANE_MODELS[0]!.tier).toBe('pro');
    expect(LANE_MODELS[1]!.tier).toBe('flash');
    expect(LANE_MODELS[0]!.displayName).toBe('DeepSeek V4 Pro');
  });
});

describe('lane — execution with injected mock provider (§15.1 L2/L3 采集)', () => {
  it('drives runnable scenarios through the 076 adapter and returns validated RunResult rows', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-reports-'));
    const report = await runRealModelLane({
      models: LANE_MODELS,
      scenarios: LANE_SCENARIOS,
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    // a flash tier model → runs flash runnable scenarios; pro tier model → pro runnable scenarios
    const flashRows = report.rows.filter((r) => r.modelId === 'deepseek-v4-flash' && r.status === 'passed');
    expect(flashRows.length).toBeGreaterThanOrEqual(1);
    // every executed row carries a 076-valid RunResult
    for (const r of report.rows) {
      if (r.status === 'passed') {
        expect(r.result).toBeDefined();
        expect(validateRunResult(r.result!)).toEqual([]);
        expect(r.result!.metrics.success).toBe(true);
      }
    }
    // non-runnable feature lanes are always skipped (never burn quota)
    const skipped = report.rows.filter((r) => r.status === 'skipped');
    expect(skipped.length).toBeGreaterThan(0);
    for (const r of skipped) expect(r.result).toBeUndefined();
    // no pending-environment & not degraded with a working mock provider
    expect(report.degraded).toBe(false);
    expect(report.rows.some((r) => r.status === 'pending-environment')).toBe(false);
    // scenario count registry-wide
    expect(report.scenarioCount).toBe(LANE_SCENARIOS.length);
  }, 120_000);

  it('collection aggregation: modelSummaries total §15 L3 across rows', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-reports-'));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!], // flash only for a fast deterministic run
      scenarios: [{ id: 'B001', tier: 'flash', runnable: true }],
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(report.modelSummaries).toHaveLength(1);
    const s = report.modelSummaries[0]!;
    expect(s.modelId).toBe('deepseek-v4-flash');
    expect(s.passed).toBe(1);
    const row = report.rows[0]!;
    expect(row.result).toBeDefined();
    // summary wallTime sums the row's wallTime (consistent accumulator)
    expect(s.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(s.costUsd).toBeGreaterThanOrEqual(0);
    expect(s.inputTokens).toBe(row.result!.metrics.inputTokens);
  }, 120_000);

  it('report: writes markdown + json into reportsDir and renders a model×scenario matrix', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-reports-'));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!],
      scenarios: EXEC_SET,
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(fs.existsSync(report.reportMdPath)).toBe(true);
    expect(fs.existsSync(report.reportJsonPath)).toBe(true);
    const md = fs.readFileSync(report.reportMdPath, 'utf8');
    expect(md).toContain(`# ${report.runId}`);
    expect(md).toContain('model | scenario | tier | status');
    expect(md).toContain('B001');
    expect(md).toContain('pending-environment');
    expect(md).toContain('skipped');
    // json round-trip carries all rows
    const parsed = JSON.parse(fs.readFileSync(report.reportJsonPath, 'utf8')) as {
      rows: unknown[];
      modelSummaries: unknown[];
    };
    expect(parsed.rows).toHaveLength(report.rows.length);
    expect(parsed.modelSummaries).toHaveLength(report.modelSummaries.length);
    // pure renderer is directly usable
    expect(renderLaneMarkdown(report)).toContain('DeepSeek V4 Flash');
  }, 120_000);
});

describe('lane — degradation & exceptions', () => {
  it('degrades to pending-environment for unresolvable providers without throwing', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-'));
    const report = await runRealModelLane({
      models: LANE_MODELS,
      scenarios: LANE_SCENARIOS,
      providerResolver: mockResolver(null), // no credentials / cannot resolve
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(report.degraded).toBe(true);
    const pending = report.rows.filter((r) => r.status === 'pending-environment');
    // every runnable, tier-applicable scenario is pending-environment; none ran
    expect(pending.length).toBeGreaterThan(0);
    expect(report.rows.some((r) => r.status === 'passed')).toBe(false);
    expect(report.rows.some((r) => r.result)).toBe(false);
  });

  it('probeModelApi reports availability per model and never throws', async () => {
    const avail = await probeModelApi(LANE_MODELS, mockResolver(mockProvider()));
    expect(avail['deepseek-v4-pro']).toBe(true);
    expect(avail['deepseek-v4-flash']).toBe(true);
    const none = await probeModelApi(LANE_MODELS, async () => null);
    expect(none['deepseek-v4-pro']).toBe(false);
    // throwing resolver is treated as unavailable, not an exception
    const thrown = await probeModelApi(
      LANE_MODELS,
      async () => {
        throw new Error('provider exploded');
      },
    );
    expect(thrown['deepseek-v4-flash']).toBe(false);
  });

  it('marks a missing-fixture scenario as failed and throws nothing', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-'));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!],
      scenarios: [{ id: 'B999', tier: 'flash', runnable: true }],
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    const row = report.rows[0]!;
    expect(row.status).toBe('failed');
    expect(row.note).toContain('fixture not found');
    expect(report.degraded).toBe(false);
  });

  it('scenario tier filtering skips non-applicable scenarios for a model', async () => {
    // a pro-only scenario set fed to a flash-only model → all skipped (not applicable)
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-'));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!], // flash
      scenarios: [{ id: 'B003', tier: 'pro', runnable: true }],
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    // B003 is pro-tier; the flash model has no applicable scenarios → zero rows
    expect(report.rows).toHaveLength(0);
    expect(report.modelSummaries[0]!.runnableScenarios).toBe(0);
  });
});