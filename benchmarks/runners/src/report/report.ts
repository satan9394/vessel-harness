/**
 * task 083 — Report / Dashboard (Benchmark report aggregation & dashboard view).
 *
 * Aggregates a set of 076 RunResult (multi-harness × multi-model × multi-scenario
 * §15 L3 metric rows) into a readable BenchmarkReport: per-harness + per-scenario
 * summaries, cross-harness comparison tables (same scenario, different harnesses'
 * L3 metrics side by side), and overall totals. Produces both markdown (human,
 * benchmarks/reports/ convention cf. SOAK-068.md) and a machine-readable JSON
 * shape for task 084 (release gates) to consume.
 *
 * Reuse discipline (task card): this module REUSES the 076 RunResultMetrics /
 * RunResult contract (`contracts/types.ts`) and the 082 lane report shape
 * (`lane/real-model-lane.ts`); it does NOT reinvent metric fields or lane rows.
 * From a `RunResult` we take harness = adapterId, scenario = fixtureId, and all
 * §15 L3 metrics verbatim. When the caller knows the model a row was run under
 * (e.g. the 082 lane carries per-row modelId), we accept it as an optional
 * `modelId` label via rowFromRunResult / rowsFromLaneReport.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunResult, RunResultMetrics } from '../contracts/types.js';
import type { RealModelLaneReport } from '../lane/real-model-lane.js';

/** Row status — derived from metrics.success unless the caller overrides. */
export type ReportRowStatus = 'passed' | 'failed' | 'skipped' | 'pending';

/**
 * One reportable benchmark run row. This is the smallest unit the aggregator
 * consumes: a (harness × model? × scenario) tuple carrying a full §15 L3
 * metrics block. `modelId` is optional because a bare 076 RunResult does not
 * carry a model label; the 082 lane report does, so its rows become rows with
 * modelId filled in.
 */
export interface ReportRow {
  /** which harness produced the run (076 RunResult.adapterId). */
  harnessId: string;
  /** adapter package/version (076 RunResult.adapterVersion). */
  harnessVersion?: string;
  /** optional model dimension (e.g. 082 lane modelId), for model-level compare. */
  modelId?: string;
  /** which fixture/scenario the run belongs to (076 RunResult.fixtureId). */
  scenarioId: string;
  /** §15 L3 metrics, verbatim from the 076 contract. */
  metrics: RunResultMetrics;
  /** ISO timestamp of run start, when known. */
  startedAt?: string;
  /** finished/derived status. */
  status: ReportRowStatus;
  /** provenance / degrade notes. */
  notes?: string[];
}

/** Convert one 076 RunResult into a ReportRow. */
export function rowFromRunResult(result: RunResult, opts: { modelId?: string } = {}): ReportRow {
  return {
    harnessId: result.adapterId,
    harnessVersion: result.adapterVersion,
    modelId: opts.modelId,
    scenarioId: result.fixtureId,
    metrics: result.metrics,
    startedAt: result.startedAt,
    status: result.metrics.success ? 'passed' : 'failed',
    notes: result.notes,
  };
}

/**
 * Convert a 082 RealModelLaneReport's run rows into ReportRows. Only rows that
 * actually produced a 076 RunResult (`result` present) are carried; pending /
 * skipped rows are dropped from the metric aggregation (they carry no metrics).
 * harnessId is fixed to the Vessel self-adapter used by the lane.
 */
export function rowsFromLaneReport(rep: RealModelLaneReport, harnessId = 'vessel'): ReportRow[] {
  const out: ReportRow[] = [];
  for (const r of rep.rows) {
    if (!r.result) continue;
    out.push(rowFromRunResult(r.result, { modelId: r.modelId }));
    out[out.length - 1]!.harnessId = harnessId;
  }
  return out;
}

/** Per-harness aggregate over the §15 L3 surface (mirrors 082 LaneModelSummary shape). */
export interface HarnessSummary {
  harnessId: string;
  runs: number;
  passed: number;
  failed: number;
  skipped: number;
  pending: number;
  /** passed / runs (0..1); 0 when no runs. */
  successRate: number;
  avgWallTimeMs: number;
  avgToolCalls: number;
  avgInvalidCalls: number;
  avgRetries: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCacheReadTokens: number;
  avgCostUsd: number;
  avgContextPeak: number;
  avgCompactions: number;
  avgHumanIntervention: number;
  avgPolicyViolations: number;
  totalCostUsd: number;
  scenarios: string[];
}

