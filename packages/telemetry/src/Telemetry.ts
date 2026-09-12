import type {
  MetricId,
  MetricValue,
  ReportLine,
  SessionRecord,
} from '@vessel/shared';
import type { EventBus } from '@vessel/core';
import { EventBus as Bus, Session } from '@vessel/core';

export interface TelemetryCounters {
  turns: number;
  steps: number;
  toolCalls: number;
  retries: number;
  invalidArgs: number;
  denials: number;
  compactions: number;
  evaluatorRejects: number;
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
 * `audit/denial`（M12）、`compaction/start`（M09）、`llm/retry`（M05，B13）。
 * 这一集合与 `docs/ARCHITECTURE.md` §4.11 表格那一行**双向绑定**，由 `telemetry.test.ts`
 * 的文档⇄代码守用例钉住（文档多写一个 ⇒ 红；代码多一个分支没写进文档 ⇒ 也红）。
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
    );
  }

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
      { metric: 'M13', name: 'EvaluatorRejects', value: c.evaluatorRejects, unit: 'count', source: 'evaluator' },
      { metric: 'M14', name: 'Autonomy', value: c.approvalAsks, unit: 'count', source: 'approval/asked', detail: { steers: 0, approval_asks: c.approvalAsks, interrupts: 0, human_answers: 0, machine_answers: 0 } },
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
