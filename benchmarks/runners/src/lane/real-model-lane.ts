/**
 * task 082 — Real-Model Benchmark Lane (L2 real model regression runway).
 *
 * Fixed real models (DeepSeek V4 Pro / Flash by default, injectable) run a
 * fixed scenario set picked from the existing L1 assets (B001-B005 + B016-B027 +
 * safety S001-S008, 25 entries inside the §15.1 target of 20-50) and uniformly
 * collect §15.1 L2/L3 metrics, reusing the task-076 RunResult contract.
 *
 * Honesty / degradation:
 *  - provider/model are injectable; without a resolvable provider the lane
 *    marks that model's rows "pending-environment" and NEVER throws (076-081
 *    mode). No real API quota is burned without a resolver that supplies one.
 *  - The lane drives each scenario through the Vessel self-adapter
 *    (contracts/vessel.runVesselFixture), so each (model × scenario) yields a
 *    076-validated RunResult. It does NOT re-evaluate the scenario's
 *    assert-level pass (offline lane's job) and does NOT wire scenario-level
 *    feature drivers (subagent/planner/… are deterministic-mock lanes); those
 *    entries are flagged runnable=false in the registry.
 *
 * Report: releases/benchmarks/reports/REAL-MODEL-LANE-<runId>.md + .json
 * (multi-model × multi-scenario metric matrix + per-model/per-scenario summaries).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { vesselAdapter } from '../contracts/vessel.js';
import { validateRunResult } from '../contracts/validate.js';
import type { ChatProvider } from '@vessel/shared';
import type { HarnessFixture, RunResult } from '../contracts/types.js';

/** Model capability tier for a real-model lane (§15.1 L2). */
export type LaneModelTier = 'pro' | 'flash';

/** A real model the lane can drive (injectable; defaults are DeepSeek V4 series). */
export interface LaneModel {
  /** stable key used in reports, e.g. 'deepseek-v4-pro'. */
  id: string;
  /** display name, e.g. 'DeepSeek V4 Pro'. */
  displayName: string;
  /** capability tier used to select which scenarios apply to this model. */
  tier: LaneModelTier;
  /** provider-level model string handed to the resolved ChatProvider / pricing. */
  defaultModel: string;
}

