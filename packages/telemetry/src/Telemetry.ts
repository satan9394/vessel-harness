import type {
  MetricId,
  MetricValue,
  ReportLine,
  SessionRecord,
} from '@vessel/shared';
import type { EventBus } from '@vessel/core';
import { EventBus as Bus, Session } from '@vessel/core';

/**
 * M13 判为「评审拒绝」的 verdict 子集 —— 与 `docs/BENCHMARK-SPEC.md` §4.1 M13 行逐字同词表
 * （四个 verdict 里除去 `met` 的三个：`not_met` / `impossible` / `error`）。
 * 单一实现：`attach()` 的 `team_end` handler 用它过滤（`telemetry.test.ts` ⑫ 把三值与规格逐字对钉）。
 */
const EVALUATOR_REJECT_VERDICTS: ReadonlySet<string> = new Set(['not_met', 'impossible', 'error']);

export interface TelemetryCounters {
  turns: number;
  steps: number;
  toolCalls: number;
  retries: number;
  invalidArgs: number;
  denials: number;
  compactions: number;
  evaluatorRejects: number;
  /** M14 的 `approval_asks`：审批询问次数 = `audit/denial` 中 `stage:'approval'` 的条数（见类注释）。 */
  approvalAsks: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * telemetry — event subscriber (emit bypass, ARCHITECTURE §4.11).
 * Computes BENCHMARK-SPEC M02–M14 (subset available offline) from bus events +
 * session replay; exports JSONL report lines (§4.2 format).
 *
 * 回放面（`finalize` → `finalizeRecord`）**已消费**的记录类型 = `tool/result`（M04）、
 * `audit/denial`（M12 + M14 的 approval 子集）、`compaction/start`（M09）、`llm/retry`（M05，B13）。
 * 这一集合与 `docs/ARCHITECTURE.md` §4.11 表格那一行**双向绑定**，由 `telemetry.test.ts`
 * 的文档⇄代码守用例钉住（文档多写一个 ⇒ 红；代码多一个分支没写进文档 ⇒ 也红）。
 *
 * M14 `approvalAsks` 的生产者（本卡接线；此前**无任何 `+1` 的地方**，指标恒 0 却仍被
 * `benchmarks/scenarios/*.yaml` 列为 `measured`）：
 *
 * 真实通路 = **`before_tool` 的 `ask` 裁决**，三处逐条可查：
 *  ① `packages/policy/src/engine/Engine.ts` 决策序第 ④/⑥ 步：`ask` 规则命中、或 profile
 *     要求而 `approval !== 'never'` ⇒ 返回 `{action:'ask'}`（`approval: 'ask'` 由 policy yaml /
 *     sessionOverrides 配置得出，默认 `never` 时该分支走 deny，不产 ask）；
 *  ② `packages/core/src/events/EventBus.ts` 的 waterfall 也可铸出 `{kind:'ask'}`
 *     （`listenerErrorPolicy:'ask'`、guard 收窄）；
 *  ③ `packages/core/src/agent-loop/AgentLoop.ts` 的 `gate.result.kind === 'ask'` 分支：
 *     v0.1 无应答者链 ⇒ 服务内 fail-closed，**落 `audit/denial`（`stage:'approval'`）** 并 emit
 *     `policy_decision`(verdict `'deny'`)，一个 ask 恰好一条记录。
 *     可达性有既有用例钉住：`AgentLoop.denial-breaker.test.ts` 用例⑧。
 *
 * 为什么**只从回放记录计**、且**不照抄 `denials` 的加法**（这是本卡读清后作出的取舍）：
 *  - 仓里**没有** `approval/asked`(B17)/`approval/decided`(B18) 记录类型，也没有 A16/A17 事件，
 *    更没有 `ctx.approval`/应答者链（`docs/EVENT-SPEC.md`、`POLICY-SPEC.md` 只描述了它们）——
 *    所以「ask」**没有独立的第二份证据**。那条 `policy_decision` 事件的 `verdict` 逐字是
 *    `'deny'`（`AgentLoop.recordDenial`），**它就是那次拒绝本身**：按 `denials` 的加法把它也
 *    记进 M14，等于让同一个事实既充当 M12 又充当 M14，且一次 ask 报成 2。
 *  - 记账法在仓里是**已知的、消费方要绕开的**语义（`denials` 测试注释逐字写着 "1 from event +
 *    1 from replay record"，`benchmarks/runners/src/contracts/vessel.ts` 用 `Math.max` 绕开）。
 *    新指标不继承它：`llm/retry` 那张卡已经为「新增计数」定下方向（同一事实只计一次）。
 *  - 但**不去重也不行**：M05 能按 `requestId#attemptNo` 去重，是因为两侧共享一个**全局唯一** id；
 *    ask 的两侧只有 `toolCallId`，而它**不唯一**（`toolCallId` 逐字来自 provider，`MockProvider`
 *    每次响应都从 `tc_mock_1` 重新编号）⇒ 用它当身份会把不同步/不同轮的两个 ask 静默并成一个
 *    **少计**（`countRetry` 注释明令"绝不静默少计"）。
 *  - 结论：M14 取**唯一不留歧义的那一面**——append-only 日志里 `stage:'approval'` 的
 *    `audit/denial` 条数（一个 ask 恰好一条，无需 dedupe）。这与 M04(`invalidArgs`)、M09
 *    (`compactions`) 同为"只由回放记录计数"的既有形态；生产消费方一律先 `finalize(session)`
 *    再读 `metrics()`（`benchmarks/runners/src/runner.ts`、`contracts/vessel.ts`），故无缺口。
 *  - **不得**在无此记录时伪造数值：`approval: 'never'` 的运行里 Engine 直接走 deny
 *    （`decisionPath` 带 `approval:never`、stage 仍 `'rule'`），M14 如实为 0。
 *
 * M13 `evaluatorRejects` 的生产者（本卡接线；此前 `recordEvaluatorReject()` **全仓唯一命中是它的定义**，
 * 指标恒 0，却被 `benchmarks/runners/src/asserts.ts` 的 `metricValue('M13')` 读走、被
 * `docs/BENCHMARK-SPEC.md` 的 M13 行列为被测量）：
 *
 * 「评估器拒绝」在本仓有**三处**真实通路，逐条给位置与**可观测性**：
 *  ① `packages/agents/src/team/TeamRuntime.ts` 的 evaluate 阶段成员：产出按 review JSON schema 解析为
 *     `TeamReviewConclusion`（`review.verdict ∈ {met, not_met, impossible, error}`），随 **`team_end`
 *     事件载荷**的 `members[].review` 一起对外 ⇒ **总线可观测**。生产侧由
 *     `packages/agents/src/team/team-end-review-verdict.test.ts` 钉住（断言真实跑出的 `team_end`
 *     载荷里确有 `review.verdict`）。本卡只取这一面。
 *  ② `packages/agents/src/evaluator/EvaluatorAgent.ts` 的 `evaluate()`：verdict 只**返回给调用方**；
 *     总线上只有 A23/A24（`subagent_start`/`subagent_stop`），而 A24 载荷 `{output, stopReason, isError}`
 *     **不含 verdict** —— `not_met` 且回合正常结束时 `isError=false`、`stopReason='completed'`，与 `met`
 *     逐字同形 ⇒ **不可观测**。该载荷形状另有既有用例钉死（`evaluator-agent.test.ts` 断言
 *     `Object.keys(result)` 恰好是 `['output','stopReason']`），本卡不得为凑指标去改它。
 *  ③ `packages/engine/src/real-evaluator-adapter.ts`（LoopEngine 的 Evaluator seam）：verdict 只在引擎
 *     内部消费，既不 emit 也不落 Session 记录 ⇒ **不可观测**。
 * 故 M13 = ①（且只取 ①）：②③ 没有可消费的面，硬凑（解析 runner 回投的 `user/message` 自由文本、
 * 或按 `subagent_stop.isError` 近似）会引入假阳性或静默少计 —— 判据层绝不允许。
 * 因此 M13 **不覆盖 Goal Loop 的 evaluator 拒绝**，`BENCHMARK-SPEC` 的 M13 行已把这条边界写清。
 *
 * 为什么 M13 取**加法**、不做身份去重（照 M14 那套"先读清职责再取舍"）：
 *  - `team_end` 是这一事实的**唯一**观测面（全仓只有本文件的 handler 计它），不存在"同一事实两份证据"，
 *    所以不需要 M05 那套身份去重；
 *  - 也**不能**拿不唯一的 key 去重：成员摘要的 `presetId`/`role` 都不唯一（两个 evaluate 成员可以同名
 *    同角色），用它去重会把两次真实评审静默并成一次 ⇒ **少计**；
 *  - 计数口径 = 一次 `team_end` 载荷里 `review.verdict ∈ {not_met, impossible, error}` 的成员数
 *    （`met` 不是拒绝；不带 `review` 的成员不是评审成员）。`TeamRuntime.runTeam` 的 `finally` 只 emit
 *    一次 `team_end`，故按事件逐次计数与既有 `turns`/`toolCalls` 的加法口径一致。
 *  - 边界记录：`docs/ARCHITECTURE.md` §4.11 的事件清单（before_turn / after_model / after_tool /
 *    policy_decision / llm_retry）**尚未含 `team_end`** —— 该文件不在本卡改动范围，已如实记入交付报告。
 *
 * **刻意不消费**的三类新造记录（已落盘，但没有回放消费方——理由不是"以后再说"，是各自的取值面
 * 决定了照抄会造假）：
 *  - `request/header`（B12）：只承载 `estimateTokens`（组装时的**估计值**）与 messages/tools 的
 *    **条数**，没有任何实际 usage ⇒ 喂用量账本（M06/M07/M08）等于拿估计冒充实测；
 *  - `turn/end`（B09）`stats.tokensUsed`/`costEstimate` 加法字段：那是**每轮汇总**，而用量已按
 *    `after_model` 的**每次调用**累加（`recordUsage`）⇒ 相加即双计，且本仓没有对应指标定义；
 *  - `turn/end.toolCallsWithoutEnd`：流末兜底收尾的完整性信号，同样没有指标定义。
 *    将来要接线，必须同时改本节、§4.11 表格与那条守用例。
 */
export class Telemetry {
  private counters: TelemetryCounters = {
    turns: 0, steps: 0, toolCalls: 0, retries: 0, invalidArgs: 0, denials: 0,
    compactions: 0, evaluatorRejects: 0, approvalAsks: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  };

