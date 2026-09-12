import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type {
  ChatProvider, ChatRequest, ChatResponse, SessionRecord, TeamEndPayload, TeamMemberSummary,
} from '@vessel/shared';
import { Telemetry } from './Telemetry.js';

/**
 * BRIEF —— 新造的三类持久记录「只落盘、无人读」：`finalizeRecord` 只认
 * `tool/result` / `audit/denial` / `compaction/start`，B13 `llm/retry` 记录没有任何回放消费方
 * ⇒ 对「回放」这条通路而言 M05 恒 0。而两份文档点名它们是消费者：
 * `docs/BENCHMARK-SPEC.md` 的 M05 行把来源写成「B13 llm/retry + retry 记录」，
 * `docs/ARCHITECTURE.md` §4.11 把 telemetry 写成 request/header、turn/end 等记录的消费方。
 *
 * 本文件把「记录真的被回放消费」钉成可判别用例，并顺带钉住文档⇄代码的一致性：
 *   ① 纯回放（不挂总线）：只含 `llm/retry` 记录的会话 ⇒ retries 如实计数（改前恒 0 ⇒ 必红）；
 *   ② 防重复计数：同一个重试决策的事件 + 记录同时存在 ⇒ **恰好一次**（两种落盘顺序都验）；
 *   ③ 负对照：既有三类记录的计数逐字不变；既有 `denials=2`（1 事件 + 1 记录相加）用例原样通过；
 *   ④ 真实链路：AgentLoop 的一次重试（事件与记录同源）⇒ 实时跑与纯回放给出同一个数，且
 *     「事件侧可复原的身份 == 记录里的身份」（两端 id/序号口径一旦漂移就先在这里红）；
 *   ⑤ 文档⇄代码守卫：§4.11 表格点名的「回放消费记录集合」必须**等于** `finalizeRecord` 的
 *     `case` 集合（多写一个 ⇒ 红；代码多一个分支没写进文档 ⇒ 也红）；BENCHMARK-SPEC 的 M05 行
 *     点名的 `llm/retry` 必须有分支（只改文字不动代码 ⇒ 红）。
 *
 * 「删哪行会红」：
 *   - 删掉 `Telemetry.finalizeRecord` 里的 `case 'llm/retry':` ⇒ ①④⑤ 红；
 *   - 去掉 `countRetry` 的身份去重（退回"事件一次、记录再一次"的加法）⇒ ②④ 红；
 *   - 事件侧 key 换成别的模板（如 `${turnId}:${attempt}`）⇒ ②④ 红；
 *   - 动既有三条记录的计数分支 ⇒ ③ 与既有用例红（`denials=2`）；
 *   - 只改文档不动代码（或反之）⇒ ⑤ 红。
 *
 * M14（本卡）：`TelemetryCounters.approvalAsks` 此前**没有任何生产者**（全仓无 `+1`、无
 * `approval/asked`(B17)/`approval/decided`(B18) 记录类型、无 A16/A17 事件），却被
 * `benchmarks/scenarios/*.yaml` 列为 `measured`、被 `asserts.ts` 的 `metricValue('M14')`
 * 读走 ⇒ 报告里是一个恒 0 的"被测量"。真实通路是 `before_tool` 的 **ask 裁决**
 * （`policy/engine/Engine.ts` 的 ask 分支 / `EventBus` waterfall 的 `kind:'ask'`），
 * AgentLoop 无应答者 ⇒ fail-closed，落 `audit/denial`(`stage:'approval'`)。本卡把它接成
 * 唯一生产者：回放面 `stage === 'approval'` 计一次（一个 ask 恰好一条记录）。
 *
 * 「删哪行会红」（M14）：
 *   - 删掉 `finalizeRecord` 的 `if (r.stage === 'approval') this.counters.approvalAsks += 1;`
 *     ⇒ ⑥⑧ 红（改前正是这一行不存在，故 ⑥ 原本恒 0）；
 *   - 把 `stage === 'approval'` 放宽成"任何审计拒绝都算"（删掉 stage 判据）⇒ ⑦ 红；
 *   - 把 M14 的 `source` 改回不存在的 `'approval/asked'`（或只改文档）⇒ ⑨ 红。
 *
 * M13（本卡，与 M14 同病灶）：`TelemetryCounters.evaluatorRejects` 此前没有任何生产者
 * （`recordEvaluatorReject()` 全仓唯一命中是它的定义）⇒ 恒 0，却被 `metricValue('M13')` 读走、
 * 被 BENCHMARK-SPEC 列为被测量。本卡查清三条真实通路后接**两条**来源：
 * `team_end` 载荷里 evaluate 成员的 `review.verdict`（`TeamRuntime` 的 058 结论），
 * 以及 `EvaluatorAgent.evaluate()` 的**调用方**（基准/CLI 的 evaluator 臂）用类型化调用
 * `recordEvaluatorReject()` 转交的裁决；`LoopEngine` 的 verdict 不出引擎、也没有调用方转交
 * ⇒ 仍未接线，故 M13 **不覆盖** Goal Loop 的 evaluator 拒绝，规格里已写明该边界）。
 * ⑩⑪ 钉行为、⑫ 钉文档⇄代码。M13 的 `source` 是**中性名**（本卡更正）：它点名"被计数的
 * 事实"（评估器评审的 verdict），不点名某一条传输面 —— 两条来源不同，点名 `team_end` 会让
 * evaluator 臂那个 run 的 metric 行指向一个不是它生产者的来源。
 */

