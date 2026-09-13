import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  LlmRetryRecord,
  TurnEndRecord,
} from '@vessel/shared';
import { Telemetry } from './Telemetry.js';

/**
 * B09 `turn/end` 边界的**判别性用例**（任务卡 C4）。
 *
 * 两条反例此前只在注释里登记 —— `Telemetry.ts` 类注释「B09 `turn/end` 记录的接线」与
 * `telemetry.test.ts` 文件头 BRIEF 的「依据收窄」段。本文件把它们升级成"实现/声明若被改回去
 * 就会变红"的用例，且**只标事实、不发明回放口径**（口径裁决属人类）。
 * 用例名把**条件与路径**写在明面上（两条断言都不是无条件等式）。
 *
 * 机制与位置（行号 = HEAD `ba173d4` 的实测行号）：
 *
 * ① **异常路径（无并发）** —— `AgentLoop.ts:462-463` 的 `else { throw err; }`：
 *    provider 抛**不可重试**错误（错误类别不在 `MODEL_RETRYABLE`，`AgentLoop.ts:70` 词表）
 *    ⇒ `callModel` 先落一条 `llm/retry{decision:'abort', attemptNo:1}`
 *    （判据 `AgentLoop.ts:636`、落盘 `:638-647`、抛出 `:649-651`）
 *    ⇒ `runTurnInner` 的 catch（`AgentLoop.ts:451-465`）不在 `TurnInterruptedError`/
 *    `DenialLimitError` 之列，走 `:462-463` 直接抛出
 *    ⇒ `AgentLoop.ts:528` 的 `turn/end` 在该回合**永不写入**。
 *    而 `AgentLoop.ts:208-212` 的 `before_turn`（waterfall）**已经发过**（`:282` 的
 *    `turn/start` 也已落盘）⇒ 实时侧（挂了总线的 `Telemetry`，`:304-310` 的 handler）
 *    计到这一轮，纯回放侧（只读会话日志的 `finalizeRecord`，`Telemetry.ts:435-445`）
 *    **计不到**。⇒ "记录条数 = 回合数 = `before_turn` 事件数"在此路径上**不成立**。
 *    注：同一份日志**重新 `Session.open`** 时 `Session.loadExisting()`（`Session.ts:138-147`）
 *    会为未闭合回合**合成**一条 `turn/end{kind:'interrupted', stats 全零}` —— 那是崩溃恢复
 *    口径，不是本次抛错路径的事实；本用例不重开会话，故不会把它混进来。
 *
 * ② **回合重叠 + 旧回合被 abort（受支持路径）** —— `AgentLoop.ts:136` 的
 *    `private readonly state = new LoopState()` 是**每 loop 单实例**，而
 *    `packages/core/src/state/State.ts:20-26` 的 `beginTurn()` 把 `steps`/`toolCalls` **归零**。
 *    同一 `AgentLoop` 上两次 `runTurn` 重叠时：`runTurn`（`AgentLoop.ts:185-194`）先
 *    `this.interruptCtl.begin()`，而 `InterruptController.ts:22-26` 的 `begin()` 会
 *    **abort 掉尚未结束的旧 scope**（`InterruptController.ts:5` 的注释："aborts + replaces
 *    any stale one"）⇒ 旧回合落盘时读的是**新回合**的计数器。
 *    重叠本身是**受支持路径**：`packages/application/src/session/SessionController.ts:159-167`
 *    的注释明文写着"在旧回合还在跑时调 `runTurn` 会 abort 掉那个旧回合"。
 *    ⇒ 该轮 `after_tool` 条数 ≠ 该轮 `turn/end` 里的 `stats.toolCalls`：
 *    **M03 在这条路径上的记录侧取值不可信**（本用例只标"不可信"，不裁决"该怎么算"）。
 *
 * 为什么"旧回合"能活到落盘：模型调用（`callModel` 的 `await provider.chat()`，`:610-611`）
 * **不**与中断 scope 竞速 —— 只有工具执行 `raceToolRun()`（`:945-961`）会注册 abort 监听。
 * 所以一个 signal-blind 的测试 provider 把第 2 步的模型调用挂在闸门上时，旧回合在
 * abort 之后仍会带着**新回合的 `state`** 走完 `:528` 的 `turn/end`。
 *
 * 「改哪行会红」（判别性，逐条）：
 *  - ① 把 `AgentLoop.ts:462-463` 改成"总能收尾"（例如赋值 `kind='error'` 而非 rethrow）
 *    ⇒ `turn/end` 记录数 0 → 1 ⇒ ① 的 `expect(ends).toHaveLength(0)` 与
 *    `expect(replay.turns).toBe(0)` 先红；
 *  - ① 去掉 `before_turn` 事件、或去掉 `llm/retry{decision:'abort'}` 的落盘
 *    ⇒ ① 的 `beforeTurnEvents` 长度 1 / `abortRecords` 长度 1 与 `attemptNo === 1` 先红；
 *  - ② 给重叠换一个"正确"的回合归属（如 per-turn `LoopState` 实例、或落盘前重取本回合快照）
 *    ⇒ 旧回合记录里的 `stats.toolCalls` 由 0 变 1 ⇒ ② 的"不等"断言先红；
 *  - ② 删掉 `Telemetry.finalizeRecord` 的 `case 'turn/end':`（`Telemetry.ts:435-445`）
 *    ⇒ 纯回放 `turns`/`toolCalls` 归 0 ⇒ ② 的 `expect(replay.turns).toBe(2)` 先红；
 *  - ② 去掉 `liveTurnIds` 去重（`Telemetry.ts:442`）⇒ 实时侧把两条记录再折一遍，
 *    `turns` 2 → 4 ⇒ ② 的 `expect(live.turns).toBe(2)` 先红。
 *
 * 只用测试 provider（`ScriptedProvider`），不联网、不构造真实 provider，不改任何运行时源码。
 */