  private unsubs: (() => void)[] = [];

  /**
   * 重试族（`llm_retry` 总线事件 ∪ B13 `llm/retry` 记录）的**事实身份集**。
   *
   * 为什么必须有它：同一个重试决策在运行时**同时**产生一条记录与一个事件
   * （`AgentLoop.callModel`：先 `session.appendSync({ type:'llm/retry', … })`、再
   * `bus.emit('llm_retry', …)`，同一个 attempt 序号、同一次逻辑请求），而 `finalize` 把回放记录
   * 折进**已经**累计过实时事件的计数器 ⇒ 不做身份去重，一次重试会被计两次。
   *
   * 为什么不照抄 `denials` 的规则：`audit/denial` 记录与 `policy_decision`(deny) 事件同样是同一次
   * 拒绝的 1:1 两面（`AgentLoop.recordDenial`），而既有用例把"两路相加 = 2"**钉死**了
   * （`telemetry.test.ts` 的 `denials=2`，注释逐字写着"1 from event + 1 from replay record"），
   * 消费方只能自己绕开（`benchmarks/runners/src/contracts/vessel.ts` 用
   * `Math.max(records, counters.denials)`）——那是既有记录的语义，**本卡不得改动**（负对照③⑤）。
   * 因此 M05 这一族采取身份去重：事件与记录同时存在时**恰好计一次**，且实时跑与纯回放给出同一个数。
   *
   * 身份 = `requestId#attemptNo`，两侧同源：EVENT-SPEC §5.C A09 的既定约定
   * `requestId = req_<turnId>_step<step>`（`packages/shared/src/events.ts` 的 B13/A09 注记同文），
   * 事件侧由同一模板从载荷 `{turnId, step, attempt}` 复原，记录侧直接用其 `requestId`/`attemptNo`。
   * `turnId` 全局唯一（`turn_<epoch>_<rand>`）⇒ 跨会话不会把两次重试误判成同一事实。
   */
  private retryKeys = new Set<string>();

