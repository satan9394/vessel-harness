import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type { ToolResultOutcome } from '@vessel/core';
import type {
  ChatFinishReason,
  ChatProvider,
  ChatResponse,
  SessionRecord,
  StreamChunk,
  ToolCall,
} from '@vessel/shared';

/**
 * BRIEF「finishReason 从不参与停止判定 ⇒ 被 max_tokens 截断的回答被报成 kind='success'」。
 *
 * 复现（改前 `AgentLoop.runTurnInner` 的停止判定只看 `toolCalls.length` 与 `content`，从不读
 * `finishReason`）：
 *   - provider 给出 `finishReason='length'`（Anthropic `stop_reason:'max_tokens'` 的归一形态，
 *     AnthropicProvider.ts:361-369；流式经 parseAnthropic.ts:209-210）**且没有工具调用**时，
 *     回合 `kind='success'`、`turn/end.kind='success'`、`after_turn.kind='success'`
 *     ⇒ 「一条被截断的半截回答」在四个消费面上都是"成功"（CLI 退出码 0 + 「=== 最终回复 ===」、
 *     HTTP 200、runner `turnKind='success'`、evaluator `stopReason='completed'`）；
 *   - 若这次响应的文本还为空，改前更会落到 `finalText==='' && kind==='success'` 的兜底变成
 *     `kind='budget'`（同样退出码 0 / HTTP 200）。
 *   - 而且 `finishReason` **不进入任何持久记录**（只活在 bus 事件 `model_stream_end` 上）
 *     ⇒ 会话日志（本仓唯一真源）里查不到"这条回答被截断了"。
 *
 * 本卡裁决：**被截断的回合不得再报成"成功"** —— `kind='error'`（既有四值之一，见 AgentLoop.ts
 * 判据处的完整论证：`'budget'` 已被本仓逐字裁决为"不算失败"，选它等于把 `'success'` 换个名字），
 * 并把截断事实作为**加法字段** `finishReason:'length'` 写进 `turn/end` 记录。
 *
 * 判别性（"删哪行会红"）：
 *   - 删掉 `AgentLoop.ts` 的 `if (truncated) { kind = 'error'; }`（或把 `'error'` 改回 `'success'`）
 *     ⇒ 用例 ①/①′/④ 的 `expect(result.kind).toBe('error')` 与 `expect(...).not.toBe('success')` 红；
 *   - 删掉 `turn/end` 里的 `...(truncated ? { finishReason: 'length' } : {})`
 *     ⇒ 用例 ①/①′/④ 的 `truncatedFinishReason(...)` 断言红（记录里查不到截断）；
 *   - 删掉 `terminalFinishReason = response.finishReason;` ⇒ 判据恒为 false ⇒ 同上两条红；
 *   - 若把判据放宽成"所有回合都判异常"（例如不判 `finishReason`、直接永远 `kind='error'`）
 *     ⇒ 用例 ②/③/④′ 的负对照红（正常结束、无 `finishReason`、有工具调用的回合必须逐字不变）。
 *
 * 真实生产路径：走 `AgentLoop.runTurn` 本尊（与 CLI/TUI/HTTP/runner 消费的是同一条路径）；
 * 唯一替换的是 provider —— `MockProvider` 只会产出 `'stop'`/`'tool_calls'`（MockProvider.ts:138/201），
 * 造不出被截断的响应，故用下面的假 provider 直接给出 `finishReason`（不改 `packages/llm`，不新增依赖）。
 */

interface Harness {
  session: Session;
  bus: EventBus;
  loop: AgentLoop;
}

/** 假 provider：唯一目的是把 `finishReason` 直接喂给 loop；`chat()` 分支（不实现 `stream()`）。 */
class ScriptedFinishProvider implements ChatProvider {
  readonly id = 'scripted-finish';
  calls = 0;
  constructor(private readonly phases: ChatResponse[]) {}

