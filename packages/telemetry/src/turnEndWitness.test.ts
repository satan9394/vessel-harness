import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  TurnEndRecord,
} from '@vessel/shared';
import { Telemetry } from './Telemetry.js';

/**
 * 任务卡 W2（R3）—— `turn/end` 接线的**四个边界**的见证用例。
 *
 * 来源：`.dsh-mission/evidence/C8-review-verdict.md` §6.2 R3 / §6.3（建议卡 C10）。
 * 这四处**行为已在文档里声明**（`Telemetry.ts` 类注释「B09 `turn/end` 记录的接线」的
 * 收尾三条边界 + `liveTurnIds` 的两条边界、`docs/BENCHMARK-SPEC.md` 的 M02/M03 行），
 * 但**没有任何用例见证**。本文件只加用例：**不改运行时源码、不改文档、不动 W1 的两个文件**。
 *
 * 四条边界 → 用例 → 定性（纪律 24 的「判别性 / 不变式守卫」；每条都指认了"删/改哪一行会红"）：
 *
 *  ① `Session.loadExisting()` 的**崩溃合成收尾**：日志里一个已 `turn/start`、未收尾的回合
 *     ⇒ 重新打开时合成 `turn/end{kind:'interrupted', stats:{steps:0,toolCalls:0,durationMs:0}}`
 *     ⇒ 全新 `Telemetry().finalize()` 计 **turns=1 / toolCalls=0**（合成 stats 全零是**下界**，
 *     不是"测得 0 次"：崩溃前真跑过的工具调用在记录里只剩 `tool/result`，汇总面写的就是 0）。
 *     **判别性** —— 删 `Telemetry.finalizeRecord` 的 `case 'turn/end':`（`Telemetry.ts:451`）
 *     或删 `Session.loadExisting` 的 `for (const turnId of openTurns)` 合成循环（`Session.ts:140`），
 *     或把合成的 `stats` 改成非零（`Session.ts:145`）⇒ 本用例指名红。
 *  ② **模型调用途中被中断**：`beginStep()` 已计这一步、`after_model` 未发
 *     ⇒ 该轮 `turn/end` 记录里的 `stats.steps` **大于**该轮 `after_model` 事件条数。
 *     两个数都钉：记录里的值（1）与事件面的值（0）。
 *     **判别性** —— 删 `this.state.beginStep()`（`AgentLoop.ts:331`）⇒ 记录里的值变 0 ⇒ 红；
 *     删 `consumeStream` 的 `if (this.interruptCtl.aborted) throw new TurnInterruptedError();`
 *     （`AgentLoop.ts:709`）⇒ 流跑完 ⇒ `after_model` 变 1、`>` 断言红。
 *  ③ **回合中途 attach**：telemetry 在 `before_turn` 之后才挂上总线 ⇒ 该轮 `turnId` 进不了
 *     `liveTurnIds`，而部分 `after_tool` 已被实时计入 ⇒ `finalize` 时记录侧**再补一次**整轮
 *     `stats.toolCalls` ⇒ `toolCalls` **多计**。用例把"多计了"显式写成
 *     `counters.toolCalls === 实时计到的 after_tool 条数 + 该轮记录里的 stats.toolCalls`，
 *     并加一条**回合前 attach 的对照组**（按 `turnId` 去重 ⇒ 不多计）把条件钉死在埋点上。
 *     **判别性** —— 删 `finalizeRecord` 的 `if (this.liveTurnIds.has(r.turnId)) break;`
 *     （`Telemetry.ts:458`）或删 `attach()` 里 `liveTurnIds.add(turnId)`（`Telemetry.ts:324`）
 *     ⇒ **对照组**由 1 变 2 ⇒ 红；删 `bus.on('after_tool', …)` 的实时计数（`Telemetry.ts:334`）
 *     ⇒ 中途 attach 那条由 2 变 1 ⇒ 红。
 *  ④ **`before_turn` 载荷没有字符串 `turnId`**（"形状不认识"分支）：照旧"每个事件计一次"且
 *     **不进** `liveTurnIds` ⇒ 日志里该轮还有 `turn/end` 记录时，记录侧**再补一次**
 *     （同一个回合计两次）。用例把这个行为钉住，并**如实标注**这是 `liveTurnIds` 那条
 *     "绝不静默少计"（形状不认识也计）的**代价**：少计 vs 多计之间选了不多计。
 *     **判别性** —— 删 `liveTurnIds.add` 那一行 ⇒ 对照组（身份齐全）也补一次 ⇒ 红；
 *     给形状不认识的分支加"无 turnId 就不计数"的早退 ⇒ 本组由 2 变 1 ⇒ 红。
 *
 * 断言一律**结构性**（记录条数 / 事件条数 / 计数器数值三方对照），不断言"不抛错"。
 */