  attach(bus: Bus): void {
    this.unsubs.push(
      bus.on('before_turn', () => { this.counters.turns += 1; }),
      bus.on('after_model', (_p, _c) => { this.counters.steps += 1; }, 'telemetry:steps'),
      bus.on('after_model', (p) => {
        const payload = p as { usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } };
        if (payload.usage) {
          this.recordUsage(payload.usage.inputTokens ?? 0, payload.usage.outputTokens ?? 0, payload.usage.cacheReadTokens);
        }
      }, 'telemetry:usage'),
      bus.on('after_tool', () => { this.counters.toolCalls += 1; }, 'telemetry:toolcalls'),
      bus.on('llm_retry', (p) => {
        const { turnId, step, attempt } = (p ?? {}) as { turnId?: unknown; step?: unknown; attempt?: unknown };
        // 身份齐全 ⇒ 按身份去重（与 `llm/retry` 记录同一套 key）；形状不认识（非本仓生产的事件）
        // ⇒ 保持既有"每个事件计一次"，绝不静默少计。
        this.countRetry(
          typeof turnId === 'string' && typeof step === 'number' && typeof attempt === 'number'
            ? `req_${turnId}_step${step}#${attempt}`
            : null,
        );
      }, 'telemetry:retries'),
      bus.on('policy_decision', (p) => {
        const payload = p as { verdict?: string };
        if (payload.verdict === 'deny') this.counters.denials += 1;
      }, 'telemetry:denials'),
      // M13 的**唯一**生产者入口（见类注释「M13 evaluatorRejects 的生产者」）：
      // `team_end` 的逐成员摘要里，evaluate 成员携带 `review`（`TeamReviewConclusion`，
      // `TeamRuntime` 用 `parseReviewConclusion` 从该成员的产出解析）。只认被明确判为拒绝的三个
      // verdict；`met` 不是拒绝，不带 `review` 的成员（generator/orchestrator）根本不是评审结论。
      bus.on('team_end', (p) => {
        const payload = (p ?? {}) as { members?: readonly { review?: { verdict?: unknown } }[] };
        for (const member of payload.members ?? []) {
          const verdict = member?.review?.verdict;
          if (typeof verdict === 'string' && EVALUATOR_REJECT_VERDICTS.has(verdict)) {
            this.recordEvaluatorReject();
          }
        }
      }, 'telemetry:evaluator-rejects'),
    );
  }

