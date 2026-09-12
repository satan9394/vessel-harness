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
 *
 * 证据层诚实性（本卡，与 082 lane 同一裁决的第二个面）：`status` **不**只看
 * `metrics.success` —— 「回合未正常收尾」（熔断/中断/预算打死，finalText 非空 ⇒
 * success 仍为 true）的行不得报 `passed`。识别一律走 lane 的同一纯函数
 * `abnormalTurnKindOf`（或 lane 行已有的结构化字段），report 侧**不另写正则**；
 * 状态取值仍用既有枚举 `'failed'`（不新增枚举值，理由见 `ReportRowStatus`）。
 *
 * 证据层诚实性（本卡第三面，收口「失败被上报为成功」族的最后一块）：上面只改了
 * `ReportRow.status`，**呈现层仍是绿的** —— `buildComparisons:390` 的 `success: m.success`、
 * md:506 的 `r.success ? '✅' : '❌'`、CLI:538 的 `r.success ? 'OK' : 'FAIL'` 依旧只看
 * 076 指标口径，且 md/CLI **从不渲染** `ReportRow.notes` / `turnKind` ⇒ 看板/对比表上
 * 「被熔断打死」的运行照样 ✅/OK。
 * 收口方式（与上游裁决一致，不自创第二套口径）：
 *  ① `ScenarioCompareRow.success` **保持 076 指标原值**（语义裁决见该接口注释），
 *     异常收尾由**加法**字段 `turnEndedAbnormally` / `turnKind` 承载（与 `ReportRow`
 *     同名字段、同一来源、条件展开 ⇒ 正常行键集/顺序逐字不变）；
 *  ② md/CLI 的**呈现**按同一谓词 `mustNotDisplayAsSuccess` 叠加 `⚠`，并把 `turnKind`
 *     与原因文本渲染出来（`abnormalTurnReasonLine`，md/CLI 共用一份文案）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunResult, RunResultMetrics } from '../contracts/types.js';
import {
  abnormalTurnKindOf,
  describeAbnormalTurnNote,
  type RealModelLaneReport,
} from '../lane/real-model-lane.js';

/**
 * Row status — derived from metrics.success **and** turn-level honesty (see
 * rowFromRunResult) unless the caller overrides.
 *
 * 为什么不给「回合未正常收尾」加新状态：与 082 lane 的裁决同源
 * （lane/real-model-lane.ts:121-134 `LaneRowStatus`）——本聚合报告的
 * per-harness / per-scenario / totals 计数同样按**精确枚举值**相加
 * （report.ts deriveSummary / aggregateRows），release-gates
 * （gates.ts:903/911）也按 `'failed'` / `'passed'` / `'pending-environment'`
 * 精确计数。新增枚举值会造成「既不计 failed、也不计 passed」的空洞 ⇒ 又一条
 * 来源不明的绿灯。故状态仍取既有 `'failed'`，区分性由**加法**字段
 * `turnEndedAbnormally` / `turnKind` 承载。
 */
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
  /**
   * 证据层诚实性（与 082 lane 行同口径）：该行对应的 run **回合未正常收尾**——
   * 熔断器/中断/预算把回合打死时 `metrics.success` 仍可能是 `true`
   * （contracts/vessel.ts:197 的口径是 `runError === null && finalText.trim().length > 0`，
   * 而被打死的回合是把 `err.message` 写进 finalText 后**正常 return**）。
   * `true` ⇒ `status` 必为 `'failed'`，**即便 `metrics.success === true`**。
   * 缺席（undefined）= 正常收尾，与改动前的行逐字一致（键都不出现）。
   */
  turnEndedAbnormally?: boolean;
  /** 未正常收尾时的回合 kind（'error' / 'interrupted' / 'budget'）；仅随上面一起出现。 */
  turnKind?: string;
}

