import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import type { ChatProvider } from '@vessel/shared';
import { runScenario, loadManifest } from '../index.js';
import {
  vesselAdapter,
  runVesselFixture,
  VESSEL_ADAPTER_ID,
  VESSEL_ADAPTER_VERSION,
  vesselCapabilities,
} from './vessel.js';
import {
  assertValidRunResult,
  validateRunResult,
  validateRunResultMetrics,
  validateHarnessAdapter,
} from './validate.js';
import type { HarnessFixture, RunResult } from './types.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONFIG_DIR = path.join(REPO_ROOT, 'configs'); // policy/behavior/pricing live here
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-contracts-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

/** Build a self-contained fixture dir with a trivial task.md. */
function makeFixture(id: string, dedentTask: string): string {
  const dir = path.join(tmpRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.md'), dedentTask, 'utf8');
  return dir;
}

const MOCK_CHAT = new MockProvider(
  [{ when: /.*/, ifNoToolResult: true, response: { text: 'CONTRACTS-GOLDEN-ANSWER' } }],
  { model: 'mock-model' },
);

function validFixture(id = 'X001'): HarnessFixture {
  return {
    id,
    workspaceRoot: makeFixture(id, 'Return the answer.'),
    options: {
      provider: MOCK_CHAT,
      model: 'mock-model',
      configRoot: REPO_ROOT,
    },
  };
}

function validResultFields(): RunResult['metrics'] {
  return {
    success: true,
    wallTimeMs: 301,
    toolCalls: 2,
    invalidCalls: 0,
    retries: 1,
    inputTokens: 120,
    outputTokens: 40,
    cacheReadTokens: 10,
    costUsd: 0.001,
    contextPeak: 130,
    compactions: 0,
    humanIntervention: 0,
    policyViolations: 0,
    resumeSuccess: false,
  };
}

/** test helper — erase a typed object to permissively mutate it. */
function asRec<T>(m: T): Record<string, unknown> {
  return m as unknown as Record<string, unknown>;
}

describe('contracts/validate — RunResult validation', () => {
  it('accepts a fully-formed metrics record', () => {
    const issues = validateRunResultMetrics(validResultFields());
    expect(issues).toEqual([]);
  });

  it('rejects missing / wrong-typed / negative / NaN metric fields', () => {
    const base = validResultFields();
    const cases: Array<{ mutate: (m: RunResult['metrics']) => void; on: string }> = [
      { mutate: (m) => delete asRec(m).toolCalls, on: 'toolCalls missing' },
      { mutate: (m) => asRec(m).wallTimeMs = 'fast', on: 'wallTimeMs wrong type' },
      { mutate: (m) => asRec(m).retries = -1, on: 'retries negative' },
      { mutate: (m) => asRec(m).contextPeak = Number.NaN, on: 'contextPeak NaN' },
      { mutate: (m) => asRec(m).costUsd = -0.5, on: 'costUsd negative' },
      { mutate: (m) => asRec(m).success = 'yes', on: 'success non-boolean' },
      { mutate: (m) => asRec(m).resumeSuccess = 'yep', on: 'resumeSuccess invalid' },
    ];
    for (const c of cases) {
      const m = validResultFields();
      c.mutate(m);
      const issues = validateRunResultMetrics(m);
      expect(issues.length, c.on).toBeGreaterThan(0);
    }
  });

  it('rejects a full RunResult with bad adapter/timestamp/artifacts', () => {
    const r: RunResult = {
      adapterId: 'vessel',
      adapterVersion: '0.0.0',
      fixtureId: 'X0',
      metrics: validResultFields(),
      startedAt: 'not-a-date',
      artifacts: [{ kind: 'session', path: '' }, { kind: 'bogus' } as never],
    };
    const issues = validateRunResult(r);
    expect(issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['startedAt', 'artifacts[]']),
    );
  });

  it('assertValidRunResult throws on invalid result, passes on valid', () => {
    expect(() => {
      const bad = validResultFields();
      asRec(bad).inputTokens = -3;
      assertValidRunResult({ adapterId: 'vessel', adapterVersion: '0', fixtureId: 'x', metrics: bad, startedAt: new Date().toISOString() });
    }).toThrow(/invalid RunResult/);
    expect(() =>
      assertValidRunResult({
        adapterId: 'vessel', adapterVersion: '0', fixtureId: 'x',
        metrics: validResultFields(), startedAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it('validateHarnessAdapter rejects a broken adapter surface', () => {
    const ok = validateHarnessAdapter(vesselAdapter);
    expect(ok).toEqual([]);
    const broken = validateHarnessAdapter({
      id: 'x', version: '', run: 42,
    } as unknown as typeof vesselAdapter);
    expect(broken.length).toBeGreaterThan(0);
  });
});

describe('contracts/vessel — Vessel self-adapter run', () => {
  it('produces a valid RunResult with all §15 L3 metrics via runVesselFixture', async () => {
    const result = await runVesselFixture(validFixture());
    expect(validateRunResult(result)).toEqual([]);
    expect(result.metrics.success).toBe(true);
    expect(result.adapterId).toBe(VESSEL_ADAPTER_ID);
    expect(result.adapterVersion).toBe(VESSEL_ADAPTER_VERSION);
    expect(result.metrics.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.toolCalls).toBeGreaterThanOrEqual(0);
    expect(validateRunResultMetrics(result.metrics)).toEqual([]);
    // all §15 L3 fields present
    for (const key of [
      'success', 'wallTimeMs', 'toolCalls', 'invalidCalls', 'retries',
      'inputTokens', 'outputTokens', 'cacheReadTokens', 'costUsd',
      'contextPeak', 'compactions', 'humanIntervention', 'policyViolations', 'resumeSuccess',
    ]) {
      expect(result.metrics).toHaveProperty(key);
    }
  }, 60_000);

  it('adapter.run cleans up its temp workspace by default', async () => {
    const fixture = validFixture('X002');
    const result = await vesselAdapter.run(fixture);
    const ws = result.artifacts?.find((a) => a.kind === 'workspace')?.path;
    expect(ws).toBeDefined();
    expect(fs.existsSync(ws!)).toBe(false); // cleaned by adapter.run
  }, 60_000);

  it('reports metrics.success=false on a fixture whose run errored (does not throw)', async () => {
    // a provider that throws on the first model call → harness.loop throws
    const dir = makeFixture('XBAD', 'Do something impossible.');
    const throwing: ChatProvider = {
      id: 'throwing',
      async chat() {
        throw new Error('provider exploded');
      },
    };
    const result = await vesselAdapter.run({
      id: 'XBAD',
      workspaceRoot: dir,
      options: { provider: throwing, model: 'mock-model', configRoot: REPO_ROOT },
    });
    expect(result.metrics.success).toBe(false);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(result.notes?.join('')).toContain('provider exploded');
    // the RunResult is still contract-valid so the runner can aggregate it
    expect(validateRunResult(result)).toEqual([]);
  }, 60_000);

  it('capabilities declare the engine surface (tool_calls/exec/policy/subagent...)', () => {
    const caps = vesselCapabilities();
    expect(caps.matrix).toBe(true);
    expect(caps.policy).toBe(true);
    expect(caps.resume).toBe(false);
    expect(caps.file_edit).toBe(true);
  });
});

describe('contracts — coexistence with the existing runner', () => {
  it('loads an existing L1 manifest alongside the contracts exports', async () => {
    const manifest = loadManifest(REPO_ROOT, 'B001');
    expect(manifest.id).toBe('B001');
    expect(vesselAdapter.id).toBe('vessel'); // both surfaces import cleanly
  });

  it('runScenario (existing runner) still passes B001 offline — no regression', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-contract-reports-'));
    try {
      const report = await runScenario({
        scenarioId: 'B001',
        repoRoot: REPO_ROOT,
        reportsDir: reports,
        provider: null,
        model: 'mock-model',
        policyPath: path.join(CONFIG_DIR, 'policy.default.yaml'),
        behaviorIRPath: path.join(CONFIG_DIR, 'behavior.default.yaml'),
      });
      expect(report.success).toBe(true);
      expect(report.metrics.M01).toBe(1);
    } finally {
      fs.rmSync(reports, { recursive: true, force: true });
    }
  }, 60_000);
});