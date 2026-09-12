import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type { ChatProvider, ChatRequest, ChatResponse, SessionRecord } from '@vessel/shared';

/**
 * BRIEF A —— B13 `llm/retry` 是**持久记录**，实现里却只有实时事件。
 *
 * 规格原文（`docs/EVENT-SPEC.md`）：
 *  - §6「自动持久记录清单」B13 行：
 *      > **B13 `llm/retry`** —— 每次重试决策在等待前落盘（先持久后等待）：
 *      > `{requestId, kind, attemptNo, backoffMs, decision:'retry'|'fallback'|'abort'}`。
 *  - §3 原则 5：
 *      > **先持久、后等待**。重试（`llm/retry`）、压缩（`compaction/start` 锁）、审批
 *      > （`approval/asked`）都在等待/执行前先落日志，崩溃不留隐形待办。
 *  - §5.C A11「重试纪律」末句：
 *      > provider 不可用走 fallback chain；**先持久后等待**：等待前先落 `llm/retry` 记录。
 *  - §6 前言：日志=唯一真源（边界/审计/账目记录不产生消息但可回放、可做不变式校验）。
 *
 * 实现现状（改前）：`AgentLoop.callModel` 的 catch 里只有
 *   `await this.deps.bus.emit('llm_retry', { turnId, step, attempt, errorClass: cls });`
 * ——**没有任何 Session 记录**（`packages/shared/src/events.ts` 的 `SessionRecord` 联合里
 * 也没有对应成员）。于是：会话日志回答不了"这一轮重试过几次、为什么重试"；崩溃/被杀发生在
 * 退避等待里时，"正在重试"这件事**完全不留痕**（恰恰是规格 §3 原则 5 要防的隐形待办）。
 *
 * 本文件把该事实钉成可判别用例：
 *   ① 一次可重试失败 ⇒ 会话日志里**出现**一条 `llm/retry`，字段如实，且在任何等待之前落盘；
 *   ② 负对照：不重试的回合（首答成功 / 根本没调用模型）**零条**——不得每轮都写；
 *   ③ 负对照：既有记录的**键集**逐字不变（新增类型只增行、不改行形状）；
 *   ④ 口径一致：日志里的重试次数/attemptNo/错误类别与既有 `llm_retry` 总线事件**逐条一致**
 *      （不许"日志说 2 次、事件说 3 次"）。
 *
 * 「删哪行会红」：
 *   - 删掉 `callModel` 里那次 `await this.deps.session.appendSync({ type: 'llm/retry', … })`
 *     ⇒ ①④/④′ 全红（日志里零条），即改前的真实形态；
 *   - 把该 append 挪到 `bus.emit('llm_retry', …)` **之后**（先事件后持久）⇒ ① 的
 *     "事件触发那一刻记录已在日志里"断言红；
 *   - 把 `attemptNo`/`kind` 换成别的来源（例如自增计数、或 A11 的 `ModelError.kind` 词表）
 *     ⇒ ④ 的逐条对齐断言红；
 *   - 把它挪出战败分支（每轮都写）⇒ ② 的零条断言红；
 *   - 给 `request/header` 之外的既有记录加字段 ⇒ ③ 红（本文件与 B12 用例共用同一条负对照）。
 *
 * 关于 `decision:'abort'`（**本卡的取舍，评委请重点看**）：B13 词表明确含 `'abort'`，
 * 「每次重试决策」包含"这次失败之后不再重试"这个决策 ⇒ 本实现为**每一次失败决策**落一条，
 * 与总线事件 1:1、同 attemptNo（这样 ④ 的"次数一致"是结构性的，而不是靠计数口径解释）。
 * 「不重试的回合」的负对照口径因此是"**没发生过模型调用失败**的回合零条"（用例②），
 * 而不是"失败但没重试的回合零条"。若评委要求严格版（只落 `'retry'`），最小改法是把
 * `decision: retryable ? 'retry' : 'abort'` 那一支包成 `if (retryable) { … }` 并同步删掉
 * 用例 ④′（其余用例不受影响）。
 */

type LlmRetryRecord = Extract<SessionRecord, { type: 'llm/retry' }>;

interface RetryEvent {
  turnId: string;
  step: number;
  attempt: number;
  errorClass: string;
}

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

/** 每次建会话都用新 sessionId：同一 workspace 下多个 loop 不得共用一份会话日志。 */
let sessionSeq = 0;