/**
 * Convert one 076 RunResult into a ReportRow.
 *
 * 证据层诚实性（本卡，082 lane 裁决的第二个面）：`status` 不再只看
 * `metrics.success` —— 回合未正常收尾的行不得报 `passed`。
 *
 * 识别方式（**与 082 lane 同口径，report 侧不另写一份正则**）：
 *  ① 优先用调用方给的 082 lane 行**结构化字段**（`turnEndedAbnormally` / `turnKind`，
 *    real-model-lane.ts:146-154）——`rowsFromLaneReport` 会把它们透传进来；
 *  ② 否则复用 lane 导出的纯函数 `abnormalTurnKindOf(result)` 从 `RunResult.notes`
 *    读回（`RunResult` 契约目前没有结构化回合字段，见 contracts/types.ts:73-87，
 *    故裸 RunResult[] 路径只能走这一条）。
 *  正常行两条都命中不了 ⇒ 与改动前逐字一致。
 *
 * 状态取值仍为既有枚举 `'failed'`（理由见 `ReportRowStatus` 注释）。
 */
export function rowFromRunResult(
  result: RunResult,
  opts: { modelId?: string; turnEndedAbnormally?: boolean; turnKind?: string } = {},
): ReportRow {
  // ① 结构化字段：只在 lane 明确标了「未正常收尾」时才采信（lane 只在异常行上加该字段）。
  const structuredKind = opts.turnEndedAbnormally === true ? opts.turnKind : undefined;
  // ② 兜底：复用 lane 的同一个纯函数（口径只有一处，绝不复制正则）。
  const turnKind = structuredKind ?? abnormalTurnKindOf(result);
  const turnEndedAbnormally = turnKind !== undefined || opts.turnEndedAbnormally === true;
  /**
   * 可见原因：只在「`metrics.success === true` 却未正常收尾」这一族上追加
   * （这正是旧实现报 passed 的族）；`metrics.success === false` 的行 notes **逐字不变**，
   * 既有行为不受本卡影响。文案复用 lane 的 `describeAbnormalTurnNote`，两处口径同一份。
   */
  const noteForAbnormalTurn =
    turnEndedAbnormally && result.metrics.success && turnKind !== undefined
      ? describeAbnormalTurnNote(result, turnKind)
      : undefined;
  return {
    harnessId: result.adapterId,
    harnessVersion: result.adapterVersion,
    modelId: opts.modelId,
    scenarioId: result.fixtureId,
    metrics: result.metrics,
    startedAt: result.startedAt,
    status: result.metrics.success && !turnEndedAbnormally ? 'passed' : 'failed',
    notes: noteForAbnormalTurn !== undefined ? [...(result.notes ?? []), noteForAbnormalTurn] : result.notes,
    // 加法字段：只在异常收尾的行上出现 —— 正常行的键集/取值与改动前逐字一致。
    ...(turnEndedAbnormally
      ? turnKind !== undefined
        ? { turnEndedAbnormally: true as const, turnKind }
        : { turnEndedAbnormally: true as const }
      : {}),
  };
}

/**
 * Convert a 082 RealModelLaneReport's run rows into ReportRows. Only rows that
 * actually produced a 076 RunResult (`result` present) are carried; pending /
 * skipped rows are dropped from the metric aggregation (they carry no metrics).
 * harnessId is fixed to the Vessel self-adapter used by the lane.
 *
 * 证据层诚实性（本卡）：lane 行的自身状态与结构化字段从前**被丢弃**
 * （旧实现只取 `r.result` + `r.modelId`，再由 `metrics.success` 重新推 status），
 * 于是「修复后的 lane 已标 `status='failed'` + `turnEndedAbnormally`」的行，
 * 一经 `vessel bench-report --input <lane.json>` 聚合又变回 `passed`。
 * 现在把 lane 的结构化字段透传给 `rowFromRunResult`（优先于文案正则）；对
 * **修复前**产出的 lane JSON（没有该字段）则由同一个 `abnormalTurnKindOf` 兜底。
 */
