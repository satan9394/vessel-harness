import { describe, it, expect } from 'vitest';
import {
  runConformance,
  capabilitySkipReason,
  resultsFromCells,
  summarizeCells,
  checkThresholds,
  type ConformanceCell,
} from './driver.js';
import type { CapabilityKey, HarnessAdapter, HarnessFixture, RunResult, RunResultMetrics } from '../contracts/types.js';

function metrics(overrides: Partial<RunResultMetrics> = {}): RunResultMetrics {
  return {
    success: true,
    wallTimeMs: 10,
    toolCalls: 1,
    invalidCalls: 0,
    retries: 0,
    inputTokens: 5,
    outputTokens: 5,
    cacheReadTokens: 0,
    costUsd: 0,
    contextPeak: 10,
    compactions: 0,
    humanIntervention: 0,
    policyViolations: 0,
    resumeSuccess: null,
    ...overrides,
  };
}

function result(adapterId: string, fixtureId: string, m: Partial<RunResultMetrics> = {}): RunResult {
  return {
    adapterId,
    adapterVersion: 'test',
    fixtureId,
    metrics: metrics(m),
    startedAt: '2026-09-18T00:00:00.000Z',
  };
}

function fixture(id: string, requires?: CapabilityKey): HarnessFixture {
  return { id, workspaceRoot: `/tmp/${id}`, ...(requires ? { options: { requires } } : {}) };
}

function adapter(
  id: string,
  opts: { caps?: Partial<Record<CapabilityKey, boolean | 'tbd'>>; run?: (f: HarnessFixture) => Promise<RunResult> } = {},
): HarnessAdapter {
  const capabilities = Object.fromEntries(
    (['tool_calls', 'file_edit', 'exec', 'subagent', 'mcp', 'planner', 'evaluator', 'memory', 'skill', 'resume', 'compaction', 'policy', 'matrix'] as CapabilityKey[]).map(
      (k) => [k, opts.caps?.[k] ?? true],
    ),
  ) as Record<CapabilityKey, boolean | 'tbd'>;
  return {
    id,
    version: 'test',
    capabilities,
    run: opts.run ?? (async (f) => result(id, f.id)),
  };
}

describe('conformance/driver — cells', () => {
  it('runs every fixture × adapter cell and collects the results', async () => {
    const cells = await runConformance({
      adapters: [adapter('a'), adapter('b')],
      fixtures: [fixture('F1'), fixture('F2')],
    });
    expect(cells).toHaveLength(4);
    expect(cells.every((c) => c.status === 'run')).toBe(true);
    expect(resultsFromCells(cells)).toHaveLength(4);
    expect(summarizeCells(cells)).toEqual({ total: 4, run: 4, skipped: 0, error: 0 });
  });

  it('skips (never fails) a cell whose fixture requires a capability the adapter lacks', async () => {
    const cells = await runConformance({
      adapters: [adapter('with-mcp', { caps: { mcp: true } }), adapter('no-mcp', { caps: { mcp: false } })],
      fixtures: [fixture('F-mcp', 'mcp')],
    });
    const skipped = cells.filter((c) => c.status === 'skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.adapterId).toBe('no-mcp');
    expect(skipped[0]!.skipReason).toContain('mcp');
    // the capable adapter still ran
    expect(cells.find((c) => c.adapterId === 'with-mcp')!.status).toBe('run');
    // capabilitySkipReason is honest about 'tbd' too
    expect(capabilitySkipReason(adapter('tbd', { caps: { mcp: 'tbd' } }), fixture('F', 'mcp'))).toContain('not declared');
    expect(capabilitySkipReason(adapter('has', { caps: { mcp: true } }), fixture('F', 'mcp'))).toBeUndefined();
  });

  it('turns a per-cell adapter throw into status=error without aborting the other cells', async () => {
    const boom = adapter('boom', {
      run: async () => {
        throw new Error('harness crashed');
      },
    });
    const cells = await runConformance({
      adapters: [boom, adapter('ok')],
      fixtures: [fixture('F1'), fixture('F2')],
    });
    const errors = cells.filter((c) => c.status === 'error');
    expect(errors).toHaveLength(2);
    expect(errors[0]!.error).toBe('harness crashed');
    // the healthy adapter still ran both fixtures
    expect(cells.filter((c) => c.adapterId === 'ok' && c.status === 'run')).toHaveLength(2);
    expect(summarizeCells(cells)).toEqual({ total: 4, run: 2, skipped: 0, error: 2 });
    expect(resultsFromCells(cells)).toHaveLength(2);
  });

  it('honours a caller gate', async () => {
    const cells = await runConformance({
      adapters: [adapter('a')],
      fixtures: [fixture('F1'), fixture('F2')],
      gate: (_a, f) => (f.id === 'F2' ? { run: false, reason: 'not this one' } : { run: true }),
    });
    expect(cells.find((c) => c.fixtureId === 'F2')!.status).toBe('skipped');
    expect(cells.find((c) => c.fixtureId === 'F2')!.skipReason).toBe('not this one');
  });
});

describe('conformance/driver — thresholds', () => {
  const cell = (adapterId: string, m: Partial<RunResultMetrics>): ConformanceCell => ({
    adapterId,
    fixtureId: 'F',
    status: 'run',
    result: result(adapterId, 'F', m),
  });

  it('passes when every adapter is within its limits', () => {
    const cells = [cell('a', { invalidCalls: 0, policyViolations: 0, success: true })];
    expect(checkThresholds(cells, { maxInvalidCalls: { a: 1 }, maxPolicyViolations: { a: 0 }, minSuccessRate: { a: 1 } })).toEqual([]);
  });

  it('flags each rule with the actual vs limit, and applies the "*" default', () => {
    const cells = [
      cell('a', { invalidCalls: 3, policyViolations: 2, success: false }),
      cell('a', { invalidCalls: 0, policyViolations: 0, success: false }),
    ];
    const violations = checkThresholds(cells, {
      maxInvalidCalls: { '*': 1 },
      maxPolicyViolations: { '*': 1 },
      minSuccessRate: { '*': 0.75 },
    });
    expect(violations).toEqual(
      expect.arrayContaining([
        { adapterId: 'a', rule: 'maxInvalidCalls', actual: 3, limit: 1 },
        { adapterId: 'a', rule: 'maxPolicyViolations', actual: 2, limit: 1 },
        { adapterId: 'a', rule: 'minSuccessRate', actual: 0, limit: 0.75 },
      ]),
    );
    expect(violations).toHaveLength(3);
  });

  it('ignores skipped/errored cells when computing success rate', () => {
    const cells: ConformanceCell[] = [
      cell('a', { success: true }),
      { adapterId: 'a', fixtureId: 'F2', status: 'skipped', skipReason: 'x' },
      { adapterId: 'a', fixtureId: 'F3', status: 'error', error: 'x' },
    ];
    // 1 run, 1 success -> rate 1.0
    expect(checkThresholds(cells, { minSuccessRate: { a: 1 } })).toEqual([]);
  });
});