/** Per-scenario roll-up across harnesses. */
export interface ScenarioSummary {
  scenarioId: string;
  harnesses: string[];
  runs: number;
  passed: number;
  failed: number;
  successRate: number;
  totalCostUsd: number;
}

/**
 * Cross-harness comparison for ONE scenario: each (harness × model) row lists
 * its §15 L3 metrics side by side so a reader can compare harnesses on the same
 * fixture/behaviour. This is the "cross-harness 对比" (§15 L3) data face.
 */
export interface ScenarioCompareRow {
  harnessId: string;
  modelId?: string;
  success: boolean;
  wallTimeMs: number;
  toolCalls: number;
  invalidCalls: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  contextPeak: number;
  compactions: number;
  humanIntervention: number;
  policyViolations: number;
  resumeSuccess: boolean | null;
}

/** Overall totals across the whole batch. */
export interface OverallSummary {
  runs: number;
  passed: number;
  failed: number;
  successRate: number;
  harnessCount: number;
  scenarioCount: number;
  totalWallTimeMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
  totalToolCalls: number;
}

/** The complete, JSON-serializable benchmark report (084 consumes `.json`). */
export interface BenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  source: string;
  totals: OverallSummary;
  harnesses: HarnessSummary[];
  scenarios: ScenarioSummary[];
  /** scenarioId → cross-harness comparison rows. */
  comparisons: Array<{ scenarioId: string; rows: ScenarioCompareRow[] }>;
  rows: ReportRow[];
}

/** Guarded mean over numeric values; 0 when empty to avoid NaN in output. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Guarded sum over numeric values; 0 when empty. */
function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Round to 6 decimals for cost-style floats; pass other numbers through. */
function round6(n: number): number {
  return Number(n.toFixed(6));
}