  async chat(): Promise<ChatResponse> {
    const phase = this.phases[Math.min(this.calls, this.phases.length - 1)]!;
    this.calls += 1;
    return phase;
  }
}

/** 造一条完整的 `ChatResponse`（`usage` 固定，避免与 `finishReason` 纠缠）。 */
function resp(
  finishReason: ChatFinishReason,
  content = '',
  toolCalls: ChatResponse['toolCalls'] = [],
): ChatResponse {
  return { content, toolCalls, finishReason, usage: { inputTokens: 1, outputTokens: 1 } };
}

/**
 * 流式假 provider：`message_end` 带 `finishReason:'length'`（Anthropic `max_tokens` 的真实形态）。
 * `chat()` 故意抛错 —— 只测流式路径（`consumeStream` → `normalizeFinishReason` → 同一个停止判定）。
 */
class StreamLengthProvider implements ChatProvider {
  readonly id = 'stream-length';

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(): AsyncGenerator<StreamChunk> {
    yield { type: 'message_start', model: 'fake' };
    yield { type: 'text_delta', text: 'HALF-ANSWER-THAT-GOT-CUT' };
    yield { type: 'usage', inputTokens: 1, outputTokens: 1 };
    yield { type: 'message_end', finishReason: 'length' };
  }
}

/** 流式假 provider：`message_end` **不带** `finishReason` ⇒ `normalizeFinishReason` 归一为 `'stop'`。 */
class StreamNoFinishProvider implements ChatProvider {
  readonly id = 'stream-no-finish';

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(): AsyncGenerator<StreamChunk> {
    yield { type: 'message_start', model: 'fake' };
    yield { type: 'text_delta', text: 'NORMAL-STREAM-TEXT' };
    yield { type: 'usage', inputTokens: 1, outputTokens: 1 };
    yield { type: 'message_end' };
  }
}

/** 每次建会话都用新 sessionId：同一 workspace 下多个 loop 不得共用一份会话日志。 */
let sessionSeq = 0;

async function makeLoop(
  dir: string,
  provider: ChatProvider,
  opts: { maxSteps?: number; runTool?: (call: ToolCall) => Promise<ToolResultOutcome> } = {},
): Promise<Harness> {
  sessionSeq += 1;
  const session = await Session.open({ workspaceRoot: dir, sessionId: `finish-reason-${sessionSeq}` });
  const bus = new EventBus();
  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: 'fake',
    maxSteps: opts.maxSteps,
    buildContext: async () => ({
      model: 'fake',
      messages: [{ role: 'system' as const, content: 'test' }],
      tools: [],
      estimateTokens: 10,
    }),
    runTool:
      opts.runTool ??
      (async (_call: ToolCall): Promise<ToolResultOutcome> => ({ content: 'TOOL-OK', meta: {} })),
    getVisibleTools: () => [],
  });
  return { session, bus, loop };
}

type TurnEndRecord = Extract<SessionRecord, { type: 'turn/end' }>;
type AssistantMessageRecord = Extract<SessionRecord, { type: 'assistant/message' }>;

function turnEnds(records: readonly SessionRecord[]): TurnEndRecord[] {
  return records.filter((r): r is TurnEndRecord => r.type === 'turn/end');
}

/**
 * `turn/end` 上本卡新增的加法字段。`TurnEndRecord`（packages/shared/src/events.ts:97-107）**还没有**
 * 这个字段（本卡不改记录形状，最小改法与影响面见交付 ②），落盘记录靠 `SessionRecordBase` 的
 * `[k: string]: unknown` 索引签名承载非空 ⇒ 这里显式读出，并按 `unknown` 断言。
 */
function truncatedFinishReason(rec: TurnEndRecord): unknown {
  return (rec as { finishReason?: unknown }).finishReason;
}

/** 正常收尾的 `turn/end` 记录键集（逐字钉住：本卡不得给未截断的回合加任何键）。 */
const PLAIN_TURN_END_KEYS = ['kind', 'seq', 'stats', 'ts', 'turnId', 'type'];

