/**
 * Cross-Harness Conformance driver (V1.5 proof, the repo's declared differentiator).
 *
 * The 076 contract gives every harness the same `HarnessAdapter.run(fixture) ->
 * RunResult` surface and 077-081 ship the adapters; 083 already aggregates
 * `RunResult[]` into a report. What was missing was the piece in between: a
 * driver that runs the SAME fixtures across several harnesses, honours each
 * adapter's declared capabilities (skip, never fake a failure), and hands the
 * collected results to the 083 report.
 *
 * This module is pure: it only depends on the contract types, so it is testable
 * with a stub adapter and no external CLI. Running the real harnesses is the
 * caller's job (see `run-conformance.ts`).
 */
import type { CapabilityKey, HarnessAdapter, HarnessFixture, RunResult } from '../contracts/types.js';

export type ConformanceCellStatus = 'run' | 'skipped' | 'error';

/** One fixture × adapter cell. `skipped`/`error` are distinct on purpose: a
 *  missing capability is not a failure, a harness crash is not a skip. */
export interface ConformanceCell {
  adapterId: string;
  fixtureId: string;
  status: ConformanceCellStatus;
  /** present iff status === 'run'. */
  result?: RunResult;
  /** why a cell was skipped (capability mismatch or caller gate). */
  skipReason?: string;
  /** adapter threw (hard setup error); the runner never swallows it. */
  error?: string;
}

export interface RunConformanceOptions {
  adapters: HarnessAdapter[];
  fixtures: HarnessFixture[];
  /** Extra gate after the capability check. Return {run:false} to skip a cell. */
  gate?: (adapter: HarnessAdapter, fixture: HarnessFixture) => { run: boolean; reason?: string };
  /** Called once per cell as it completes (for a progress line). */
  onCell?: (cell: ConformanceCell) => void;
}

/**
 * A fixture may declare `options.requires: CapabilityKey`. If the adapter does
 * not declare that capability `true`, the cell is skipped with a reason instead
 * of being run and scored as a failure — the honest way to compare harnesses of
 * different shapes.
 */
export function capabilitySkipReason(adapter: HarnessAdapter, fixture: HarnessFixture): string | undefined {
  const requires = (fixture.options as { requires?: CapabilityKey } | undefined)?.requires;
  if (requires === undefined) return undefined;
  const declared = adapter.capabilities?.[requires];
  if (declared === true) return undefined;
  return `capability "${requires}" is ${declared === false ? 'unsupported' : 'not declared'} by ${adapter.id}`;
}

/**
 * Run every fixture through every adapter. Never throws for a single cell: a
 * per-cell adapter failure becomes `status:'error'` so one broken harness cannot
 * abort the whole conformance run.
 */
export async function runConformance(opts: RunConformanceOptions): Promise<ConformanceCell[]> {
  const cells: ConformanceCell[] = [];
  for (const fixture of opts.fixtures) {
    for (const adapter of opts.adapters) {
      const capabilityReason = capabilitySkipReason(adapter, fixture);
      const gate = capabilityReason !== undefined
        ? { run: false, reason: capabilityReason }
        : (opts.gate?.(adapter, fixture) ?? { run: true });
      if (!gate.run) {
        const cell: ConformanceCell = {
          adapterId: adapter.id,
          fixtureId: fixture.id,
          status: 'skipped',
          skipReason: gate.reason ?? 'skipped',
        };
        cells.push(cell);
        opts.onCell?.(cell);
        continue;
      }
      try {
        const result = await adapter.run(fixture);
        const cell: ConformanceCell = { adapterId: adapter.id, fixtureId: fixture.id, status: 'run', result };
        cells.push(cell);
        opts.onCell?.(cell);
      } catch (err) {
        const cell: ConformanceCell = {
          adapterId: adapter.id,
          fixtureId: fixture.id,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        };
        cells.push(cell);
        opts.onCell?.(cell);
      }
    }
  }
  return cells;
}

/** Only the results of cells that actually ran, for the 083 report. */
export function resultsFromCells(cells: ConformanceCell[]): RunResult[] {
  return cells
    .filter((c): c is ConformanceCell & { result: RunResult } => c.status === 'run' && c.result !== undefined)
    .map((c) => c.result);
}

export interface ConformanceCellSummary {
  total: number;
  run: number;
  skipped: number;
  error: number;
}

export function summarizeCells(cells: ConformanceCell[]): ConformanceCellSummary {
  const s: ConformanceCellSummary = { total: cells.length, run: 0, skipped: 0, error: 0 };
  for (const c of cells) s[c.status] += 1;
  return s;
}

/** A regression threshold, checked against the collected cells. */
export interface ConformanceThresholds {
  /** max allowed invalidCalls per adapter, keyed by adapterId ('*' = default). */
  maxInvalidCalls?: Record<string, number>;
  /** max allowed policyViolations per adapter, keyed by adapterId ('*' = default). */
  maxPolicyViolations?: Record<string, number>;
  /** minimum success rate per adapter in [0,1], keyed by adapterId ('*' = default). */
  minSuccessRate?: Record<string, number>;
}

export interface ThresholdViolation {
  adapterId: string;
  rule: 'maxInvalidCalls' | 'maxPolicyViolations' | 'minSuccessRate';
  actual: number;
  limit: number;
}

function pick(map: Record<string, number> | undefined, adapterId: string): number | undefined {
  if (map === undefined) return undefined;
  return map[adapterId] ?? map['*'];
}

/**
 * Check per-adapter regression thresholds over the run cells. Only cells that
 * ran count; skipped/errored cells are reported by `summarizeCells` instead.
 * `maxInvalidCalls`/`maxPolicyViolations` are summed over the adapter's runs;
 * `minSuccessRate` is over its runs.
 */
export function checkThresholds(cells: ConformanceCell[], t: ConformanceThresholds): ThresholdViolation[] {
  const byAdapter = new Map<string, RunResult[]>();
  for (const r of resultsFromCells(cells)) {
    const list = byAdapter.get(r.adapterId) ?? [];
    list.push(r);
    byAdapter.set(r.adapterId, list);
  }
  const violations: ThresholdViolation[] = [];
  for (const [adapterId, results] of byAdapter) {
    const invalidLimit = pick(t.maxInvalidCalls, adapterId);
    if (invalidLimit !== undefined) {
      const actual = results.reduce((n, r) => n + r.metrics.invalidCalls, 0);
      if (actual > invalidLimit) violations.push({ adapterId, rule: 'maxInvalidCalls', actual, limit: invalidLimit });
    }
    const violationLimit = pick(t.maxPolicyViolations, adapterId);
    if (violationLimit !== undefined) {
      const actual = results.reduce((n, r) => n + r.metrics.policyViolations, 0);
      if (actual > violationLimit) violations.push({ adapterId, rule: 'maxPolicyViolations', actual, limit: violationLimit });
    }
    const minRate = pick(t.minSuccessRate, adapterId);
    if (minRate !== undefined) {
      const actual = results.filter((r) => r.metrics.success).length / results.length;
      if (actual < minRate) violations.push({ adapterId, rule: 'minSuccessRate', actual, limit: minRate });
    }
  }
  return violations;
}