const TELEMETRY_SRC = fileURLToPath(new URL('./Telemetry.ts', import.meta.url));
const ARCHITECTURE_MD = fileURLToPath(new URL('../../../docs/ARCHITECTURE.md', import.meta.url));
const BENCHMARK_SPEC_MD = fileURLToPath(new URL('../../../docs/BENCHMARK-SPEC.md', import.meta.url));

/** 代码事实（不是文档转述）：`finalizeRecord` 的 `case '<记录类型>':` 集合。 */
function finalizedRecordTypes(): string[] {
  const src = fs.readFileSync(TELEMETRY_SRC, 'utf8');
  return [...src.matchAll(/case '([^']+)':/g)].map((m) => m[1]!);
}

type LlmRetryRecord = Extract<SessionRecord, { type: 'llm/retry' }>;
type RetryEvent = { turnId: string; step: number; attempt: number; errorClass: string };

/** 脚本化 chat() provider：按调用序号返回响应或抛错。不实现 stream() ⇒ 走 chat() 分支。 */
class ScriptedProvider implements ChatProvider {
  readonly id = 'scripted';
  calls = 0;
  constructor(private readonly script: (call: number) => ChatResponse | Error) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    const out = this.script(this.calls);
    if (out instanceof Error) throw out;
    return out;
  }
}