  /**
   * M13 计数入口。生产者**唯一** = `attach()` 的 `team_end` handler（`team_end` 载荷里
   * `review.verdict` 为拒绝的 evaluate 成员，一次一个）。本方法此前无任何调用方（指标恒 0），
   * 接线后仍保持"只有这一处调用"由 `telemetry.test.ts` ⑫ 钉住。
   */
  recordEvaluatorReject(): void {
    this.counters.evaluatorRejects += 1;
  }

  recordUsage(input: number, output: number, cacheRead?: number): void {
    this.counters.inputTokens += input;
    this.counters.outputTokens += output;
    this.counters.cacheReadTokens += (cacheRead ?? 0);
  }

  /**
   * 重试族的**唯一**计数入口（事件与记录共用；见 `retryKeys`）。
   * `identity === null` = 事件形状不认识 ⇒ 退回既有"每个事件计一次"，不参与去重。
   */
  private countRetry(identity: string | null): void {
    if (identity === null) {
      this.counters.retries += 1;
      return;
    }
    if (this.retryKeys.has(identity)) return;
    this.retryKeys.add(identity);
    this.counters.retries += 1;
  }

  finalize(session: Session): TelemetryCounters {
    const replay = session.replay();
    for (const r of replay) {
      this.finalizeRecord(r);
    }
    return { ...this.counters };
  }