let dir: string;
let sessionSeq = 0;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-turnend-boundary-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 每次建会话都用新 sessionId：同一 workspace 下多个 loop 不得共用一份会话日志。 */
async function openSession(tag: string): Promise<Session> {
  sessionSeq += 1;
  return Session.open({ workspaceRoot: dir, sessionId: `${tag}-${sessionSeq}` });
}

/**
 * 脚本化 chat() provider：按调用序号返回响应、抛错或挂起。
 * **不实现 `stream()`** ⇒ AgentLoop 走 `chat()` 分支（`AgentLoop.ts:607-611`）。
 * 记录每次收到的 `request.signal`（回合级中断 scope，`AgentLoop.ts:595` 透传）——
 * 它是"旧回合的 scope 是否被新回合 abort"的可判别证据。
 */
class ScriptedProvider implements ChatProvider {
  readonly id = 'scripted-boundary';
  calls = 0;
  readonly signals: (AbortSignal | undefined)[] = [];
  constructor(
    private readonly script: (call: number) => ChatResponse | Error | Promise<ChatResponse>,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    this.signals.push(request.signal);
    const out = await this.script(this.calls);
    if (out instanceof Error) throw out;
    return out;
  }
}

function reply(text: string): ChatResponse {
  return {
    content: text,
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

function toolCallReply(id: string): ChatResponse {
  return {
    content: '',
    toolCalls: [{ id, name: 'Stub', arguments: { n: 1 } }],
    finishReason: 'tool_calls',
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

const buildContext = async () => ({
  model: 'envelope-model',
  messages: [{ role: 'system' as const, content: 'test' }],
  tools: [],
  estimateTokens: 10,
});

function mkLoop(opts: {
  session: Session;
  bus: EventBus;
  provider: ChatProvider;
  runTool?: () => Promise<{ content: string; meta: Record<string, unknown> }>;
}): AgentLoop {
  return new AgentLoop({
    session: opts.session,
    bus: opts.bus,
    provider: opts.provider,
    model: 'deps-model-unused',
    buildContext,
    runTool: opts.runTool ?? (async () => ({ content: 'tool ran', meta: {} })),
    getVisibleTools: () => [],
  });
}

describe('B09 turn/end 边界 —— 两条反例的判别性用例（C4）', () => {
  it('异常路径（无并发；provider 抛不可重试错误）：有 before_turn 而无 turn/end ⇒ 实时侧计到该轮、纯回放侧计不到', async () => {
    const session = await openSession('t-exn');
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus); // 实时侧：`before_turn` 的 handler 在 `Telemetry.ts:304-310`

    const beforeTurnEvents: { turnId: string }[] = [];
    bus.on('before_turn', (p) => {
      beforeTurnEvents.push(p as { turnId: string });
    });

    // 「不可重试」= 错误类别不在 `MODEL_RETRYABLE`（`AgentLoop.ts:70` 只认
    // RATE_LIMITED/TIMEOUT/SERVER_ERROR/NETWORK）。下面这段文本被
    // `classifyModelError`（`AgentLoop.ts:78-85`）判为 'UNKNOWN'（不含 rate limit/429、
    // timeout、5xx/server、network/fetch/econn）⇒ `retryable === false`。
    const provider = new ScriptedProvider(() => new Error('invalid request: malformed prompt'));
    const loop = mkLoop({ session, bus, provider });

    // `:649-651` 抛出包装错误 → `:451-465` 的 catch 里既非 `TurnInterruptedError`
    // 也非 `DenialLimitError` ⇒ `:462-463` 直接 rethrow（本路径的核心事实）。
    await expect(loop.runTurn('boom')).rejects.toThrow(/Model call failed after 1 attempt/);

    // —— 事件侧：`AgentLoop.ts:208-212` 的 before_turn 已发 ——
    expect(beforeTurnEvents).toHaveLength(1);
    const turnId = beforeTurnEvents[0]!.turnId;

    // —— 记录侧：`:282` 的 turn/start 在、`:528` 的 turn/end 不在 ——
    const records = session.replay();
    expect(
      records.filter((r) => r.type === 'turn/start' && r.turnId === turnId),
    ).toHaveLength(1);

    const ends = records.filter((r): r is TurnEndRecord => r.type === 'turn/end');
    expect(ends).toHaveLength(0);
    expect(ends.filter((e) => e.turnId === turnId)).toHaveLength(0);

    // 结构性反差（本用例的名字就是它）：记录条数(0) ≠ before_turn 事件数(1)。
    // `docs/ARCHITECTURE.md` §4.11 的 turn/start→turn/end 1:1 配对**在这条路径上不成立**。
    expect(ends.length).not.toBe(beforeTurnEvents.length);

    // 反面防线：这次失败必须是"不可重试类别"，而不是"重试预算耗尽之后才 abort"。
    // 默认 maxRetries=5（`AgentLoop.ts:588`）⇒ 只有类别不可重试才会在 attemptNo=1 就 abort
    // （预算耗尽需要 attempt > 5）。若有人把 UNKNOWN 挪进可重试词表，这里会先红。
    const abortRecords = records.filter((r): r is LlmRetryRecord => r.type === 'llm/retry');
    expect(abortRecords).toHaveLength(1);
    expect(abortRecords[0]!.decision).toBe('abort');
    expect(abortRecords[0]!.attemptNo).toBe(1);
    expect(abortRecords[0]!.kind).toBe('UNKNOWN');

    // —— 两侧的数：实时侧计到这一轮，纯回放侧计不到 ——
    const live = tel.finalize(session);
    expect(live.turns).toBe(1); // 事件面：before_turn 计一次
    tel.detach();
    const replay = new Telemetry().finalize(session);
    expect(replay.turns).toBe(0); // 记录面缺一条 turn/end ⇒ 没有可折算的东西
    expect(replay.turns).not.toBe(live.turns);

    await session.close();
  });

  it('回合重叠 + 旧回合被 abort（受支持路径）：该轮 after_tool 条数 ≠ 该轮记录里的 stats.toolCalls ⇒ M03 记录侧取值不可信', async () => {
    const session = await openSession('t-overlap');
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);

    const beforeTurnEvents: { turnId: string }[] = [];
    bus.on('before_turn', (p) => {
      beforeTurnEvents.push(p as { turnId: string });
    });
    const afterToolEvents: { toolCallId: string }[] = [];
    bus.on('after_tool', (p) => {
      afterToolEvents.push(p as { toolCallId: string });
    });

    // 闸门：把「旧回合的第 2 次模型调用」挂在 provider 里 —— 这正是重叠窗口。
    // 旧回合此时**已经**完成第 1 步的工具派发（`after_tool` 已在 `AgentLoop.ts:923` 发过），
    // 但还没走到 `:528` 的 turn/end ⇒ 这段窗口里换个回合起跑，归零就会生效。
    let openGate2!: () => void;
    const gate2 = new Promise<void>((resolve) => {
      openGate2 = resolve;
    });
    let call2Started!: () => void;
    const call2StartedP = new Promise<void>((resolve) => {
      call2Started = resolve;
    });

    const provider = new ScriptedProvider((call) => {
      if (call === 1) return toolCallReply('tc_overlap_1');
      if (call === 2) {
        call2Started(); // 旧回合已进入第 2 步的模型调用（signal-blind：不理会 abort）
        return gate2.then(() => reply('turn-1 final'));
      }
      return reply('turn-2 final');
    });

    let toolRuns = 0;
    const loop = mkLoop({
      session,
      bus,
      provider,
      runTool: async () => {
        toolRuns += 1;
        return { content: 'tool ran', meta: {} };
      },
    });

    let turn1Settled = false;
    const turn1 = loop.runTurn('first').then((r) => {
      turn1Settled = true;
      return r;
    });

    await call2StartedP;

    // 第二次 runTurn 在旧回合仍在飞时起跑：`AgentLoop.ts:186-194` 调
    // `InterruptController.begin()`（`InterruptController.ts:22-26`）⇒ abort 旧 scope，
    // 并且 `AgentLoop.ts:200` / `State.ts:20-26` 把**共享** `state` 的计数器归零。
    const turn2Result = await loop.runTurn('second');
    expect(turn2Result.kind).toBe('success');
    expect(turn1Settled).toBe(false); // 真重叠：新回合结束时旧回合还在飞（不是串行）

    openGate2();
    const turn1Result = await turn1;
    expect(turn1Result.kind).toBe('success');
    expect(provider.calls).toBe(3); // 旧回合 2 次 + 新回合 1 次（没有重试）
    expect(toolRuns).toBe(1); // 工具只在旧回合跑过一次

    expect(beforeTurnEvents).toHaveLength(2);
    const turn1Id = beforeTurnEvents[0]!.turnId;
    const turn2Id = beforeTurnEvents[1]!.turnId;
    expect(turn1Id).not.toBe(turn2Id);

    // —— 机制证据：旧回合的 scope 确实被新回合 abort 掉了 ——
    expect(provider.signals).toHaveLength(3);
    expect(provider.signals[0]).toBe(provider.signals[1]); // 两次模型调用属于同一个（旧）回合 scope
    expect(provider.signals[0]).toBeDefined();
    expect(provider.signals[0]!.aborted).toBe(true); // 旧 scope 被 begin() abort
    expect(provider.signals[2]).not.toBe(provider.signals[0]);
    expect(provider.signals[2]!.aborted).toBe(false); // 新回合的 scope 没有被 abort

    // —— 记录面：旧回合**有** turn/end（问题不是"缺记录"，是"记录里的值不对"）——
    const ends = session.replay().filter((r): r is TurnEndRecord => r.type === 'turn/end');
    expect(ends).toHaveLength(2);
    const end1 = ends.find((e) => e.turnId === turn1Id);
    expect(end1).toBeDefined();
    const end2 = ends.find((e) => e.turnId === turn2Id);
    expect(end2).toBeDefined();

    // 旧回合只发起过一次工具调用（`AgentLoop.ts:430-434` 每个调用 recordToolCall 一次，
    // `dispatchToolCall` 的每条 return 路径各发一次 after_tool，本用例走 `:923` 的正常收尾路径）
    // ⇒ 该轮 after_tool 恰好 1 条（事件载荷按 toolCallId 归旧回合；新回合没有工具调用）。
    const turn1ToolEvents = afterToolEvents.filter((e) => e.toolCallId === 'tc_overlap_1');
    expect(turn1ToolEvents).toHaveLength(1);
    expect(afterToolEvents).toHaveLength(1);

    // 核心断言（用例名的后半句）：旧回合落盘读到的是**新回合**归零后的计数器
    // ⇒ 该轮 after_tool 条数(1) ≠ 该轮记录里的 `stats.toolCalls`(0)。
    expect(end1!.stats.toolCalls).toBe(0);
    expect(turn1ToolEvents.length).not.toBe(end1!.stats.toolCalls);

    // —— 两侧的数：身份面（turns）一致，汇总面（toolCalls）记录侧不可信 ——
    const live = tel.finalize(session);
    expect(live.turns).toBe(2); // 两个 before_turn 事件；两条记录都被 liveTurnIds 去重掉
    expect(live.toolCalls).toBe(1); // 一条 after_tool 事件
    tel.detach();

    const replayTel = new Telemetry();
    const replay = replayTel.finalize(session);
    expect(replay.turns).toBe(2); // 两条 turn/end 记录（身份面两侧同数）
    expect(replay.toolCalls).toBe(0); // 两个 stats.toolCalls 都是 0 ⇒ 少掉旧回合那一次
    expect(replay.toolCalls).not.toBe(live.toolCalls);
    expect(replayTel.metrics().find((m) => m.metric === 'M03')!.value).toBe(0);
    // 本用例只把"M03 记录侧取值不可信"钉死；**不**断言"回放该怎么算"
    // （旧回合被 abort 后该计几次属口径裁决，留给人类）。

    await session.close();
  });
});