let dir: string;
let sessionSeq = 0;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-w2-turnend-'));
});
afterEach(() => {
  // 测试自建、且位于 os.tmpdir() 之下的临时目录（AGENTS.md 的书面例外）。
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 每次建会话都用新 sessionId：同一 workspace 下多个 loop 不得共用一份会话日志。 */
function openSession(tag: string): Promise<Session> {
  sessionSeq += 1;
  return Session.open({ workspaceRoot: dir, sessionId: `${tag}-${sessionSeq}` });
}

function turnEnds(session: Session): TurnEndRecord[] {
  return session.replay().filter((r): r is TurnEndRecord => r.type === 'turn/end');
}

/** 脚本化 `chat()` provider：按调用序号返回响应或抛错（不实现 `stream()` ⇒ 走 chat() 分支）。 */
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

function toolCallReply(id: string): ChatResponse {
  return {
    content: '',
    toolCalls: [{ id, name: 'Stub', arguments: { n: 1 } }],
    finishReason: 'tool_calls',
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

/**
 * 流式 provider：先发 `message_start`，再在**第一个 chunk 之后**回调（外部停机键），
 * 然后才 yield 第二个 chunk。`consumeStream` 的 `for await` 拿到第二个 chunk 时先做
 * `interruptCtl.aborted` 边界检查（`AgentLoop.ts:709`）⇒ 抛 `TurnInterruptedError`。
 * `chat()` 抛错 —— 走流式分支时它不该被调用。
 */
class InterruptingStreamProvider implements ChatProvider {
  readonly id = 'interrupting-stream';
  constructor(private readonly onAfterFirstChunk: () => void) {}

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(_request: ChatRequest): AsyncGenerator<StreamChunk> {
    yield { type: 'message_start', model: 'm' };
    this.onAfterFirstChunk();
    yield { type: 'text_delta', text: 'partial' };
  }
}

function makeLoop(session: Session, bus: EventBus, provider: ChatProvider): AgentLoop {
  return new AgentLoop({
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
}

describe('W2/R3 —— `turn/end` 接线的四个边界（只加见证用例，不改运行时源码）', () => {
  /**
   * ① 崩溃合成收尾（`Session.loadExisting`）⇒ 计 1 回合 / 0 工具调用（**下界**）。
   *
   * 构造（真实残留，不是手写记录）：一个回合跑了工具调用后，第 2 次模型调用抛**不可重试**
   * 错误 ⇒ `AgentLoop.ts:462-463` 的 `else { throw err; }` ⇒ `:528` 的 `turn/end` **永不落盘**
   * （与 `telemetry.test.ts` ⑱ / `turnEndBoundary.test.ts` 第 1 条同一闸门），日志里留下
   * "已 `turn/start`、未收尾"的回合 —— 这正是崩溃残留的形状。随后 `close()` + 用同一
   * `sessionId` 重新 `Session.open()` ⇒ `loadExisting()` 为它合成一条收尾记录。
   *
   * 判据（结构性的三方对照）：
   *  - 重开**前**：`turn/start` 恰好 1 条、`turn/end` **0** 条（有始无终）；
   *  - 崩溃前**真的**调过工具：`tool/result` 恰好 1 条（所以"0 次工具调用"不是"什么都没做"）；
   *  - 重开**后**：合成记录的 `turnId` 与 `turn/start` 同值、`kind:'interrupted'`、
   *    `stats` 逐字段 `{steps:0, toolCalls:0, durationMs:0}`；
   *  - 全新 `Telemetry().finalize(reopened)`（纯回放）⇒ `turns=1` / `toolCalls=0`。
   */
  it("① 崩溃合成收尾记录（已 turn/start、未收尾）⇒ 重开日志后计 1 回合 / 0 工具调用（合成 stats 全零 = 下界）", async () => {
    const sessionId = 'w2-crash-synth';
    const first = await Session.open({ workspaceRoot: dir, sessionId });
    const bus = new EventBus();

    // 第 1 步：模型要调一个工具（真实派发：tool/call + tool/result + after_tool 都发生）；
    // 第 2 步：模型调用抛 'boom'（`classifyModelError` 判为 UNKNOWN、不在 MODEL_RETRYABLE）
    // ⇒ `callModel` 落 abort 决策后抛出 ⇒ 回合**没有** turn/end。
    const provider = new ScriptedProvider((call) =>
      call === 1 ? toolCallReply('tc_w2_crash') : new Error('boom: unknown model failure'),
    );
    const loop = makeLoop(first, bus, provider);

    await expect(loop.runTurn('崩给我看')).rejects.toThrow(/Model call failed after 1 attempt/);

    // 崩溃残留（重开前的事实）：有 turn/start、无 turn/end；但工具确实跑过。
    const starts = first.replay().filter((r) => r.type === 'turn/start');
    expect(starts).toHaveLength(1);
    expect(turnEnds(first)).toHaveLength(0);
    expect(first.replay().filter((r) => r.type === 'tool/result')).toHaveLength(1);
    await first.close();

    // 重新打开同一份日志 ⇒ `Session.loadExisting()` 为未闭合回合**合成**一条收尾记录。
    const reopened = await Session.open({ workspaceRoot: dir, sessionId });
    const ends = turnEnds(reopened);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.turnId).toBe(starts[0]!.turnId); // 合成记录挂的是那个未闭合回合的身份
    expect(ends[0]!.kind).toBe('interrupted');
    // 合成 stats 逐字段全零 —— 崩溃时无人汇总，这是**下界**，不是"测得 0 次"：
    // 上一行的 tool/result 证明这一轮真跑过 1 次工具调用，而记录里的汇总是 0。
    expect(ends[0]!.stats).toEqual({ steps: 0, toolCalls: 0, durationMs: 0 });

    const counters = new Telemetry().finalize(reopened); // 全新实例 + 未 attach 总线 = 纯回放
    expect(counters.turns).toBe(1); // 合成收尾记录 ⇒ 计 1 个回合
    expect(counters.toolCalls).toBe(0); // 记录里写的就是 0（下界）
    expect(counters.steps).toBe(0); // `stats.steps` 同样刻意不消费（见 ②）

    await reopened.close();
  });

  /**
   * ② 模型调用**途中**被中断：`beginStep()` 已计这一步、`after_model` 未发
   * ⇒ 记录里的 `stats.steps`（1）**大于**该轮 `after_model` 条数（0）。两个数都钉。
   *
   * 构造：provider 实现 `stream()`（走 `consumeStream`），流在**第一个 chunk 之后**
   * 调 `loop.interrupt()`（外部停机键的真实入口）⇒ 下一次迭代的边界检查
   * `AgentLoop.ts:709` 抛 `TurnInterruptedError` ⇒ `consumeStream` 的 catch 只发
   * `model_stream_end{finishReason:'error'}`（**不发** `after_model`）⇒ `callModel` 的 catch
   * 里 `interruptCtl.aborted` 为真 ⇒ 抛出 ⇒ `runTurnInner` 的 catch 定 `kind='interrupted'`
   * ⇒ 回合**照常收尾**（`turn/start → turn/end` 配对保留）。
   *
   * 判据：
   *  - `model_stream_start` 恰好 1 条 ⇒ 这次中断打在**在飞的模型调用**上（不是步边界空转）；
   *  - 该轮 `after_model` **0** 条（事件面的值）、该轮记录 `stats.steps` **1**（记录里的值）；
   *  - `stats.steps > after_model 条数` 这条不等式的两边分别被上面两个断言钉住；
   *  - 实时 telemetry 的 `steps` 仍为 0（只按 `after_model` 计）⇒ 记录里的 1 刻意不被消费，
   *    正是"实时 == 纯回放在这条边界上不成立"的可判别事实。
   */
  it('② 模型调用途中被中断（流在飞时打断）⇒ 该轮记录 stats.steps=1 而事件面 after_model=0', async () => {
    const session = await openSession('w2-interrupt-midcall');
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);

    const afterModel: { turnId: string; step: number }[] = [];
    bus.on('after_model', (p) => {
      afterModel.push(p as { turnId: string; step: number });
    });
    const streamStarts: { turnId: string }[] = [];
    bus.on('model_stream_start', (p) => {
      streamStarts.push(p as { turnId: string });
    });

    let loop!: AgentLoop;
    let interrupted = false;
    const provider = new InterruptingStreamProvider(() => {
      // 模型调用**已经开始**（`model_stream_start` 已发）、尚未收尾 —— 此刻按下停机键。
      interrupted = loop.interrupt();
    });
    loop = makeLoop(session, bus, provider);

    const result = await loop.runTurn('调用途中打断我');
    expect(result.kind).toBe('interrupted'); // TurnResult / turn/end / after_turn 三处同源
    expect(interrupted).toBe(true); // 打断确实打中了在飞的模型调用
    expect(streamStarts).toHaveLength(1); // 模型调用确实**已经发起**（"途中"的事实锚点）

    const ends = turnEnds(session);
    expect(ends).toHaveLength(1); // 中断不是"有始无终"：回合照常收尾（配对不变式）
    expect(ends[0]!.kind).toBe('interrupted');

    const afterModelForTurn = afterModel.filter((e) => e.turnId === result.turnId);
    expect(afterModelForTurn).toHaveLength(0); // ← 事件面的值
    expect(ends[0]!.stats.steps).toBe(1); // ← 记录里的值（beginStep 已计这一步）
    expect(ends[0]!.stats.steps).toBeGreaterThan(afterModelForTurn.length); // 1 > 0：这就是那条 mismatch

    const counters = tel.finalize(session);
    expect(counters.steps).toBe(0); // 只按 after_model 计 ⇒ 记录里的 1 不被消费（两个数不同）
    expect(counters.turns).toBe(1); // 事件面 before_turn 计过这一轮
    expect(counters.toolCalls).toBe(0); // 这一步的工具调用从未发生
    tel.detach();
    await session.close();
  });

  /**
   * ③ 回合**中途** attach ⇒ 该轮 `toolCalls` **多计**；对照组（回合前 attach）**不多计**。
   *
   * 构造 A（中途 attach）：telemetry 在 `provider.chat(1)` 里才 `attach(bus)` —— 那个时刻
   * `before_turn` 已经发过（`AgentLoop.ts:208` 早于 `:379` 的模型调用），`order` 数组把
   * "before_turn 先、attach 后"这个顺序钉成事实。于是：
   *   - `liveTurnIds` 收不到这一轮的 `turnId`；
   *   - 之后的 `after_tool` 却实时计到了（实时面 1 次）；
   *   - `finalize` 时记录侧 `turn/end.stats.toolCalls`（记录面 1 次）**再补一次** ⇒ 计数器 2。
   * 「多计了」这个事实被显式写成等式：`counters.toolCalls === 实时 after_tool 条数 + 该轮
   * 记录里的 stats.toolCalls`（两个加数各自先被独立断言，等式不可能被平凡满足）。
   *
   * 构造 B（对照组）：同一形状的回合，但 telemetry 在 `runTurn` **之前** attach ⇒
   * `before_turn` 被听到、`turnId` 进身份集 ⇒ 记录侧去重 ⇒ `toolCalls` 恰好 1（不多计）。
   * 两组唯一的差别就是 attach 时机 ⇒ 这条对照正是"多计"的判别性来源。
   */
  it('③ 回合中途 attach ⇒ 该轮 toolCalls 多计（对照：回合前 attach 按 turnId 去重不多计）', async () => {
    // —— A：回合开始**之后**才 attach ——
    const sessionA = await openSession('w2-late-attach');
    const busA = new EventBus();
    const telA = new Telemetry();
    const order: string[] = [];
    busA.on('before_turn', () => {
      order.push('before_turn');
    });
    let liveAfterToolA = 0;
    busA.on('after_tool', () => {
      liveAfterToolA += 1;
    });

    const providerA = new ScriptedProvider((call) => {
      if (call === 1) {
        // 回合已开始（before_turn 已发）之后才挂上总线 —— 这就是"中途 attach"。
        telA.attach(busA);
        order.push('attach');
        return toolCallReply('tc_w2_late');
      }
      return reply('done');
    });
    const loopA = makeLoop(sessionA, busA, providerA);

    const resultA = await loopA.runTurn('中途挂总线');
    expect(resultA.kind).toBe('success');
    expect(order).toEqual(['before_turn', 'attach']); // 顺序是事实，不是声称

    const endA = turnEnds(sessionA);
    expect(endA).toHaveLength(1);
    expect(endA[0]!.stats.toolCalls).toBe(1); // 记录面：这一轮真的只调了 1 次工具
    expect(liveAfterToolA).toBe(1); // 实时面：挂上之后确实计到了那 1 次 after_tool

    const liveA = telA.finalize(sessionA);
    // 「多计」显式表达：计数器 = 实时计到的 after_tool 条数 + 该轮记录里的 stats.toolCalls
    expect(liveA.toolCalls).toBe(liveAfterToolA + endA[0]!.stats.toolCalls); // 1 + 1
    expect(liveA.toolCalls).toBe(2);
    expect(liveA.toolCalls).toBeGreaterThan(endA[0]!.stats.toolCalls); // 比这一轮真实调用数多 1
    expect(liveA.turns).toBe(1); // turns 是身份计数：实时没听到、记录侧补 1 ⇒ 仍是 1（不受影响）
    telA.detach();

    // —— B：对照组（回合**开始之前** attach ⇒ 按 turnId 去重，不多计）——
    const sessionB = await openSession('w2-pre-attach');
    const busB = new EventBus();
    const telB = new Telemetry();
    telB.attach(busB); // 组合根 `composeHarness` 的形态：构造时 attach、任何 runTurn 之外
    let liveAfterToolB = 0;
    busB.on('after_tool', () => {
      liveAfterToolB += 1;
    });

    const providerB = new ScriptedProvider((call) =>
      call === 1 ? toolCallReply('tc_w2_pre') : reply('done'),
    );
    const loopB = makeLoop(sessionB, busB, providerB);

    const resultB = await loopB.runTurn('回合前挂总线');
    expect(resultB.kind).toBe('success');

    const endB = turnEnds(sessionB);
    expect(endB).toHaveLength(1);
    expect(endB[0]!.stats.toolCalls).toBe(1); // 记录面与 A 组同形（1 次工具调用）
    expect(liveAfterToolB).toBe(1); // 实时面同样计到 1 次
    // 去重生效：记录侧不再补一次 ⇒ 恰好 1（删掉 `liveTurnIds.has(r.turnId)` 判据 ⇒ 这里变 2 ⇒ 红）
    expect(telB.finalize(sessionB).toolCalls).toBe(1);
    telB.detach();
    await sessionA.close();
    await sessionB.close();
  });

  /**
   * ④ `before_turn` 载荷**没有字符串 `turnId`** ⇒ 照旧"每个事件计一次"且**不进** `liveTurnIds`
   * ⇒ 若日志里同一轮还有 `turn/end` 记录，记录侧**再补一次**（同一个回合被计两次）。
   *
   * 这是 `Telemetry.attach()` 的 `before_turn` handler 那条声明的**代价**（`Telemetry.ts:309-310`
   * 与 `liveTurnIds` 注释的边界段）：形状不认识时，`countTurn` 选择"绝不静默少计"
   * （照旧每事件计一次），代价就是**可能多计** —— 事件与记录无法按身份对齐。
   * 本仓 `AgentLoop` 一律带 `turnId`（`AgentLoop.ts:208-212`），所以这个分支只能由**非本仓
   * 生产者**的载荷触发；用例直接发那个形状，不假装它是 AgentLoop 的产物。
   *
   * 两组对照（同一份 Telemetry 只在各自组内 finalize 一次；`finalize` 不是幂等的）：
   *  - A 组（形状不认识）：事件面 1 + 记录面 1 = **2**（同一回合计两次）；
   *  - B 组（身份齐全）：事件面 1 + 记录面去重 0 = **1**。
   */
  it("④ before_turn 载荷无字符串 turnId ⇒ 每事件计一次且不进身份集 ⇒ 同一回合的记录侧再补一次（turns=2）", async () => {
    // —— A：形状不认识（无字符串 turnId）——
    const sessionA = await openSession('w2-shape-unknown');
    const busA = new EventBus();
    const telA = new Telemetry();
    telA.attach(busA);

    await busA.emit('before_turn', {}); // 载荷没有字符串 turnId（"形状不认识"分支）
    // 事件面已经计了 1 次（绝不静默少计）。
    expect(telA.metrics().find((m) => m.metric === 'M02')!.value).toBe(1);
    // 这一轮的收尾记录仍在日志里：turnId 就在**记录**上，只是事件面没给出身份 ⇒ 认不出是同一轮。
    await sessionA.appendSync({
      type: 'turn/end',
      turnId: 'turn_shape_unknown',
      kind: 'success',
      stats: { steps: 0, toolCalls: 0, durationMs: 0 },
    });

    const countersA = telA.finalize(sessionA);
    expect(countersA.turns).toBe(2); // 事件面 1 + 记录面 1：同一个回合被计两次（代价）
    expect(countersA.toolCalls).toBe(0);
    telA.detach();

    // —— B：对照（身份齐全 ⇒ 按 turnId 去重）——
    const sessionB = await openSession('w2-shape-known');
    const busB = new EventBus();
    const telB = new Telemetry();
    telB.attach(busB);

    await busB.emit('before_turn', { turnId: 'turn_shape_known' });
    await sessionB.appendSync({
      type: 'turn/end',
      turnId: 'turn_shape_known',
      kind: 'success',
      stats: { steps: 0, toolCalls: 0, durationMs: 0 },
    });

    const countersB = telB.finalize(sessionB);
    expect(countersB.turns).toBe(1); // 事件面 1 + 记录侧去重 0（删掉 liveTurnIds.add ⇒ 这里变 2 ⇒ 红）
    expect(countersB.toolCalls).toBe(0);
    telB.detach();
    await sessionA.close();
    await sessionB.close();
  });
});