/** Default fixed real-model set (§15.1 L2). */
export const LANE_MODELS: LaneModel[] = [
  { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', tier: 'pro', defaultModel: 'deepseek-v4-pro' },
  { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', tier: 'flash', defaultModel: 'deepseek-v4-flash' },
];

/** Which model tier(s) a scenario applies to (§15.1 L2 "标注每个场景适用模型档"). */
export type LaneScenarioTier = 'pro' | 'flash' | 'both';

/** A fixed lane scenario entry picked from the existing L1 assets. */
export interface LaneScenarioEntry {
  /** scenario / fixture id (B001…B023, S001…S008). */
  id: string;
  /** model tier(s) this scenario applies to. */
  tier: LaneScenarioTier;
  /**
   * Whether this scenario can be meaningfully driven on a real model today.
   * false = feature-lane / deterministic-mock only (subagent/planner/…), kept
   * in the registry for enumeration + documentation.
   */
  runnable: boolean;
  /** human note: fixture/assert provenance for the report. */
  note?: string;
}

/**
 * The fixed lane scenario registry — all existing L1 assets (B001-B023 +
 * safety S001-S008 + V1.1-D B024-B027 capability lanes, 25 entries, inside
 * §15.1's 20-50 target). The scenario set is configurable
 * (runRealModelLane accepts `scenarios`), this is the default.
 *
 * Annotations:
 *  - `runnable` true ↔ genuinely drivable through the Vessel self-adapter on a
 *    real model (task-style fixtures B001-B005 + all safety S001-S008 where
 *    policy enforcement is the behaviour under test).
 *  - `runnable` false ↔ feature lanes that need deterministic-mock drivers
 *    (subagent B016 / planner B017 / evaluator B018 / MCP B019 / memory B020 /
 *    skill B021 / taskRouter B022 / engine B023 / streaming B024 / interrupt
 *    B025 / steering B026 / resume B027) — enumerated for the 20-50 set but not
 *    invoked on a real model (no quota burned, marked skipped).
 */
export const LANE_SCENARIOS: LaneScenarioEntry[] = [
  // --- task-style L1 scenarios (mode: both) — real-model drivable ---
  { id: 'B001', tier: 'flash', runnable: true, note: 'read file + answer, zero side effects' },
  { id: 'B002', tier: 'flash', runnable: true, note: 'cross-file search + call-site list' },
  { id: 'B003', tier: 'pro', runnable: true, note: 'implement single-file missing function' },
  { id: 'B004', tier: 'pro', runnable: true, note: 'cross-file consistent refactor' },
  { id: 'B005', tier: 'pro', runnable: true, note: 'bash exec + use result (danger policy)' },
  // --- safety L1 scenarios (S001-S008) — policy enforcement is the behaviour ---
  { id: 'S001', tier: 'flash', runnable: true, note: 'destructive-delete hard-deny' },
  { id: 'S002', tier: 'flash', runnable: true, note: 'path escape guard' },
  { id: 'S003', tier: 'flash', runnable: true, note: 'symlink escape guard' },
  { id: 'S004', tier: 'flash', runnable: true, note: 'prompt-injection resistance' },
  { id: 'S005', tier: 'flash', runnable: true, note: 'MCP malicious input' },
  { id: 'S006', tier: 'flash', runnable: true, note: 'git force-push hard-deny' },
  { id: 'S007', tier: 'flash', runnable: true, note: 'secrets/.env read hard-deny' },
  { id: 'S008', tier: 'flash', runnable: true, note: 'SSRF metadata addr network deny' },
  // --- feature lanes (deterministic-mock drivers) — enumerated, not invoked ---
  { id: 'B016', tier: 'pro', runnable: false, note: 'subagent driver (offline deterministic)' },
  { id: 'B017', tier: 'pro', runnable: false, note: 'planner driver (offline deterministic)' },
  { id: 'B018', tier: 'pro', runnable: false, note: 'evaluator driver (offline deterministic)' },
  { id: 'B019', tier: 'flash', runnable: false, note: 'MCP driver (offline deterministic)' },
  { id: 'B020', tier: 'flash', runnable: false, note: 'memory driver (offline deterministic)' },
  { id: 'B021', tier: 'flash', runnable: false, note: 'skill driver (offline deterministic)' },
  { id: 'B022', tier: 'pro', runnable: false, note: 'taskRouter driver (offline deterministic)' },
  { id: 'B023', tier: 'pro', runnable: false, note: 'loop-engine driver (offline deterministic)' },
  // V1.1-D: streaming / interrupt / steering / resume capability lanes (task V1.1-D,
  // deterministic-mock drivers — model_stream_*/interrupt/steer/handoff seams only
  // runnable offline; enabled for enumeration + documentation).
  { id: 'B024', tier: 'pro', runnable: false, note: 'streaming driver (interleaved text/tool, offline deterministic)' },
  { id: 'B025', tier: 'pro', runnable: false, note: 'interrupt driver (kind=interrupted, offline deterministic)' },
  { id: 'B026', tier: 'flash', runnable: false, note: 'steering driver (source=steer redirect, offline deterministic)' },
  { id: 'B027', tier: 'pro', runnable: false, note: 'resume driver (handoff source=handoff continuation, offline deterministic)' },
];

/**
 * Lane row status (§15.1 L2 honesty).
 *
 * 为什么不给「回合未正常收尾」加一个新状态（如 'error'/'partial'）：
 * 真实模型 lane 的**下游消费方按精确枚举值计数**——
 * `release-gates/gates.ts:903` 只把 `status === 'failed'` 的行计入 `failed`，
 * 其它枚举值既不计 failed、也不计 pending-environment，`judgeRealModelLane`
 * 会返回 `pass`（"真实模型 lane 全过（passed/rowCount）"）——即**新增状态本身
 * 会再造一个"来源不明的绿灯"**，而这正是本卡在治的病。
 * `report/report.ts:62`（`rowsFromLaneReport` → `rowFromRunResult`）同样只认
 * metrics.success。因此本卡：状态仍取既有枚举 `'failed'`（收紧、不放宽任何判据，
 * 下游计数照旧生效），并给行加**加法**字段 `turnEndedAbnormally`/`turnKind`
 * 让「跑了但没跑完」与「判据不通过」在报告里可区分。
 */
export type LaneRowStatus = 'passed' | 'failed' | 'pending-environment' | 'skipped';

/** One (model × scenario) lane outcome. */
export interface LaneRunRow {
  modelId: string;
  scenarioId: string;
  tier: LaneScenarioTier;
  status: LaneRowStatus;
  /** present when the scenario was actually run (076 RunResult). */
  result?: RunResult;
  /** human note for pending/passed/failed/skipped. */
  note?: string;
  /**
   * 证据层诚实性（本卡）：该行对应的 run **回合未正常收尾**——`RunResult.notes`
   * 带 `turn ended kind=<非 success>`（写入侧 contracts/vessel.ts:223-230）。
   * `true` ⇒ `status` 必为 `'failed'`，**即便 `metrics.success === true`**。
   * 缺席（undefined）= 正常收尾，与改动前的行逐字一致（键都不出现）。
   */
  turnEndedAbnormally?: boolean;
  /** 未正常收尾时的回合 kind（'error' / 'interrupted' / 'budget'）；仅随上面一起出现。 */
  turnKind?: string;
}

/** Per-model aggregate over the §15 L3 surface. */
export interface LaneModelSummary {
  modelId: string;
  displayName: string;
  runnableScenarios: number;
  passed: number;
  failed: number;
  pendingEnvironment: number;
  skipped: number;
  wallTimeMs: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

/** The complete lane report (returned + persisted to reportsDir). */
export interface RealModelLaneReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  models: LaneModel[];
  scenarioCount: number;
  scenarioIds: string[];
  rows: LaneRunRow[];
  modelSummaries: LaneModelSummary[];
  /** true when at least one the configured models could not resolve a provider. */
  degraded: boolean;
  reportMdPath: string;
  reportJsonPath: string;
}

/** Resolves a real/mock ChatProvider for a model, or null when unavailable. */
export type ProviderResolver = (model: LaneModel) => Promise<ChatProvider | null>;

/**
 * Probe which configured models can be driven by the injected resolver.
 * A provider that resolves to null is "unavailable". Never throws for
 * availability — the lane degrades to pending-environment instead.
 */
export async function probeModelApi(
  models: LaneModel[],
  resolver: ProviderResolver,
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const m of models) {
    try {
      out[m.id] = (await resolver(m)) !== null;
    } catch {
      out[m.id] = false;
    }
  }
  return out;
}

/** Returns true when the scenario's tier applies to the given model tier. */
export function scenarioAppliesToModel(scenario: LaneScenarioEntry, model: LaneModel): boolean {
  return scenario.tier === 'both' || scenario.tier === model.tier;
}

function moduleScenariosFor(model: LaneModel, scenarios: LaneScenarioEntry[]): LaneScenarioEntry[] {
  return scenarios.filter((s) => scenarioAppliesToModel(s, model));
}

function scenarioFixtureDir(repoRoot: string, id: string): string {
  return path.join(repoRoot, 'benchmarks', 'fixtures', id);
}

function scenarioFixtureMissing(repoRoot: string, id: string): boolean {
  return !fs.existsSync(path.join(scenarioFixtureDir(repoRoot, id), 'task.md'));
}

function summarizeModel(
  model: LaneModel,
  rows: LaneRunRow[],
  displayName: string,
): LaneModelSummary {
  const mine = rows.filter((r) => r.modelId === model.id);
  const sum = { wallTimeMs: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 };
  for (const r of mine) {
    if (r.result) {
      const mm = r.result.metrics;
      sum.wallTimeMs += mm.wallTimeMs;
      sum.toolCalls += mm.toolCalls;
      sum.inputTokens += mm.inputTokens;
      sum.outputTokens += mm.outputTokens;
      sum.cacheReadTokens += mm.cacheReadTokens;
      sum.costUsd += mm.costUsd;
    }
  }
  return {
    modelId: model.id,
    displayName,
    runnableScenarios: mine.length,
    passed: mine.filter((r) => r.status === 'passed').length,
    failed: mine.filter((r) => r.status === 'failed').length,
    pendingEnvironment: mine.filter((r) => r.status === 'pending-environment').length,
    skipped: mine.filter((r) => r.status === 'skipped').length,
    ...sum,
    costUsd: Number(sum.costUsd.toFixed(6)),
  };
}

/**
 * failed 行的可见原因（task 102 baseline + task 108 运行异常）：
 * success=false 时给出「finalText 为空」基线；若 RunResult 带 `notes`（adapter 侧运行异常，
 * 如上游 400 `invalid_request_error` 拒绝工具序列），追加真实异常文案——保留「finalText 为空」
 * 子串，使 gate 判据（isModelNonConvergentLane / isWireFormatBlockedLane）可区分失败模式。
 */
export function describeLaneFailureNote(result: RunResult): string {
  const base = `RunResult success=false：finalText 为空（toolCalls=${result.metrics.toolCalls}`;
  const notes = result.notes ?? [];
  return notes.length > 0
    ? `${base}）；运行异常：${notes.join(' | ')}`
    : `${base}，多为模型未在步数/预算内收敛）`;
}

/**
 * 未正常收尾的回合 kind —— 从 076 `RunResult.notes` 里读回（本卡只动 lane，不动契约）。
 *
 * 写入侧唯一来源：contracts/vessel.ts:223-230 只在 `turnKind !== undefined && turnKind !== 'success'`
 * 时追加一条以 `turn ended kind=` 起首的 note；`kind === 'success'`（以及正常收尾）时
 * `notes` 保持 `undefined`。因此本谓词：
 *  - 对正常行恒为 `undefined`（绝不影响既有 passed 行）；
 *  - 对「回合被打死但 metrics.success===true」的行返回真实 kind。
 *
 * 注意（只报告，未在本卡内改）：这是对 adapter 文案的**字符串耦合**。durable 的修法是给
 * 076 契约加结构化字段（如 `RunResult.turnKind`），但 contracts/** 不在本卡改动范围内。
 * 外部 CLI adapter（dsh/opencode/codex/pi/claude）今天不写该标记 —— 它们的同类缺口
 * （`acc.success` 默认 true、只在 finalText 为空时置 false）见各 adapter 的 success 归一化处。
 */
export function abnormalTurnKindOf(result: RunResult): string | undefined {
  for (const n of result.notes ?? []) {
    const m = /^turn ended kind=([^\s：:，,（(]+)/.exec(n);
    if (m && m[1] !== 'success') return m[1];
  }
  return undefined;
}

/**
 * 回合未正常收尾（但 `metrics.success === true`）行的可见原因。
 *
 * 为什么要这条 note：`metrics.success` 的口径是
 * `runError === null && finalText.trim().length > 0`（contracts/vessel.ts:197 —— 「模型说了话」），
 * 而熔断器打死的回合（core AgentLoop.ts:334-338：kind='error'，`err.message` 写进 finalText 后
 * **正常 return**）带着**非空** finalText ⇒ success=true。旧口径据此判 `passed`，
 * 那条「本 run 未正常收尾」的 notes 只躺在 `row.result.notes` 里，报告表层看不到 ——
 * 一行「回合被打死」的运行在 lane 报告里成了 passed（来源不明的绿灯比红灯更危险）。
 *
 * 纪律：本 note 只在 `metrics.success === true` 且检测到非正常收尾时生成；
 * `metrics.success === false` 的行仍走 `describeLaneFailureNote`（**逐字不变**，
 * 保持 gate 的 `isModelNonConvergentLane`「finalText 为空」基线可判）。
 */
export function describeAbnormalTurnNote(result: RunResult, kind: string): string {
  const notes = result.notes ?? [];
  const raw = notes.length > 0 ? `；运行异常：${notes.join(' | ')}` : '';
  return (
    `RunResult metrics.success=true，但回合未正常收尾（kind=${kind}）：` +
    `finalText 是错误/半截文案而非模型答案 ⇒ 本行不计 passed${raw}`
  );
}

/**
 * Run the real-model lane: every configured model × applicable scenario,
 * driving each through the 076 Vessel self-adapter and collecting §15 L3
 * RunResult rows. Degradation: a model whose provider cannot be resolved is
 * marked pending-environment (never throws). Non-runnable feature lanes are
 * marked skipped (no quota burned).
 */
export async function runRealModelLane(opts: {
  models: LaneModel[];
  scenarios: LaneScenarioEntry[];
  providerResolver: ProviderResolver;
  repoRoot: string;
  reportsDir: string;
  keepWorkspace?: boolean;
}): Promise<RealModelLaneReport> {
  const runId = `real-model-lane-${Date.now()}`;
  const startedAt = new Date();
  const startedIso = startedAt.toISOString();

  const fixtureCache = new Map<string, HarnessFixture>();
  const makeFixture = (entry: LaneScenarioEntry, model: LaneModel, provider: ChatProvider): HarnessFixture => {
    const key = `${model.id}::${entry.id}`;
    let f = fixtureCache.get(key);
    if (!f) {
      f = {
        id: entry.id,
        workspaceRoot: scenarioFixtureDir(opts.repoRoot, entry.id),
        options: { provider, model: model.defaultModel, configRoot: opts.repoRoot, keepWorkspace: opts.keepWorkspace },
      };
      fixtureCache.set(key, f);
    }
    return f;
  };

  const rows: LaneRunRow[] = [];
  let degraded = false;

  for (const model of opts.models) {
    // resolve provider once per model (probe + reuse for every scenario)
    let provider: ChatProvider | null;
    try {
      provider = await opts.providerResolver(model);
    } catch {
      provider = null;
    }
    const available = provider !== null;
    if (!available) degraded = true;

    const applicable = moduleScenariosFor(model, opts.scenarios);
    for (const scenario of applicable) {
      // non-runnable feature lanes are enumerated but not invoked
      if (!scenario.runnable) {
        rows.push({
          modelId: model.id,
          scenarioId: scenario.id,
          tier: scenario.tier,
          status: 'skipped',
          note: scenario.note ?? 'feature-lane / deterministic-mock only',
        });
        continue;
      }
      // fixture missing → honest failed row (hard setup problem, no quota burned)
      if (scenarioFixtureMissing(opts.repoRoot, scenario.id)) {
        rows.push({
          modelId: model.id,
          scenarioId: scenario.id,
          tier: scenario.tier,
          status: 'failed',
          note: `fixture not found: ${scenario.id}`,
        });
        continue;
      }
      // model unavailable → pending-environment, never throw
      if (!available) {
        rows.push({
          modelId: model.id,
          scenarioId: scenario.id,
          tier: scenario.tier,
          status: 'pending-environment',
          note: 'no resolvable provider (probe failed / no credentials)',
        });
        continue;
      }

      const fixture = makeFixture(scenario, model, provider!);
      try {
        const result = await vesselAdapter.run(fixture);
        const issues = validateRunResult(result);
        /**
         * 证据层诚实性（本卡）：行的 passed 不再只看 `metrics.success`。
         * 裁决：**回合未正常收尾（`turnEndedAbnormally`）的行不得报 passed** ——
         * `passed` 是对外声称「这一行跑通了」，而它没跑完；这与「失败被上报为成功」同族。
         * 状态仍取既有 `'failed'`（理由见 `LaneRowStatus` 注释：新枚举值会让
         * gates.ts:903 / report.ts:62 的精确计数静默漏掉该行 ⇒ 再造绿灯）。
         */
        const abnormalKind = abnormalTurnKindOf(result);
        const status: LaneRowStatus =
          issues.length === 0 && result.metrics.success && abnormalKind === undefined ? 'passed' : 'failed';
        // task 102：failed 行必须带可见原因（此前 success=false 的行 note 为空，gate 无法归类）。
        // task 108：success=false 且带运行异常（如上游 400 线协议拒绝）时，原因写进 note（追加真实
        // 异常文案，保留「finalText 为空」基线子串，供 gate 判据区分「未收敛」与「线协议不兼容」）。
        // 本卡：success=true 但回合未正常收尾时同样给出可见原因（此前只在 result.notes 里）。
        const note = issues.length > 0
          ? `invalid RunResult: ${issues.map((i) => i.field).join(', ')}`
          : !result.metrics.success
            ? describeLaneFailureNote(result)
            : abnormalKind !== undefined
              ? describeAbnormalTurnNote(result, abnormalKind)
              : undefined;
        rows.push({
          modelId: model.id,
          scenarioId: scenario.id,
          tier: scenario.tier,
          status,
          result,
          note,
          // 加法字段：只在异常收尾的行上出现 —— 正常行的键集/取值与改动前逐字一致。
          ...(abnormalKind !== undefined
            ? { turnEndedAbnormally: true as const, turnKind: abnormalKind }
            : {}),
        });
      } catch (err) {
        rows.push({
          modelId: model.id,
          scenarioId: scenario.id,
          tier: scenario.tier,
          status: 'failed',
          note: String(err),
        });
      }
    }
  }

  const finishedAt = new Date();
  const modelSummaries = opts.models.map((m) =>
    summarizeModel(m, rows, m.displayName),
  );
  const scenarioIds = opts.scenarios.map((s) => s.id);

  const reportsDir = opts.reportsDir;
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportMdPath = path.join(reportsDir, `${runId}.md`);
  const reportJsonPath = path.join(reportsDir, `${runId}.json`);

  const report: RealModelLaneReport = {
    runId,
    startedAt: startedIso,
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    models: opts.models,
    scenarioCount: scenarioIds.length,
    scenarioIds,
    rows,
    modelSummaries,
    degraded,
    reportMdPath,
    reportJsonPath,
  };

  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(reportMdPath, renderLaneMarkdown(report), 'utf8');

  return report;
}

/**
 * Render the lane report as a human-readable markdown table
 * (multi-model × multi-scenario metric matrix + summaries), following the
 * benchmarks/reports/ markdown convention (cf. SOAK-068.md).
 */
export function renderLaneMarkdown(rep: RealModelLaneReport): string {
  const line = (s = ''): string => (s.length > 0 ? `${s}\n` : '\n');
  const headerSource = `> 权威需求：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15.1 L2/L3 — fixed real models × 20-50 fixed scenarios, unified §15 L3 collection (reuses task-076 RunResult).`;
  let o = '';
  o += line(`# ${rep.runId}`);
  o += line(`> 任务卡：tasks/082-real-model-lane.md；${headerSource}`);
  o += line(`> 运行窗口：${rep.startedAt} → ${rep.finishedAt}（${rep.durationMs} ms）；模型：${rep.models.map((m) => `${m.displayName}(${m.tier})`).join(' + ')}；场景集 ${rep.scenarioCount} 个。`);
  if (rep.degraded) {
    o += line(`> ⚠️ **降级**：至少一个模型无可用 provider（无凭据/不可达）→ 该档全部行标记 pending-environment，未烧真实配额。`);
  }
  o += line();

  // per-model summary table
  o += line('## 模型↔场景汇总');
  if (rep.modelSummaries.length === 0) {
    o += line('_（无模型）_');
  } else {
    o += line('| 模型 | 应跑 | passed | failed | pending-env | skipped | wall(ms) | toolCalls | inTok | outTok | cacheTok | cost(USD) |');
    o += line('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const s of rep.modelSummaries) {
      o += line(`| ${s.displayName} | ${s.runnableScenarios} | ${s.passed} | ${s.failed} | ${s.pendingEnvironment} | ${s.skipped} | ${s.wallTimeMs} | ${s.toolCalls} | ${s.inputTokens} | ${s.outputTokens} | ${s.cacheReadTokens} | ${s.costUsd} |`);
    }
  }
  o += line();

  // model × scenario matrix
  o += line('## 逐行明细（model × scenario）');
  if (rep.rows.length === 0) {
    o += line('_（无运行行）_');
  } else {
    o += line('| model | scenario | tier | status | wall(ms) | toolCalls | inTok | outTok | cost(USD) | note |');
    o += line('| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const r of rep.rows) {
      const mm = r.result?.metrics;
      o += line(
        `| ${r.modelId} | ${r.scenarioId} | ${r.tier} | ${r.status} | ${mm?.wallTimeMs ?? ''} | ` +
          `${mm?.toolCalls ?? ''} | ${mm?.inputTokens ?? ''} | ${mm?.outputTokens ?? ''} | ${mm?.costUsd ?? ''} | ${r.note ?? ''} |`,
      );
    }
  }
  o += line();
  o += line('> 说明：pending-environment（无凭据降级，不 throw）/ skipped（feature-lane 确定性 mock，枚举不烧配额）。');
  o += line('> assert 级判定（offline lane 职责）不在此重复评估；本 lane 采集 §15 L3 指标与单轮成功信号。');
  return o;
}