function deriveSummary(harnessId: string, rows: ReportRow[]): HarnessSummary {
  const runs = rows.length;
  const passed = rows.filter((r) => r.status === 'passed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  const pending = rows.filter((r) => r.status === 'pending').length;
  const ms = rows.map((r) => r.metrics);
  return {
    harnessId,
    runs,
    passed,
    failed,
    skipped,
    pending,
    successRate: runs === 0 ? 0 : round6(passed / runs),
    avgWallTimeMs: Math.round(mean(ms.map((m) => m.wallTimeMs))),
    avgToolCalls: round6(mean(ms.map((m) => m.toolCalls))),
    avgInvalidCalls: round6(mean(ms.map((m) => m.invalidCalls))),
    avgRetries: round6(mean(ms.map((m) => m.retries))),
    avgInputTokens: Math.round(mean(ms.map((m) => m.inputTokens))),
    avgOutputTokens: Math.round(mean(ms.map((m) => m.outputTokens))),
    avgCacheReadTokens: Math.round(mean(ms.map((m) => m.cacheReadTokens))),
    avgCostUsd: round6(mean(ms.map((m) => m.costUsd))),
    avgContextPeak: Math.round(mean(ms.map((m) => m.contextPeak))),
    avgCompactions: round6(mean(ms.map((m) => m.compactions))),
    avgHumanIntervention: round6(mean(ms.map((m) => m.humanIntervention))),
    avgPolicyViolations: round6(mean(ms.map((m) => m.policyViolations))),
    totalCostUsd: round6(sum(ms.map((m) => m.costUsd))),
    scenarios: [...new Set(rows.map((r) => r.scenarioId))].sort(),
  };
}

/**
 * Aggregate ReportRows → per-harness summaries, per-scenario summaries, and
 * overall totals. Pure function (no I/O), so it is trivially testable.
 */
export function aggregateRows(rows: ReportRow[]): {
  harnesses: HarnessSummary[];
  scenarios: ScenarioSummary[];
  totals: OverallSummary;
} {
  const byHarness = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const list = byHarness.get(r.harnessId) ?? [];
    list.push(r);
    byHarness.set(r.harnessId, list);
  }
  const harnesses = [...byHarness.entries()]
    .map(([id, rs]) => deriveSummary(id, rs))
    .sort((a, b) => a.harnessId.localeCompare(b.harnessId));

  const byScenario = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const list = byScenario.get(r.scenarioId) ?? [];
    list.push(r);
    byScenario.set(r.scenarioId, list);
  }
  const scenarios: ScenarioSummary[] = [...byScenario.entries()]
    .map(([scenarioId, rs]) => {
      const passed = rs.filter((r) => r.status === 'passed').length;
      return {
        scenarioId,
        harnesses: [...new Set(rs.map((r) => r.harnessId))].sort(),
        runs: rs.length,
        passed,
        failed: rs.filter((r) => r.status === 'failed').length,
        successRate: rs.length === 0 ? 0 : round6(passed / rs.length),
        totalCostUsd: round6(sum(rs.map((r) => r.metrics.costUsd))),
      };
    })
    .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));

  const totals: OverallSummary = {
    runs: rows.length,
    passed: harnesses.reduce((a, h) => a + h.passed, 0),
    failed: harnesses.reduce((a, h) => a + h.failed, 0),
    successRate: rows.length === 0 ? 0 : round6(rows.filter((r) => r.status === 'passed').length / rows.length),
    harnessCount: harnesses.length,
    scenarioCount: scenarios.length,
    totalWallTimeMs: sum(rows.map((r) => r.metrics.wallTimeMs)),
    totalInputTokens: sum(rows.map((r) => r.metrics.inputTokens)),
    totalOutputTokens: sum(rows.map((r) => r.metrics.outputTokens)),
    totalCacheReadTokens: sum(rows.map((r) => r.metrics.cacheReadTokens)),
    totalCostUsd: round6(sum(rows.map((r) => r.metrics.costUsd))),
    totalToolCalls: sum(rows.map((r) => r.metrics.toolCalls)),
  };

  return { harnesses, scenarios, totals };
}

/**
 * Build the cross-harness comparison for every scenario. For each scenario we
 * list one row per (harness × model) so identical fixtures can be eyeballed
 * across harnesses (§15 L3 对比).
 */
export function buildComparisons(rows: ReportRow[]): Array<{ scenarioId: string; rows: ScenarioCompareRow[] }> {
  const byScenario = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const list = byScenario.get(r.scenarioId) ?? [];
    list.push(r);
    byScenario.set(r.scenarioId, list);
  }
  const out: Array<{ scenarioId: string; rows: ScenarioCompareRow[] }> = [];
  for (const [scenarioId, rs] of byScenario) {
    // deterministic order: harness, then model
    const sorted = [...rs].sort((a, b) => {
      const h = a.harnessId.localeCompare(b.harnessId);
      if (h !== 0) return h;
      return (a.modelId ?? '').localeCompare(b.modelId ?? '');
    });
    out.push({
      scenarioId,
      rows: sorted.map((r) => {
        const m = r.metrics;
        return {
          harnessId: r.harnessId,
          modelId: r.modelId,
          success: m.success,
          wallTimeMs: m.wallTimeMs,
          toolCalls: m.toolCalls,
          invalidCalls: m.invalidCalls,
          retries: m.retries,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          cacheReadTokens: m.cacheReadTokens,
          costUsd: m.costUsd,
          contextPeak: m.contextPeak,
          compactions: m.compactions,
          humanIntervention: m.humanIntervention,
          policyViolations: m.policyViolations,
          resumeSuccess: m.resumeSuccess,
        };
      }),
    });
  }
  out.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
  return out;
}

/**
 * Build a complete BenchmarkReport from ReportRows. Pure — the caller decides
 * whether/how to persist md + json (see writeReportFiles).
 */
export function buildReport(rows: ReportRow[], source = 'task-083 report'): BenchmarkReport {
  const { harnesses, scenarios, totals } = aggregateRows(rows);
  const comparisons = buildComparisons(rows);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
    totals,
    harnesses,
    scenarios,
    comparisons,
    rows,
  };
}