describe('AgentLoop — finishReason 参与停止判定：被截断的回合不再报 success（BRIEF）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-finish-reason-'));
  });
  afterEach(() => {
    // 测试自建且位于 os.tmpdir()（AGENTS.md 书面例外）
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① finishReason=length 且无工具调用 ⇒ kind 不再是 success（改前 success ⇒ 必红），且截断事实进了 turn/end 记录', async () => {
    const provider = new ScriptedFinishProvider([
      resp('length', '这是一段被 max_tokens 截断的半截回答'),
    ]);
    const { session, bus, loop } = await makeLoop(dir, provider);
    const afterTurn: { turnId: string; kind: string }[] = [];
    bus.on(
      'after_turn',
      (p) => {
        afterTurn.push(p as { turnId: string; kind: string });
      },
      'test:after_turn',
    );

    const result = await loop.runTurn('写一篇很长的文章');

    // ①-a 复现点：改前这里恒为 'success'（停止判定只看 toolCalls.length 与 content）
    expect(result.kind).toBe('error');
    expect(result.kind).not.toBe('success');
    expect(provider.calls).toBe(1);
    expect(result.steps).toBe(1);
    expect(result.toolCalls).toBe(0);
    // 半截回答**不丢**：既不被清空，也不被换成一句编造的文案（信息不因改 kind 而丢失）
    expect(result.finalText).toBe('这是一段被 max_tokens 截断的半截回答');

    // ①-b 记录面：截断这一事实**进了会话日志**（改前只活在 bus 的 model_stream_end 上）
    const records = session.replay();
    const ends = turnEnds(records);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ turnId: result.turnId, kind: 'error' });
    expect(truncatedFinishReason(ends[0]!)).toBe('length');
    // kind 与记录不得互相矛盾；stats 语义逐字不变
    expect(ends[0]!.kind).toBe(result.kind);
    expect(ends[0]!.stats).toMatchObject({ steps: 1, toolCalls: 0 });
    expect(typeof ends[0]!.stats.durationMs).toBe('number');

    // after_turn 与 turn/end 同源（同一个 kind），载荷形状不变（仍只有 turnId/kind）
    expect(afterTurn).toEqual([{ turnId: result.turnId, kind: 'error' }]);

    // 配对不变式与"用户看得到原文"不变
    expect(records.filter((r) => r.type === 'turn/start')).toHaveLength(1);
    const assistantMsgs = records.filter(
      (r): r is AssistantMessageRecord => r.type === 'assistant/message',
    );
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0]!.content).toBe('这是一段被 max_tokens 截断的半截回答');

    await session.close();
  });

  it('①′ 流式路径同判据：message_end{finishReason:length} ⇒ 同样不再报 success，记录同样带截断', async () => {
    const { session, bus, loop } = await makeLoop(dir, new StreamLengthProvider());
    const afterTurn: { turnId: string; kind: string }[] = [];
    bus.on(
      'after_turn',
      (p) => {
        afterTurn.push(p as { turnId: string; kind: string });
      },
      'test:after_turn',
    );

    const result = await loop.runTurn('流式长回答');

    // 流式与 chat() 共用同一个停止判定（normalizeFinishReason 把 'length' 原样透传）
    expect(result.kind).toBe('error');
    expect(result.finalText).toBe('HALF-ANSWER-THAT-GOT-CUT');
    expect(turnEnds(session.replay())[0]!.kind).toBe('error');
    expect(truncatedFinishReason(turnEnds(session.replay())[0]!)).toBe('length');
    expect(afterTurn).toEqual([{ turnId: result.turnId, kind: 'error' }]);

    await session.close();
  });

  it('② 负对照：正常结束（stop / 无 finishReason）⇒ kind=success，turn/end 与 after_turn 载荷逐字不变', async () => {
    // ②-a `chat()` 明确 'stop'
    const provider = new ScriptedFinishProvider([resp('stop', 'NORMAL-REPLY-GOLDEN')]);
    const chatRun = await makeLoop(dir, provider);
    const chatAfterTurn: { turnId: string; kind: string }[] = [];
    chatRun.bus.on(
      'after_turn',
      (p) => {
        chatAfterTurn.push(p as { turnId: string; kind: string });
      },
      'test:after_turn',
    );

    const chatResult = await chatRun.loop.runTurn('你好');

    expect(chatResult.kind).toBe('success');
    expect(chatResult.finalText).toBe('NORMAL-REPLY-GOLDEN');
    expect(chatResult.steps).toBe(1);
    expect(chatResult.toolCalls).toBe(0);
    expect(provider.calls).toBe(1);

    const chatEnds = turnEnds(chatRun.session.replay());
    expect(chatEnds).toHaveLength(1);
    // 逐字不变：**键集**与**值**都不得被本卡动过（未截断 ⇒ 不新增 finishReason 键）
    expect(Object.keys(chatEnds[0]!).sort()).toEqual(PLAIN_TURN_END_KEYS);
    expect(chatEnds[0]).toEqual({
      seq: expect.any(Number),
      ts: expect.any(String),
      type: 'turn/end',
      turnId: chatResult.turnId,
      kind: 'success',
      stats: { steps: 1, toolCalls: 0, durationMs: expect.any(Number) },
    });
    expect('finishReason' in chatEnds[0]!).toBe(false);
    expect(chatAfterTurn).toEqual([{ turnId: chatResult.turnId, kind: 'success' }]);
    await chatRun.session.close();

    // ②-b 无 `finishReason`：流式 `message_end` 不带该字段 ⇒ 归一为 'stop'（不是截断）
    const streamRun = await makeLoop(dir, new StreamNoFinishProvider());
    const streamResult = await streamRun.loop.runTurn('普通流式回答');
    expect(streamResult.kind).toBe('success');
    expect(streamResult.finalText).toBe('NORMAL-STREAM-TEXT');
    const streamEnds = turnEnds(streamRun.session.replay());
    expect(streamEnds).toHaveLength(1);
    expect(Object.keys(streamEnds[0]!).sort()).toEqual(PLAIN_TURN_END_KEYS);
    expect('finishReason' in streamEnds[0]!).toBe(false);
    await streamRun.session.close();
  });

  it('③ 负对照：有工具调用的回合流程逐字不变（含"工具调用响应自称 length"也不改结束语义）', async () => {
    // ③-a 常规工具回合：工具调用 → 工具结果 → 纯文本收尾
    const dispatched: ToolCall[] = [];
    const normal = new ScriptedFinishProvider([
      resp('tool_calls', '', [{ id: 'tc_1', name: 'Stub', arguments: { path: 'README.md' } }]),
      resp('stop', 'FINAL-AFTER-TOOL'),
    ]);
    const normalRun = await makeLoop(dir, normal, {
      runTool: async (call) => {
        dispatched.push(call);
        return { content: 'TOOL-OK', meta: {} };
      },
    });

    const normalResult = await normalRun.loop.runTurn('读一下 README');

    expect(normalResult.kind).toBe('success');
    expect(normalResult.steps).toBe(2);
    expect(normalResult.toolCalls).toBe(1);
    expect(normalResult.finalText).toBe('FINAL-AFTER-TOOL');
    expect(dispatched).toHaveLength(1);
    expect(normalRun.session.replay().some((r) => r.type === 'tool/result')).toBe(true);
    const normalEnds = turnEnds(normalRun.session.replay());
    expect(normalEnds).toHaveLength(1);
    expect(Object.keys(normalEnds[0]!).sort()).toEqual(PLAIN_TURN_END_KEYS);
    expect('finishReason' in normalEnds[0]!).toBe(false);
    await normalRun.session.close();

    // ③-b **工具调用那次响应自称 length**（provider 在工具调用中途被截断）：流程照旧 ——
    // 工具照常派发、继续下一步、由"纯文本停"那次响应（'stop'）决定收尾。
    // 已知边界（本卡不动工具调用回合的结束语义）：这条 length 不落 turn/end，见交付 ⑤。
    const dispatchedTruncated: ToolCall[] = [];
    const truncatedToolTurn = new ScriptedFinishProvider([
      resp('length', '', [{ id: 'tc_1', name: 'Stub', arguments: {} }]),
      resp('stop', 'FINAL-AFTER-TRUNCATED-TOOL'),
    ]);
    const truncatedRun = await makeLoop(dir, truncatedToolTurn, {
      runTool: async (call) => {
        dispatchedTruncated.push(call);
        return { content: 'TOOL-OK', meta: {} };
      },
    });

    const truncatedResult = await truncatedRun.loop.runTurn('截断在工具调用里');

    expect(truncatedResult.kind).toBe('success'); // 有工具调用 ⇒ 本卡判据不介入
    expect(truncatedResult.steps).toBe(2);
    expect(truncatedResult.toolCalls).toBe(1);
    expect(dispatchedTruncated).toHaveLength(1); // 工具照常被派发（流程不变）
    const truncatedEnds = turnEnds(truncatedRun.session.replay());
    expect(truncatedEnds).toHaveLength(1);
    expect(Object.keys(truncatedEnds[0]!).sort()).toEqual(PLAIN_TURN_END_KEYS);
    expect('finishReason' in truncatedEnds[0]!).toBe(false);
    await truncatedRun.session.close();
  });

  it('④ 与既有 budget 兜底的关系：length+空文本 ⇒ error（不落 budget）；纯步数预算仍 ⇒ budget', async () => {
    // ④-a `finishReason='length'` 且 `finalText===''`：两个判据同时成立 ⇒ 截断判定在前，取 'error'。
    // 取 'budget' 会让这次截断继续以退出码 0 / HTTP 200 对外呈现（等于没修），且 'budget' 的原意是
    // "停因不明/步数耗尽"，而这里有明确停因。
    const emptyTruncated = new ScriptedFinishProvider([resp('length', '')]);
    const truncatedRun = await makeLoop(dir, emptyTruncated);
    const truncatedResult = await truncatedRun.loop.runTurn('空回答被截断');

    expect(truncatedResult.kind).toBe('error');
    expect(truncatedResult.kind).not.toBe('budget'); // 兜底不得盖掉明确的截断停因
    expect(truncatedResult.finalText).toBe('');
    const truncatedEnd = turnEnds(truncatedRun.session.replay())[0]!;
    expect(truncatedEnd.kind).toBe('error');
    expect(truncatedFinishReason(truncatedEnd)).toBe('length');
    await truncatedRun.session.close();

    // ④-b 负对照：**纯步数预算**（模型一直发工具调用，撞上 maxSteps）仍报 'budget'，
    // 且不新增 finishReason 键（本卡只改"纯文本停且 finishReason=length"这一条路径）
    const looping = new ScriptedFinishProvider([
      resp('tool_calls', '', [{ id: 'tc_1', name: 'Stub', arguments: {} }]),
    ]);
    const budgetRun = await makeLoop(dir, looping, { maxSteps: 1 });
    const budgetResult = await budgetRun.loop.runTurn('一直调工具');

    expect(budgetResult.kind).toBe('budget');
    expect(budgetResult.finalText).toBe('');
    const budgetEnd = turnEnds(budgetRun.session.replay())[0]!;
    expect(budgetEnd.kind).toBe('budget');
    expect(Object.keys(budgetEnd).sort()).toEqual(PLAIN_TURN_END_KEYS);
    expect('finishReason' in budgetEnd).toBe(false);
    await budgetRun.session.close();
  });
});