function reply(text: string): ChatResponse {
  return { content: text, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
}

/** 与 AgentLoop.callModel 落盘的形状**逐字段同源**（requestId 模板见 EVENT-SPEC §5.C A09）。 */
function retryRecord(requestId: string, attemptNo: number, kind: LlmRetryRecord['kind'], decision: LlmRetryRecord['decision'], backoffMs?: number): LlmRetryRecord {
  return {
    seq: 0, ts: '', type: 'llm/retry', requestId, kind, attemptNo,
    ...(backoffMs === undefined ? {} : { backoffMs }),
    decision, surface: false,
  };
}

describe('telemetry — event subscriber + JSONL report', () => {
  let dir: string;
  let sessionSeq = 0;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-tel-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  /** 每次建会话都用新 sessionId：同一 workspace 下多个 loop 不得共用一份会话日志。 */
  async function openSession(tag: string): Promise<Session> {
    sessionSeq += 1;
    return Session.open({ workspaceRoot: dir, sessionId: `${tag}-${sessionSeq}` });
  }

  it('counts turns/steps/denials from bus events and session replay', async () => {
    const session = await Session.open({ workspaceRoot: dir, sessionId: 't1' });
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);

    await bus.emit('before_turn', {});
    await bus.emit('after_model', { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 } });
    await bus.emit('after_model', { usage: { inputTokens: 50, outputTokens: 10 } });
    await bus.emit('policy_decision', { verdict: 'deny' });
    await session.appendSync({ type: 'audit/denial', toolCallId: 'tc1', toolName: 'Shell', stage: 'rule', reason: 'rm -rf', sandboxMode: 'x', surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'tc2', toolName: 'Read', error: { errorClass: 'INVALID_ARGS', message: 'bad' }, meta: {}, surface: true });

    const c = tel.finalize(session);
    expect(c.turns).toBe(1);
    expect(c.steps).toBe(2);
    expect(c.inputTokens).toBe(150);
    expect(c.outputTokens).toBe(30);
    expect(c.cacheReadTokens).toBe(30);
    expect(c.denials).toBe(2); // 1 from event + 1 from replay record
    expect(c.invalidArgs).toBe(1);

    const metrics = tel.metrics({ durationMs: 123 });
    const m12 = metrics.find((m) => m.metric === 'M12');
    expect(m12?.value).toBe(2);
    const m10 = metrics.find((m) => m.metric === 'M10');
    expect(m10?.value).toBe(123);

    const lines = tel.reportLines({
      runId: 'run_1', scenarioId: 'B001', harness: 'ours', mode: 'offline', ts: '2026-01-01T00:00:00Z',
      metrics, events: [{ kind: 'tool/call', payload: { toolName: 'Read' } }], asserts: [], env: { model: 'm' },
    });
    expect(lines[0]!.type).toBe('meta');
    expect(lines.filter((l) => l.type === 'metric').length).toBeGreaterThan(0);
    expect(lines.some((l) => l.type === 'event')).toBe(true);
    tel.detach();
    await session.close();
  });

  it('① 纯回放：只含 llm/retry 记录的会话 ⇒ retries 如实计数（改前恒 0）', async () => {
    const session = await openSession('t-replay');
    await session.appendSync(retryRecord('req_turn_a_step1', 1, 'RATE_LIMITED', 'retry', 100));
    await session.appendSync(retryRecord('req_turn_a_step1', 2, 'TIMEOUT', 'retry', 200));
    await session.appendSync(retryRecord('req_turn_a_step1', 3, 'SERVER_ERROR', 'abort'));

    // 刻意**不** attach(bus)：这条通路就是"回放"——日志（唯一真源）里有多少次重试决策，
    // M05 就该报多少。改前 finalizeRecord 没有 'llm/retry' 分支 ⇒ 这里恒 0。
    const counters = new Telemetry().finalize(session);
    expect(counters.retries).toBe(3);
    // 其它计数不因这一支而变（turns/steps/toolCalls 都来自实时事件，纯回放里本来就该是 0）
    expect(counters.turns).toBe(0);
    expect(counters.steps).toBe(0);
    expect(counters.toolCalls).toBe(0);
    await session.close();
  });

  it('② 防重复计数：同一重试决策的事件 + 记录同时存在 ⇒ 恰好计一次（两种落盘顺序都验）', async () => {
    const session = await openSession('t-dedupe');
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);

    // 决策 #1 —— AgentLoop 的真实顺序：先落记录，再发事件（同一个 requestId/attemptNo）
    await session.appendSync(retryRecord('req_turn_b_step1', 1, 'TIMEOUT', 'retry', 100));
    await bus.emit('llm_retry', { turnId: 'turn_b', step: 1, attempt: 1, errorClass: 'TIMEOUT' });

    // 决策 #2 —— 反向顺序（事件先到、记录后落）：去重认身份，不认顺序
    await bus.emit('llm_retry', { turnId: 'turn_b', step: 1, attempt: 2, errorClass: 'TIMEOUT' });
    await session.appendSync(retryRecord('req_turn_b_step1', 2, 'TIMEOUT', 'retry', 200));

    const counters = tel.finalize(session);
    // 两个不同的重试决策。若照抄 denials 那套「事件 + 记录相加」，这里会得 4（2 事件 + 2 记录）。
    expect(counters.retries).toBe(2);
    tel.detach();
    await session.close();
  });

  it('③ 负对照：既有三类记录的计数逐字不变，新增分支不串味', async () => {
    const session = await openSession('t-negative');
    await session.appendSync({ type: 'tool/result', toolCallId: 'tc1', toolName: 'Read', error: { errorClass: 'INVALID_ARGS', message: 'bad' }, meta: {}, surface: true });
    await session.appendSync({ type: 'audit/denial', toolCallId: 'tc2', toolName: 'Shell', stage: 'rule', reason: 'rm -rf', surface: false });
    await session.appendSync({ type: 'compaction/start', trigger: 'pressure', surface: false });
    await session.appendSync(retryRecord('req_turn_c_step1', 1, 'NETWORK', 'retry', 100));

    const counters = new Telemetry().finalize(session);
    expect(counters.invalidArgs).toBe(1);
    expect(counters.denials).toBe(1);
    expect(counters.compactions).toBe(1);
    expect(counters.retries).toBe(1);
    // 未被记录族触发的计数一律保持 0
    expect(counters.turns).toBe(0);
    expect(counters.steps).toBe(0);
    expect(counters.toolCalls).toBe(0);
    expect(counters.inputTokens).toBe(0);
    expect(counters.outputTokens).toBe(0);
    await session.close();
  });

  it('④ 真实链路：AgentLoop 的一次重试（事件与记录同源）⇒ 实时与纯回放都恰好计一次', async () => {
    const session = await openSession('t-e2e');
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);
    const seen: RetryEvent[] = [];
    bus.on('llm_retry', (p) => { seen.push(p as RetryEvent); });

    const provider = new ScriptedProvider((call) => (call === 1 ? new Error('rate limit 429') : reply('recovered')));
    const loop = new AgentLoop({
      session,
      bus,
      provider,
      model: 'deps-model-unused',
      buildContext: async () => ({
        model: 'envelope-model',
        messages: [{ role: 'system' as const, content: 'test' }],
        tools: [],
        estimateTokens: 10,
      }),
      runTool: async () => ({ content: '', meta: {} }),
      getVisibleTools: () => [],
      llmRetry: { maxRetries: 3 },
    });

    const result = await loop.runTurn('retry me');
    expect(result.kind).toBe('success');
    expect(provider.calls).toBe(2);

    const recs = session.replay().filter((r): r is LlmRetryRecord => r.type === 'llm/retry');
    expect(recs).toHaveLength(1);
    expect(seen).toHaveLength(1);
    // 事件与记录必须是**同一个事实**的两种写法：文件层身份模板一旦漂移，这里先红。
    expect(seen[0]!.turnId).toBe(result.turnId);
    expect(`req_${seen[0]!.turnId}_step${seen[0]!.step}#${seen[0]!.attempt}`)
      .toBe(`${recs[0]!.requestId}#${recs[0]!.attemptNo}`);

    expect(tel.finalize(session).retries).toBe(1); // 事件 + 记录 ⇒ 恰好一次
    tel.detach();
    expect(new Telemetry().finalize(session).retries).toBe(1); // 同一份日志，纯回放 ⇒ 同一个数
    await session.close();
  });

  it('⑤ 文档⇄代码：§4.11 点名的回放消费集合 == finalizeRecord 的 case 集合；M05 来源名副其实', () => {
    const handled = finalizedRecordTypes();
    expect(handled).toContain('llm/retry');

    // —— docs/ARCHITECTURE.md §4.11 telemetry 行 ——
    const archRow = fs.readFileSync(ARCHITECTURE_MD, 'utf8').split('\n').find((l) => l.includes('telemetry/（会话生命周期'))!;
    expect(archRow).toBeTruthy();
    const duty = archRow.split('|')[2] ?? '';
    const consumed = [...duty.matchAll(/`([a-z]+\/[a-z]+)`/g)].map((m) => m[1]!);
    // 双向绑定：文档点名"已消费"的必须有分支；代码有分支的必须被文档点名。
    expect(new Set(consumed)).toEqual(new Set(handled));
    // 反向：文档说"未消费"的记录类型，代码里不许有分支（否则文档立刻撒谎）
    const unwired = duty.split('未消费')[1] ?? '';
    expect(unwired).not.toBe('');
    const unwiredTypes = [...unwired.matchAll(/([a-z]+\/[a-z]+)/g)].map((m) => m[1]!);
    expect(unwiredTypes).toContain('request/header');
    expect(unwiredTypes).toContain('turn/end');
    for (const t of unwiredTypes) expect(handled).not.toContain(t);

    // —— docs/BENCHMARK-SPEC.md M05 行 ——
    const m05Row = fs.readFileSync(BENCHMARK_SPEC_MD, 'utf8').split('\n').find((l) => l.startsWith('| M05 |'))!;
    expect(m05Row).toBeTruthy();
    expect(m05Row).toContain('llm/retry');
    // 文档点名的来源必须在代码里真有分支（删掉 case ⇒ 本用例与用例①同时红）
    expect(handled).toContain('llm/retry');
  });

  it('⑥ M14 纯回放：`audit/denial`(stage approval) ⇒ approvalAsks 如实计数（改前恒 0）', async () => {
    const session = await openSession('t-m14-replay');
    // 审批询问的两条真实记录形状（AgentLoop.dispatchToolCall 的 ask 分支落盘值）：
    // 规则命中转 ask、profile 要求转 ask，二者都因"无应答者"fail-closed。
    await session.appendSync({
      type: 'audit/denial', toolCallId: 'tc_a', toolName: 'Shell', stage: 'approval',
      ruleRef: 'ask:rm', reason: 'requires approval: ask:rm', surface: false,
    });
    await session.appendSync({
      type: 'audit/denial', toolCallId: 'tc_b', toolName: 'Shell', stage: 'approval',
      ruleRef: undefined, reason: 'requires approval (profile)', surface: false,
    });

    // 刻意**不** attach(bus)：这条通路就是"回放"。改前 `finalizeRecord` 只把 stage:'approval'
    // 的拒绝并进 M12，M14 恒 0 ⇒ 这里必红。
    const tel = new Telemetry();
    const counters = tel.finalize(session);
    expect(counters.approvalAsks).toBe(2);
    // M12 逐字不变：审批拒绝**同样**是拒绝（既有口径，不得因为新增 M14 而少计）。
    expect(counters.denials).toBe(2);

    const m14 = tel.metrics().find((m) => m.metric === 'M14')!;
    expect(m14.value).toBe(2);
    expect(m14.source).toBe('audit/denial:approval'); // 来源点名真实生产者，不再是无人落盘的 `approval/asked`
    expect(m14.detail).toMatchObject({ approval_asks: 2 });
    await session.close();
  });

  it('⑦ 负对照：非 approval 阶段的拒绝绝不进 M14（rule / hook / before_turn 三种 stage）', async () => {
    const session = await openSession('t-m14-negative');
    await session.appendSync({
      type: 'audit/denial', toolCallId: 'tc1', toolName: 'Shell', stage: 'rule',
      ruleRef: 'no-rm', reason: 'denied by rule no-rm', surface: false,
    });
    await session.appendSync({
      type: 'audit/denial', toolCallId: 'tc2', toolName: 'Shell', stage: 'hook',
      ruleRef: 'listener-error:policy:engine', reason: 'listener error', surface: false,
    });
    // 输入级否决：无工具锚点（toolCallId 空串），stage 是 before_turn
    await session.appendSync({
      type: 'audit/denial', toolCallId: '', toolName: '', stage: 'before_turn',
      ruleRef: 'block-input', reason: 'blocked by test listener', surface: false,
    });

    const counters = new Telemetry().finalize(session);
    expect(counters.approvalAsks).toBe(0); // 三种拒绝都不是"审批询问"（删掉 stage 判据 ⇒ 这里变 3 ⇒ 红）
    expect(counters.denials).toBe(3); // M12 逐字不变
    expect(counters.turns).toBe(0);
    await session.close();
  });

  it('⑧ 真实链路：AgentLoop 的 ask 分支（无应答者 ⇒ fail-closed）⇒ 实时与纯回放都恰好计一次', async () => {
    const session = await openSession('t-m14-e2e');
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);
    // 审批询问的真实通路之一：before_tool waterfall 返回 kind:'ask'
    // （Engine 的 `{action:'ask'}` 走同一条链；见 Telemetry.ts 类注释三条逐条位置）。
    bus.on('before_tool', () => ({ kind: 'ask' as const, reason: 'needs approval', ref: 'test:ask' }), 'test:ask');

    // 第 1 步：模型要调一个工具（会被 ask 分支 fail-closed 拒掉）；第 2 步：纯文本收尾。
    const provider = new ScriptedProvider((call) =>
      call === 1
        ? {
            content: '',
            toolCalls: [{ id: 'tc_ask_1', name: 'Stub', arguments: { n: 1 } }],
            finishReason: 'tool_calls' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          }
        : reply('done'),
    );
    const loop = new AgentLoop({
      session,
      bus,
      provider,
      model: 'deps-model-unused',
      buildContext: async () => ({
        model: 'envelope-model',
        messages: [{ role: 'system' as const, content: 'test' }],
        tools: [],
        estimateTokens: 10,
      }),
      runTool: async () => ({ content: 'MUST NOT RUN (ask ⇒ fail-closed)', meta: {} }),
      getVisibleTools: () => [],
    });

    const result = await loop.runTurn('needs approval');
    expect(result.kind).toBe('success');
    expect(provider.calls).toBe(2);
    // 审计面：恰好一条 stage:'approval' 的拒绝（ask 分支的落盘形状）
    const approvals = session.replay().filter((r) => r.type === 'audit/denial' && r.stage === 'approval');
    expect(approvals).toHaveLength(1);

    expect(tel.finalize(session).approvalAsks).toBe(1);
    tel.detach();
    expect(new Telemetry().finalize(session).approvalAsks).toBe(1); // 同一份日志，纯回放 ⇒ 同一个数
    await session.close();
  });

  it('⑨ 文档⇄代码：BENCHMARK-SPEC M14 行点名的来源 == 代码实际计数的来源（只改一侧 ⇒ 红）', () => {
    const m14Row = fs.readFileSync(BENCHMARK_SPEC_MD, 'utf8').split('\n').find((l) => l.startsWith('| M14 |'))!;
    expect(m14Row).toBeTruthy();
    // M14 的实际生产者：`audit/denial` 里 stage:'approval' 的那些（一个 ask 恰好一条）。
    const source = new Telemetry().metrics().find((m) => m.metric === 'M14')!.source;
    expect(source).toBe('audit/denial:approval');
    expect(m14Row).toContain(source); // 文档必须点名**这个**来源，否则文档在撒谎
    // 反向：M14 行不得把本仓不存在的记录/事件写成"自家来源"（无 B17/B18 记录、无 A16/A17 事件）
    expect(m14Row).toContain('未接线');
    // 代码侧确实按 stage 取数（把判据放宽成"任何 audit/denial" ⇒ ⑦ 红；删掉 ⇒ ⑥⑧ 红）
    const src = fs.readFileSync(TELEMETRY_SRC, 'utf8');
    expect(src).toContain("if (r.stage === 'approval') this.counters.approvalAsks += 1;");
  });

  /**
   * M13（本卡）：`TelemetryCounters.evaluatorRejects` 此前**没有任何调用方**
   * （`recordEvaluatorReject()` 全仓唯一命中是它的定义）⇒ 指标恒 0，却被
   * `benchmarks/runners/src/asserts.ts` 的 `metricValue('M13')` 读走、被 BENCHMARK-SPEC 列为被测量。
   * 真实通路有两条且都已接线：① `packages/agents/src/team/TeamRuntime.ts` 的 evaluate 阶段成员
   * 把 `TeamReviewConclusion` 挂进 `team_end` 载荷的 `members[].review`（生产侧由
   * `packages/agents/src/team/team-end-review-verdict.test.ts` 钉住）；② `EvaluatorAgent.evaluate()`
   * 的**调用方**（基准/CLI 的 evaluator 臂，`benchmarks/runners/src/runner.ts`）把返回值经
   * `recordEvaluatorReject()` 入账（该臂不经 TeamRuntime ⇒ 不产 `team_end`，两来源互不重叠）。
   *
   * 「删哪行会红」（M13）：
   *   - 删掉 `attach()` 里的 `bus.on('team_end', …)` 块（或去掉里面的 `this.recordEvaluatorReject()`）
   *     ⇒ ⑩ 红（改前正是这一支不存在 ⇒ M13 恒 0）；
   *   - 把 verdict 过滤放宽成"任何 verdict 都算"（删掉 `EVALUATOR_REJECT_VERDICTS.has(...)`）
   *     ⇒ ⑪ 红；把过滤换成 `subagent_stop`/`isError` 之类近似面 ⇒ ⑩ 红（那些事件在本用例里没有）；
   *   - 把 M13 的 `source` 改成点名**单条传输面**的名字（例如回到 `'team_end:review.verdict'`，
   *     它会让 evaluator 臂那个 run 的 metric 行指向不是它生产者的来源），或只改文档不改代码
   *     （反之亦然）⇒ ⑫ 红。
   */
  const member = (
    memberId: string,
    presetId: string,
    role: TeamMemberSummary['role'],
    phase: TeamMemberSummary['phase'],
    review?: TeamMemberSummary['review'],
  ): TeamMemberSummary => ({
    memberId,
    presetId,
    role,
    phase,
    status: 'completed',
    sessionId: `sess_${memberId}`,
    delegationDepth: 0,
    durationMs: 1,
    output: 'out',
    ...(review === undefined ? {} : { review }),
  });

  const teamEnd = (members: TeamMemberSummary[]): TeamEndPayload => ({
    teamRunId: 'team_1',
    outcome: 'completed',
    members,
    durationMs: 7,
  });

  it('⑩ M13 真实链路：`team_end` 的 evaluate 成员 review.verdict=not_met ⇒ evaluatorRejects 计数（改前恒 0）', async () => {
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);

    await bus.emit('team_end', teamEnd([
      member('developer', 'developer', 'generator', 'generate'),
      member('reviewer', 'reviewer', 'evaluator', 'evaluate', {
        verdict: 'not_met', reason: '验收标准 2 未满足', unmet: ['AC-2'], suggestions: ['补测试'], evidence: [],
      }),
    ]));

    const m13 = tel.metrics().find((m) => m.metric === 'M13')!;
    expect(m13.value).toBe(1); // 改前：recordEvaluatorReject() 无调用方 ⇒ 恒 0
    expect(m13.source).toBe('evaluator-review:verdict'); // 中性名：点名事实，不点名某一条传输面
    // 其它指标不因这一支而变（team_end 不是 turn/tool/denial 事件）
    const counters = tel.finalize(await openSession('t-m13'));
    expect(counters.evaluatorRejects).toBe(1);
    expect(counters.turns).toBe(0);
    expect(counters.toolCalls).toBe(0);
    expect(counters.denials).toBe(0);
    tel.detach();
  });

  it("⑪ 负对照：`met` 与无 `review` 的成员都不进 M13；一次载荷里的多个拒绝逐个计数", async () => {
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);

    // 只有 met 的评审 + 不带 review 的成员 ⇒ M13 必须为 0（删掉 verdict 过滤 ⇒ 这里变 3 ⇒ 红）
    await bus.emit('team_end', teamEnd([
      member('developer', 'developer', 'generator', 'generate'),
      member('reviewer', 'reviewer', 'evaluator', 'evaluate', {
        verdict: 'met', reason: '符合验收', unmet: [], suggestions: [], evidence: [],
      }),
      member('lead', 'lead', 'orchestrator', 'orchestrate'),
    ]));
    expect(tel.metrics().find((m) => m.metric === 'M13')!.value).toBe(0);

    // 一次载荷里两个拒绝（impossible / error）⇒ 计 2（加法口径，且不按不唯一的 presetId/role 去重）
    await bus.emit('team_end', {
      ...teamEnd([
        member('reviewer-a', 'reviewer', 'evaluator', 'evaluate', {
          verdict: 'impossible', reason: '依赖缺失', unmet: [], suggestions: [], evidence: [],
        }),
        member('reviewer-b', 'reviewer', 'evaluator', 'evaluate', {
          verdict: 'error', reason: '产出不是合法 verdict JSON', unmet: [], suggestions: [], evidence: [],
        }),
      ]),
      teamRunId: 'team_2',
    });
    expect(tel.metrics().find((m) => m.metric === 'M13')!.value).toBe(2);
    tel.detach();
  });

  it('⑫ 文档⇄代码：BENCHMARK-SPEC M13 行点名的来源 == 代码实际计数的来源；且只有一处生产者调用', () => {
    const src = fs.readFileSync(TELEMETRY_SRC, 'utf8');
    // 代码事实 1：拒绝词表逐字 = 规格的 {not_met, impossible, error}（改词表 ⇒ 本行红）
    expect(src).toContain("new Set(['not_met', 'impossible', 'error'])");
    // 代码事实 2：唯一的生产者调用在 team_end handler 里（`recordEvaluatorReject()` 再次变成摆设 ⇒ 红）
    const calls = src.match(/this\.recordEvaluatorReject\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(src).toContain("bus.on('team_end'");
    expect(src).toContain("}, 'telemetry:evaluator-rejects'),");

    // 文档侧：M13 行必须点名代码的实际来源，且必须写明**未接线**的那两条通路（否则文档在撒谎）
    const m13Row = fs.readFileSync(BENCHMARK_SPEC_MD, 'utf8').split('\n').find((l) => l.startsWith('| M13 |'))!;
    expect(m13Row).toBeTruthy();
    const source = new Telemetry().metrics().find((m) => m.metric === 'M13')!.source;
    // 中性名（本卡的更正）：M13 有**两条**来源 —— `team_end` handler 与基准/CLI 的 evaluator 臂
    // （`benchmarks/runners/src/runner.ts` 的 `recordEvaluatorReject()` 调用）。改前这里是
    // `'team_end:review.verdict'`，那串会让 evaluator 臂那个 run 的 metric 行指向一个**不是它
    // 生产者**的来源 ⇒ 换成点名"事实"而不是"传输面"的中性名。
    expect(source).toBe('evaluator-review:verdict');
    expect(m13Row).toContain(source);
    expect(m13Row).toContain('未接线');
    expect(m13Row).toContain('not_met'); // 判为拒绝的 verdict 词表写在定义列里
  });

  /**
   * M14 detail 的两个分项（本卡接线）—— `steers` / `interrupts` 此前在 `metrics().detail` 里
   * **硬编码 0**，而二者在本仓**都有真实生产者**（"有产者、无消者"落在指标 detail 层）：
   *   - `steers` 的生产者 = `AgentLoop.drainSteers()` → `user/message{source:'steer'}`（**只有记录面**）
   *   - `interrupts` 的生产者 = `AgentLoop` 收尾的 `after_turn{kind:'interrupted'}`（**事件面**；
   *     同事实的 `turn/end{kind:'interrupted'}` 记录刻意不取，理由见 `Telemetry.ts` 类注释与 ⑭）
   * 另有 `human_answers` / `machine_answers` 两项在本仓**无通路**（无应答者链、无 A16/A17、
   * 无 B17/B18）⇒ detail 里取 `null` 并列进 `detail.unwired`，**不用 0 冒充计数**。
   *
   * 「删哪行会红」（本卡）：
   *   - 删掉 `finalizeRecord` 的 `case 'user/message':`（或里面的 `source === 'steer'` 判据）
   *     ⇒ ⑬ 红（改前正是这一支不存在 ⇒ steers 恒 0）；放宽成"任何 user/message 都算" ⇒ ⑬ 红；
   *   - 删掉 `attach()` 的 `bus.on('after_turn', …)`（或去掉 `kind === 'interrupted'` 判据）
   *     ⇒ ⑭ 红；
   *   - 把 `human_answers`/`machine_answers` 写回 0（或删掉 `detail.unwired`）⇒ ⑮ 红；
   *   - 负对照（本卡硬要求）：`approval_asks` 与 M14 的 `value`/`source` 逐字不变 ⇒ ⑥⑨⑮ 同时钉住
   *     （把分项并进 `value` 会先红在 ⑮）。
   */
  it('⑬ M14 steers 纯回放：`user/message{source:steer}` 逐条计数，其它 source 一条都不算（改前恒 0）', async () => {
    const session = await openSession('t-m14-steers');
    const steer = (content: string, i: number) => ({
      type: 'user/message' as const, msgId: `m_steer_${i}`, role: 'user' as const,
      content, source: 'steer' as const, surface: true as const,
    });
    await session.appendSync(steer('把范围缩小到 backend', 1));
    await session.appendSync(steer('先跑测试再继续', 2));
    // 负对照：同一个记录族里的其它 source 都不是"人工干预"（`MESSAGE_SOURCES` 的其余取值）
    await session.appendSync({ type: 'user/message', msgId: 'm_plain', role: 'user', content: '原始输入', surface: true });
    await session.appendSync({ type: 'user/message', msgId: 'm_inject', role: 'user', content: '评估结论：met', source: 'inject', surface: true });
    await session.appendSync({ type: 'user/message', msgId: 'm_handoff', role: 'user', content: 'handoff 续跑上下文', source: 'handoff', surface: true });

    // 刻意**不** attach(bus)：steer 这条事实只有记录面（`drainSteers` 不发事件），
    // 与 `approval_asks` 同为"只由 append-only 日志计数"。改前没有 user/message 分支 ⇒ 恒 0。
    const tel = new Telemetry();
    const counters = tel.finalize(session);
    expect(counters.steers).toBe(2);
    // 负对照：同一份日志里的其它计数不受这一支影响
    expect(counters.turns).toBe(0); // turns 来自实时事件，纯回放本来就该是 0
    expect(counters.approvalAsks).toBe(0);
    expect(counters.denials).toBe(0);

    const m14 = tel.metrics().find((m) => m.metric === 'M14')!;
    expect(m14.value).toBe(0); // value 仍 = approval_asks（本卡不动口径），不因 steer 变成 2
    expect(m14.detail).toMatchObject({ steers: 2, approval_asks: 0, interrupts: 0 });
    await session.close();
  });

  it('⑭ M14 interrupts 真实链路：被打断的回合 ⇒ after_turn 事件计一次；纯回放如实为 0（本卡写明的边界）', async () => {
    const session = await openSession('t-m14-interrupts');
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);

    // 模型每步都要求调工具（脚本化 provider 无 stream ⇒ 走 chat 分支，after_model 在每次模型调用后 emit）。
    const provider = new ScriptedProvider(() => ({
      content: '',
      toolCalls: [{ id: 'tc_int_1', name: 'Stub', arguments: { n: 1 } }],
      finishReason: 'tool_calls' as const,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const loop = new AgentLoop({
      session,
      bus,
      provider,
      model: 'deps-model-unused',
      buildContext: async () => ({
        model: 'envelope-model',
        messages: [{ role: 'system' as const, content: 'test' }],
        tools: [],
        estimateTokens: 10,
      }),
      runTool: async () => ({ content: 'tool ran', meta: {} }),
      getVisibleTools: () => [],
    });

    // 外部干预的真实入口：CLI Ctrl+C / POST /interrupt / web Stop 都调 `loop.interrupt()`。
    // 这里在 `after_model` 之后落地 ⇒ 回合在下一个步边界收尾 kind='interrupted'
    // （与 `packages/core/src/agent-loop/AgentLoop.interrupt.test.ts` 的既有形态同源）。
    let interrupted = false;
    bus.on('after_model', () => {
      interrupted = loop.interrupt();
    }, 'test:interrupt-driver');

    const result = await loop.runTurn('打断我');
    expect(result.kind).toBe('interrupted'); // 三处同源：TurnResult / turn/end / after_turn
    expect(interrupted).toBe(true); // 打断确实打中了在跑的回合（不是在空转）

    expect(tel.finalize(session).interrupts).toBe(1);
    tel.detach();

    // 本卡如实写出的边界：同一份日志**纯回放**（未 attach 总线）⇒ 0。
    // 不为此去给 `finalizeRecord` 加 turn/end 分支：那会放宽 ARCHITECTURE §4.11 的既有判据，
    // 且 `Session.loadExisting` 会为未闭合回合**合成**一条同形记录（崩溃恢复 ≠ 人工打断）。
    expect(new Telemetry().finalize(session).interrupts).toBe(0);
    // 记录侧面**确实存在**（不是"没这回事"）：这条 turn/end 就在日志里，只是本卡刻意不消费它。
    expect(session.replay().filter((r) => r.type === 'turn/end' && r.kind === 'interrupted')).toHaveLength(1);
    await session.close();
  });

  it('⑮ M14 负对照 + 无通路两项：approval_asks 逐字不变；human_answers / machine_answers 不再用 0 冒充', async () => {
    const session = await openSession('t-m14-detail-negative');
    // 一份"三种事实都有"的日志：1 条审批拒绝（approval_asks）+ 2 条 steer + 1 条 inject
    await session.appendSync({
      type: 'audit/denial', toolCallId: 'tc_a', toolName: 'Shell', stage: 'approval',
      ruleRef: 'ask:rm', reason: 'requires approval: ask:rm', surface: false,
    });
    await session.appendSync({ type: 'user/message', msgId: 'm_s1', role: 'user', content: 's1', source: 'steer', surface: true });
    await session.appendSync({ type: 'user/message', msgId: 'm_s2', role: 'user', content: 's2', source: 'steer', surface: true });
    await session.appendSync({ type: 'user/message', msgId: 'm_i1', role: 'user', content: 'i1', source: 'inject', surface: true });

    const tel = new Telemetry();
    const counters = tel.finalize(session);
    // 负对照（本卡硬要求）：上一卡刚接的 approval_asks 计数值**逐字不变**（新增分支不串味）
    expect(counters.approvalAsks).toBe(1);
    expect(counters.denials).toBe(1); // M12 同样不变
    expect(counters.steers).toBe(2);

    const m14 = tel.metrics().find((m) => m.metric === 'M14')!;
    expect(m14.value).toBe(1); // value 仍 = approval_asks（含 2 条 steer 也不并进 value）
    expect(m14.source).toBe('audit/denial:approval'); // source 仍点名 value 的生产者
    const detail = m14.detail as Record<string, unknown>;
    expect(detail.steers).toBe(2);
    expect(detail.approval_asks).toBe(1);
    expect(detail.interrupts).toBe(0); // 本用例没挂总线、也没有被打断的回合
    // 无通路的两项：必须是"不可判定"（null），不是"测得 0 次"
    expect(detail.human_answers).toBeNull();
    expect(detail.machine_answers).toBeNull();
    expect(detail.unwired).toEqual(['human_answers', 'machine_answers']);
    await session.close();
  });
});