export function rowsFromLaneReport(rep: RealModelLaneReport, harnessId = 'vessel'): ReportRow[] {
  const out: ReportRow[] = [];
  for (const r of rep.rows) {
    if (!r.result) continue;
    out.push(
      rowFromRunResult(r.result, {
        modelId: r.modelId,
        turnEndedAbnormally: r.turnEndedAbnormally,
        turnKind: r.turnKind,
      }),
    );
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
  /**
   * 076 §15 L3 指标口径：`RunResultMetrics.success` 的**原值**（本卡裁决：不改判）。
   *
   * 为什么不把它直接改判成 `false`：本表是「同场景 §15 L3 **指标**并列」，
   * `success` 与 `wallTimeMs` / `toolCalls` / `inputTokens` / … 同族，都是 076 契约字段的
   * 原值；一旦按回合级判定改判，同一份 JSON 里 `rows[].metrics.success`（true）与
   * `comparisons[].rows[].success`（false）会对**同一行**给出互相矛盾的两个值，
   * 读者无从分辨哪个是「模型/工具层指标」哪个是「回合级判定」，对比表随之失去
   * 「指标并列」的含义（也抹掉历史对比基线）。异常收尾因此由**加法**字段承载。
   *
   * **呈现纪律（消费方必读）**：`success === true` **不再**等于「这行可以显示为成功」——
   * 必须同时看 `turnEndedAbnormally`。本仓的呈现消费方是 `renderReportMarkdown`
   * （ok 列）与 `renderCliSummary`（对比行），二者已按本纪律改为 `⚠` + 原因文本；
   * `release-gates/gates.ts:903/911` 只读 **lane 行** `status`，不读本表。
   */
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
  /**
   * 证据层诚实性（本卡）：与 `ReportRow.turnEndedAbnormally` **同源同义**
   * （`metrics.success === true` 且回合未正常收尾）。
   * 缺席（undefined）= 正常行，键都不出现 ⇒ 行键集/顺序与改动前逐字一致。
   */
  turnEndedAbnormally?: boolean;
  /** 未正常收尾时的回合 kind（'error' / 'interrupted' / 'budget'）；仅随上面一起出现。 */
  turnKind?: string;
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
 * 对比表里「回合未正常收尾」行的统一标记（md ok 列 / CLI 行首共用）。
 * 不用 `✅`/`OK`：本卡要治的正是「这行显示成成功」，`OK*` 一类仍读作 OK，故取 `⚠`。
 */
const ABNORMAL_TURN_MARK = '⚠';

/**
 * 「**呈现上不得显示为成功**」的对比行 —— 与缺陷族精确同界：
 * `success === true`（076 指标说成功）**且** `turnEndedAbnormally === true`（回合没正常收尾）。
 *
 * 为什么把 `success === false` 的行排除在外：它们本就渲染 `❌` / `FAIL`（从来不是绿灯），
 * 本卡不放宽也不改写这一族的既有呈现（`metrics.success === false` 的行逐字不变）。
 * 注意：`turnEndedAbnormally` / `turnKind` 作为**数据**仍照 `ReportRow` 口径透传
 * （JSON 里可读回原因），这里只是**呈现**的界。
 */
function mustNotDisplayAsSuccess(r: { success: boolean; turnEndedAbnormally?: boolean }): boolean {
  return r.success === true && r.turnEndedAbnormally === true;
}

/**
 * 对比表 ok 列的呈现：异常收尾行 `⚠`，其余沿用 `✅` / `❌`（逐字不变）。
 */
function compareOkMark(r: { success: boolean; turnEndedAbnormally?: boolean }): string {
  if (mustNotDisplayAsSuccess(r)) return ABNORMAL_TURN_MARK;
  return r.success ? '✅' : '❌';
}

/**
 * CLI 对比行行首的呈现：异常收尾行 `⚠`，其余沿用 `OK` / `FAIL`（逐字不变）。
 */
function compareCliVerdict(r: { success: boolean; turnEndedAbnormally?: boolean }): string {
  if (mustNotDisplayAsSuccess(r)) return ABNORMAL_TURN_MARK;
  return r.success ? 'OK' : 'FAIL';
}

/**
 * 异常收尾行在 md / CLI 上的**可见原因**（两处共用同一份文案，不写第二套）。
 *
 * 今天 md/CLI 完全不渲染 `ReportRow.notes` / `turnKind`，异常原因只在 JSON 行上可见；
 * 本函数把 `turnKind` 与原因摆到人看的面上（md 用 `> ` 前缀、CLI 用缩进，见各渲染器）。
 * 谓语与 lane 的 `describeAbnormalTurnNote`（只在 `metrics.success === true` 且未正常收尾时
 * 生成原因）同一族，措辞沿用 lane 既有文案风格。
 */
function abnormalTurnReasonLine(r: {
  harnessId: string;
  modelId?: string;
  turnKind?: string;
}): string {
  return (
    `${ABNORMAL_TURN_MARK} ${r.harnessId}${r.modelId ? `/${r.modelId}` : ''}：回合未正常收尾` +
    `${r.turnKind !== undefined ? `（turnKind=${r.turnKind}）` : ''}` +
    `——finalText 是错误/半截文案而非模型答案 ⇒ 本行不计 passed` +
    `（success 字段仍是 076 metrics 指标口径，非判定口径）`
  );
}

/**
 * Build the cross-harness comparison for every scenario. For each scenario we
 * list one row per (harness × model) so identical fixtures can be eyeballed
 * across harnesses (§15 L3 对比).
 *
 * 证据层诚实性（本卡）：`success` 保持 076 指标原值（语义见 `ScenarioCompareRow.success`），
 * 异常收尾另加**加法**字段（条件展开 ⇒ 正常行键集/顺序/取值逐字不变）。
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
          // 加法字段（条件展开）：只在异常收尾的行上出现 —— 正常行的键集/顺序/取值逐字不变。
          ...(r.turnEndedAbnormally === true
            ? r.turnKind !== undefined
              ? { turnEndedAbnormally: true as const, turnKind: r.turnKind }
              : { turnEndedAbnormally: true as const }
            : {}),
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
          `| ${r.harnessId} | ${r.modelId ?? ''} | ${compareOkMark(r)} | ${r.wallTimeMs} | ${r.toolCalls} | ${r.invalidCalls} | ` +
            `${r.retries} | ${r.inputTokens} | ${r.outputTokens} | ${r.cacheReadTokens} | ${r.costUsd} | ${r.contextPeak} | ` +
            `${r.compactions} | ${r.humanIntervention} | ${r.policyViolations} |`,
        );
      }
      // 异常收尾行的可见原因（把 turnKind 渲染出来）：**只在存在该族行时**追加，
      // 故无异常行的报告输出逐字不变（表头/列宽/分隔线一律不动，原因不进表格列）。
      for (const r of cmp.rows) {
        if (mustNotDisplayAsSuccess(r)) o += line(`> ${abnormalTurnReasonLine(r)}`);
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
      rows.push(`  ${cmp.scenarioId}: ${r.harnessId}${r.modelId ? `/${r.modelId}` : ''} ${compareCliVerdict(r)} wall=${r.wallTimeMs}ms in=${r.inputTokens} out=${r.outputTokens} cost=$${r.costUsd}`);
    }
    // 异常收尾行的可见原因（把 turnKind 渲染出来）：只在存在该族行时追加一行，
    // 故无异常行的 CLI 摘要逐字不变。
    for (const r of cmp.rows) {
      if (mustNotDisplayAsSuccess(r)) rows.push(`    ${abnormalTurnReasonLine(r)}`);
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