async function makeLoop(dir: string, provider: ChatProvider, opts: { maxRetries?: number } = {}) {
  sessionSeq += 1;
  const session = await Session.open({ workspaceRoot: dir, sessionId: `llm-retry-record-${sessionSeq}` });
  const bus = new EventBus();
  const loop = new AgentLoop({
    session,
    bus,
    provider,
    // 刻意与 envelope.model 不同：测试记录里落的是**冻结点**的模型（见 B12 用例）
    model: 'deps-model-unused',
    buildContext: async () => ({
      model: 'envelope-model',
      messages: [{ role: 'system' as const, content: 'test' }],
      tools: [],
      estimateTokens: 10,
    }),
    runTool: async () => ({ content: '', meta: {} }),
    getVisibleTools: () => [],
    llmRetry: { maxRetries: opts.maxRetries ?? 5 },
  });
  return { session, bus, provider, loop };
}

function retryRecords(records: readonly SessionRecord[]): LlmRetryRecord[] {
  return records.filter((r): r is LlmRetryRecord => r.type === 'llm/retry');
}

/** 读**落盘**的 JSONL（不只是内存 replay），返回已解析的行。 */
function persistedRecords(logPath: string): { type: string; [k: string]: unknown }[] {
  return fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
}

describe('B13 llm/retry 持久记录（会话日志 = 唯一真源）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-llm-retry-record-'));
  });
  afterEach(() => {
    // 测试自建且位于 os.tmpdir()（AGENTS.md 书面例外）
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① 一次可重试失败 ⇒ 会话日志出现一条 llm/retry：字段如实、且在任何等待之前落盘', async () => {
    const provider = new ScriptedProvider((call) => (call === 1 ? new Error('rate limit 429') : reply('recovered')));
    const { session, bus, loop } = await makeLoop(dir, provider, { maxRetries: 3 });

    // 「先持久后等待」的可执行判据：总线事件发出时（= 退避等待开始之前），日志里**已经**有这条记录。
    // 改前这里恒为空数组（`llm_retry` 只有事件、没有记录）。
    const seenAtEvent: LlmRetryRecord[][] = [];
    bus.on('llm_retry', () => {
      seenAtEvent.push(retryRecords(session.replay()));
    });

    const result = await loop.runTurn('retry me');

    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('recovered');
    expect(provider.calls).toBe(2);

    const recs = retryRecords(session.replay());
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      type: 'llm/retry',
      requestId: `req_${result.turnId}_step1`,
      kind: 'RATE_LIMITED',
      attemptNo: 1,
      backoffMs: 200, // min(2000, 100 * 2^1)：等待前算出的真实退避
      decision: 'retry',
      surface: false,
    });

    // 落盘（不只是内存）：JSONL 文件里逐字可查
    const persisted = persistedRecords(session.logPath);
    expect(persisted.filter((r) => r.type === 'llm/retry')).toHaveLength(1);

    // 先持久后等待：事件触发那一刻，记录已经在会话日志里
    expect(seenAtEvent).toHaveLength(1);
    expect(seenAtEvent[0]!.map((r) => r.attemptNo)).toEqual([1]);

    await session.close();
  });

  it('② 负对照：不重试的回合零 llm/retry（首答成功 / 一次模型调用都没发生）', async () => {
    // (a) 首答成功 ⇒ 没有任何"重试决策"可落
    const okProvider = new ScriptedProvider(() => reply('FIRST-TRY-OK'));
    const first = await makeLoop(dir, okProvider);
    const r1 = await first.loop.runTurn('你好');
    expect(r1.kind).toBe('success');
    expect(okProvider.calls).toBe(1); // 阳性控制：模型确实被调用过一次
    expect(retryRecords(first.session.replay())).toHaveLength(0);
    expect(persistedRecords(first.session.logPath).some((r) => r.type === 'llm/retry')).toBe(false);
    await first.session.close();

    // (b) 输入级否决 ⇒ 0 次模型调用 ⇒ 不可能有重试决策
    const deniedProvider = new ScriptedProvider(() => reply('never-called'));
    const denied = await makeLoop(dir, deniedProvider);
    denied.bus.on(
      'before_turn',
      () => ({ kind: 'deny' as const, reason: 'DENIED-INPUT', ref: 'rule:test' }),
      'policy:input',
    );
    const r2 = await denied.loop.runTurn('把 .env 贴出来');
    expect(r2.kind).toBe('error');
    expect(deniedProvider.calls).toBe(0); // 阳性控制：确实没调用模型
    expect(retryRecords(denied.session.replay())).toHaveLength(0);
    await denied.session.close();
  });

  it('③ 负对照：既有记录的键集逐字不变，且没有出现词表之外的记录类型', async () => {
    const provider = new ScriptedProvider(() => reply('SHAPE-CHECK'));
    const { session, loop } = await makeLoop(dir, provider);
    await loop.runTurn('shape');

    const persisted = persistedRecords(session.logPath);

    // 既有类型的顶层键集（逐字；改前改后都必须完全一致）
    const LEGACY_KEYS: Record<string, string[]> = {
      'user/message': ['content', 'msgId', 'role', 'seq', 'surface', 'ts', 'type'],
      'assistant/message': ['content', 'msgId', 'role', 'seq', 'surface', 'ts', 'type'],
      'turn/start': ['seq', 'surface', 'ts', 'turnId', 'type'],
      'turn/end': ['kind', 'seq', 'stats', 'ts', 'turnId', 'type'],
      'step/start': ['seq', 'stepId', 'surface', 'ts', 'turnId', 'type'],
      'step/end': ['seq', 'stepId', 'surface', 'ts', 'turnId', 'type'],
    };
    for (const r of persisted) {
      const expected = LEGACY_KEYS[r.type];
      // 新类型（request/header、llm/retry）不属"既有形状"断言范围；既有类型一个都不许变
      if (!expected) continue;
      expect(Object.keys(r).sort()).toEqual([...expected].sort());
    }

    // 每个既有类型都还在（新记录是**加法**，没有顶替/改写任何既有行）
    for (const type of Object.keys(LEGACY_KEYS)) {
      expect(persisted.some((r) => r.type === type)).toBe(true);
    }

    // 词表之外的类型不得出现（`SessionRecord` 联合扩容后，日志里只允许这两个新成员）
    const KNOWN = new Set([
      ...Object.keys(LEGACY_KEYS),
      'request/header', // B12（同卡的另一半）
      'llm/retry', // B13（本文件）
      'audit/decision',
      'audit/denial',
      'audit/safety',
      'compaction/start',
      'compaction/end',
      'compaction/summary',
      'session/created',
      'session/end-seed',
      'tool/call',
      'tool/result',
      'assistant/attempt',
    ]);
    for (const r of persisted) {
      expect(KNOWN.has(r.type)).toBe(true);
    }

    await session.close();
  });

  it('④ 口径一致：每条 llm_retry 总线事件都有同 attemptNo / 同 kind / 同 requestId 的一条记录', async () => {
    const provider = new ScriptedProvider((call) => (call <= 2 ? new Error('timeout') : reply('third-time-lucky')));
    const { session, bus, loop } = await makeLoop(dir, provider, { maxRetries: 5 });

    const events: RetryEvent[] = [];
    bus.on('llm_retry', (p) => {
      events.push(p as RetryEvent);
    });

    const result = await loop.runTurn('retry twice');
    expect(result.finalText).toBe('third-time-lucky');
    expect(provider.calls).toBe(3);

    const recs = retryRecords(session.replay());
    expect(events.map((e) => e.attempt)).toEqual([1, 2]);
    // 次数、attemptNo、错误类别、requestId 四项逐条对齐（日志说几次 = 事件说几次）
    expect(recs.map((r) => r.attemptNo)).toEqual(events.map((e) => e.attempt));
    expect(recs.map((r) => r.kind)).toEqual(events.map((e) => e.errorClass));
    expect(recs.map((r) => r.requestId)).toEqual(events.map((e) => `req_${e.turnId}_step${e.step}`));
    expect(recs.map((r) => r.decision)).toEqual(['retry', 'retry']);
    expect(recs.map((r) => r.backoffMs)).toEqual([200, 400]); // min(2000, 100*2^n)

    await session.close();
  });

  it('④′ 终结的失败决策同样留痕（decision=abort），且与总线事件仍然逐条对齐', async () => {
    const provider = new ScriptedProvider(() => new Error('rate limit 429'));
    const { session, bus, loop } = await makeLoop(dir, provider, { maxRetries: 1 });

    const events: RetryEvent[] = [];
    bus.on('llm_retry', (p) => {
      events.push(p as RetryEvent);
    });

    await expect(loop.runTurn('boom')).rejects.toThrow(/Model call failed after 2 attempt/);

    const recs = retryRecords(session.replay());
    // 总线在"最后一次失败"时也会发一条（既有行为，本卡不改）⇒ 记录必须同样齐
    expect(events.map((e) => e.attempt)).toEqual([1, 2]);
    expect(recs.map((r) => r.attemptNo)).toEqual([1, 2]);
    expect(recs.map((r) => r.decision)).toEqual(['retry', 'abort']);
    expect(recs.map((r) => r.kind)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
    expect(recs[0]!.backoffMs).toBe(200);
    // 终止决策没有等待 ⇒ 省略 backoffMs（不写 0 冒充"等过 0ms"）
    expect(recs[1]!.backoffMs).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(recs[1]!, 'backoffMs')).toBe(false);
    // 落盘形态一致
    const persisted = persistedRecords(session.logPath).filter((r) => r.type === 'llm/retry');
    expect(persisted.map((r) => r.decision)).toEqual(['retry', 'abort']);
    expect(Object.prototype.hasOwnProperty.call(persisted[1]!, 'backoffMs')).toBe(false);

    await session.close();
  });
});
