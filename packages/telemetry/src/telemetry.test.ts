import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type { ChatProvider, ChatRequest, ChatResponse, SessionRecord } from '@vessel/shared';
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
});