/** Convenience: build a BenchmarkReport straight from 076 RunResult[] (+ optional per-adapter model labels). */
export function buildReportFromRunResults(
  results: RunResult[],
  opts: { source?: string; modelsByAdapter?: Record<string, string> } = {},
): BenchmarkReport {
  const rows = results.map((r) => rowFromRunResult(r, { modelId: opts.modelsByAdapter?.[r.adapterId] }));
  return buildReport(rows, opts.source ?? 'task-083 report');
}

/**
 * Render the report as a human-readable markdown table set, following the
 * benchmarks/reports/ convention (cf. SOAK-068.md): totals → per-harness
 * summaries → per-scenario matrix → cross-harness comparison tables.
 */
export function renderReportMarkdown(rep: BenchmarkReport): string {
  const line = (s = ''): string => (s.length > 0 ? `${s}\n` : '\n');
  const pct = (n: number): string => `${Math.round(n * 100)}%`;
  let o = '';
  o += line(`# Benchmark Report — ${rep.source}`);
  o += line(`> 任务卡：tasks/083-report-dashboard.md；权威需求：docs/Vessel路线 §15.1 L3（cross-harness 统一采集）；前置：076 RunResult 契约 + 082 lane 报告形状。`);
  o += line(`> 生成于 ${rep.generatedAt}；schema ${rep.schemaVersion}；JSON 供 084 release gates 消费。`);
  o += line();

  // overall totals
  o += line('## 总体汇总');
  o += line('| runs | passed | failed | success | harnesses | scenarios | wall(ms) | inTok | outTok | cacheTok | toolCalls | cost(USD) |');
  o += line('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  o += line(
    `| ${rep.totals.runs} | ${rep.totals.passed} | ${rep.totals.failed} | ${pct(rep.totals.successRate)} | ` +
      `${rep.totals.harnessCount} | ${rep.totals.scenarioCount} | ${rep.totals.totalWallTimeMs} | ` +
      `${rep.totals.totalInputTokens} | ${rep.totals.totalOutputTokens} | ${rep.totals.totalCacheReadTokens} | ` +
      `${rep.totals.totalToolCalls} | ${rep.totals.totalCostUsd} |`,
  );
  o += line();

  // per-harness summaries
  o += line('## 按 harness 汇总');
  if (rep.harnesses.length === 0) {
    o += line('_（无 harness 数据）_');
  } else {
    o += line('| harness | runs | passed | failed | skipped | pending | success | avgWall(ms) | avgToolCalls | avgInTok | avgOutTok | avgCost | totalCost(USD) |');
    o += line('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const h of rep.harnesses) {
      o += line(
        `| ${h.harnessId} | ${h.runs} | ${h.passed} | ${h.failed} | ${h.skipped} | ${h.pending} | ${pct(h.successRate)} | ` +
          `${h.avgWallTimeMs} | ${h.avgToolCalls} | ${h.avgInputTokens} | ${h.avgOutputTokens} | ${h.avgCostUsd} | ${h.totalCostUsd} |`,
      );
    }
  }
  o += line();

  // per-scenario matrix
  o += line('## 按场景汇总');
  if (rep.scenarios.length === 0) {
    o += line('_（无场景数据）_');
  } else {
    o += line('| scenario | harnesses | runs | passed | failed | success | totalCost(USD) |');
    o += line('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
    for (const s of rep.scenarios) {
      o += line(`| ${s.scenarioId} | ${s.harnesses.join(' + ')} | ${s.runs} | ${s.passed} | ${s.failed} | ${pct(s.successRate)} | ${s.totalCostUsd} |`);
    }
  }
  o += line();

  // cross-harness comparison per scenario
  o += line('## 跨 harness 对比（同场景 §15 L3 指标并列）');
  if (rep.comparisons.length === 0) {
    o += line('_（无对比数据）_');
  } else {
    for (const cmp of rep.comparisons) {
      o += line(`### ${cmp.scenarioId}`);
      o += line('| harness | model | ok | wall(ms) | toolCalls | invalid | retries | inTok | outTok | cacheTok | cost(USD) | ctxPeak | compactions | human | policyViol |');
      o += line('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
      for (const r of cmp.rows) {
        o += line(
          `| ${r.harnessId} | ${r.modelId ?? ''} | ${r.success ? '✅' : '❌'} | ${r.wallTimeMs} | ${r.toolCalls} | ${r.invalidCalls} | ` +
            `${r.retries} | ${r.inputTokens} | ${r.outputTokens} | ${r.cacheReadTokens} | ${r.costUsd} | ${r.contextPeak} | ` +
            `${r.compactions} | ${r.humanIntervention} | ${r.policyViolations} |`,
        );
      }
      o += line();
    }
  }
  o += line('> 说明：对比表把同一场景（fixture）在不同 harness（×可选 model）下的 §15 L3 指标并列；success 以 076 asserts 通过为准。');
  return o;
}

/**
 * Minimal CLI dashboard summary — a small, machine-friendly text table for a
 * terminal. This is the "看板视图 CLI 摘要" deliverable; a web dashboard is a
 * documented seam (see renderDashboardSeam / report.ts module doc) left for later.
 */
export function renderCliSummary(rep: BenchmarkReport): string {
  const pct = (n: number): string => `${Math.round(n * 100)}%`;
  const rows: string[] = [];
  rows.push(`Benchmark Report — ${rep.source}`);
  rows.push(`totals: ${rep.totals.runs} runs, ${rep.totals.passed} passed, ${rep.totals.failed} failed, success ${pct(rep.totals.successRate)}, cost $${rep.totals.totalCostUsd}`);
  rows.push('');
  rows.push('harness summary');
  rows.push(`${'harness'.padEnd(16)} ${'runs'.padStart(5)} ${'pass'.padStart(4)} ${'fail'.padStart(4)} ${'success'.padStart(8)} ${'avgWall(ms)'.padStart(11)} ${'avgCost'.padStart(8)} ${'totalCost'.padStart(10)}`);
  for (const h of rep.harnesses) {
    rows.push(`${h.harnessId.padEnd(16)} ${String(h.runs).padStart(5)} ${String(h.passed).padStart(4)} ${String(h.failed).padStart(4)} ${pct(h.successRate).padStart(8)} ${String(h.avgWallTimeMs).padStart(11)} ${String(h.avgCostUsd).padStart(8)} ${String(h.totalCostUsd).padStart(10)}`);
  }
  rows.push('');
  rows.push('cross-harness comparison (by scenario)');
  for (const cmp of rep.comparisons) {
    for (const r of cmp.rows) {
      rows.push(`  ${cmp.scenarioId}: ${r.harnessId}${r.modelId ? `/${r.modelId}` : ''} ${r.success ? 'OK' : 'FAIL'} wall=${r.wallTimeMs}ms in=${r.inputTokens} out=${r.outputTokens} cost=$${r.costUsd}`);
    }
  }
  return rows.join('\n');
}

/**
 * Web dashboard seam (documented, NOT implemented this task): a future 083-web
 * extension renders BenchmarkReport as an HTML page. Returning the report as
 * the data payload here keeps the seam typed so the web work can take over
 * without touching the aggregation core.
 */
export function renderDashboardSeam(rep: BenchmarkReport): { ok: true; data: BenchmarkReport } {
  return { ok: true, data: rep };
}

/**
 * Persist a BenchmarkReport to `<reportsDir>/benchmark-report-<ts>.md` and
 * `.json` (084 consumes the JSON; humans read the md), following the
 * benchmarks/reports/ convention. Returns the written paths.
 */
export function writeReportFiles(
  rep: BenchmarkReport,
  reportsDir: string,
): { mdPath: string; jsonPath: string } {
  fs.mkdirSync(reportsDir, { recursive: true });
  const ts = rep.generatedAt.replace(/[:.]/g, '-');
  const base = `benchmark-report-${ts}`;
  const mdPath = path.join(reportsDir, `${base}.md`);
  const jsonPath = path.join(reportsDir, `${base}.json`);
  fs.writeFileSync(mdPath, renderReportMarkdown(rep), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(rep, null, 2), 'utf8');
  return { mdPath, jsonPath };
}