  private finalizeRecord(r: SessionRecord): void {
    switch (r.type) {
      case 'tool/result':
        if (r.error?.errorClass === 'INVALID_ARGS') this.counters.invalidArgs += 1;
        break;
      case 'audit/denial':
        this.counters.denials += 1;
        // M14 生产者的**唯一**落点：`stage:'approval'` = AgentLoop 的 ask 分支
        // （Ask 裁决无应答者 ⇒ fail-closed 收口）。见类注释「M14 approvalAsks 的生产者」。
        // 只认这一个 stage：`'rule'`/`'hook'`（拒绝来自规则/监听器）与 `'before_turn'`
        // （输入级否决，无工具锚点）都不是审批询问。
        if (r.stage === 'approval') this.counters.approvalAsks += 1;
        break;
      case 'compaction/start':
        this.counters.compactions += 1;
        break;
      case 'llm/retry':
        // B13 记录与 `llm_retry` 事件是**同一个事实**的两面 ⇒ 走同一个身份集去重（见 retryKeys）。
        // 没有这一支时，纯回放（未挂总线）的会话永远报 M05=0：日志说得清"重试了几次"，
        // 指标却看不见——本仓"新造了 X、没人调用 X"落在记录层的实例。
        this.countRetry(`${r.requestId}#${r.attemptNo}`);
        break;
      default:
        break;
    }
  }

  metrics(extra?: { durationMs?: number; time?: number }): MetricValue[] {
    const c = this.counters;
    const out: MetricValue[] = [
      { metric: 'M02', name: 'Turns', value: c.turns, unit: 'turn', source: 'before_turn' },
      { metric: 'M03', name: 'ToolCalls', value: c.toolCalls, unit: 'count', source: 'after_tool' },
      { metric: 'M04', name: 'InvalidToolCalls', value: c.invalidArgs, unit: 'count', source: 'tool/result:INVALID_ARGS' },
      { metric: 'M05', name: 'Retries', value: c.retries, unit: 'count', source: 'llm_retry' },
      { metric: 'M06', name: 'InputTokens', value: c.inputTokens, unit: 'token', source: 'usage-ledger', detail: { cacheRead: c.cacheReadTokens } },
      { metric: 'M07', name: 'OutputTokens', value: c.outputTokens, unit: 'token', source: 'usage-ledger' },
      { metric: 'M09', name: 'Compactions', value: c.compactions, unit: 'count', source: 'compaction/start' },
      { metric: 'M12', name: 'SafetyViolations', value: c.denials, unit: 'count', source: 'audit/denial' },
      { metric: 'M13', name: 'EvaluatorRejects', value: c.evaluatorRejects, unit: 'count', source: 'team_end:review.verdict' },
      { metric: 'M14', name: 'Autonomy', value: c.approvalAsks, unit: 'count', source: 'audit/denial:approval', detail: { steers: 0, approval_asks: c.approvalAsks, interrupts: 0, human_answers: 0, machine_answers: 0 } },
    ];
    if (extra?.durationMs !== undefined) {
      out.push({ metric: 'M10', name: 'Time', value: extra.durationMs, unit: 'ms', source: 'runner-timer' });
    }
    return out;
  }

  reportLines(opts: {
    runId: string;
    scenarioId: string;
    harness: string;
    mode: 'offline' | 'live';
    ts: string;
    metrics: MetricValue[];
    events: { kind: string; payload: Record<string, unknown> }[];
    asserts: ReportLine[];
    env: Record<string, unknown>;
  }): ReportLine[] {
    const meta: ReportLine = {
      type: 'meta', runId: opts.runId, ts: opts.ts, scenarioId: opts.scenarioId,
      harness: opts.harness, arm: null, mode: opts.mode, env: opts.env,
    };
    const metricLines: ReportLine[] = opts.metrics.map((m) => ({
      type: 'metric', runId: opts.runId, ts: opts.ts, metric: m.metric as MetricId,
      name: m.name, value: m.value, unit: m.unit, source: m.source,
      approx: m.approx, detail: m.detail,
    }));
    const eventLines: ReportLine[] = opts.events.map((e) => ({
      type: 'event', runId: opts.runId, ts: opts.ts, kind: e.kind, payload: e.payload,
    }));
    return [meta, ...metricLines, ...eventLines, ...opts.asserts];
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}

export type { EventBus };
