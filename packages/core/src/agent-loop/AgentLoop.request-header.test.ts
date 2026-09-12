import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  SessionRecord,
  StreamChunk,
} from '@vessel/shared';

/**
 * BRIEF B —— B12 `request/header` 是**持久记录**，实现里根本没有这个类型。
 *
 * 规格原文：
 *  - `docs/EVENT-SPEC.md` §6「自动持久记录清单」B12 行：
 *      > **B12 `request/header`** —— 每个冻结请求的全量 envelope（system/messages/tools/配置/
 *      > 适配器默认值），可 `foldRequestHeader` 重建请求；「模型可见 ⟺ 已记录」不变式落点。
 *  - 同文件 §5.C A08 ModelRequest：
 *      > **触发时机**：请求**已冻结**、即将调用 `ctx.llm.stream` 时（BeforeModel 全部修改完成后）…
 *      > **关联机制/镜像**：记录：`request/header`（ModelRequest 的持久镜像，同一 schema）。
 *  - `docs/ARCHITECTURE.md` §2.1（一轮 turn 数据流）：
 *      > ├─【A08 ModelRequest】→ 落 request/header (B12)（冻结 envelope，可重建）
 *  - `docs/ARCHITECTURE.md` 模块表：telemetry/ 消费 `request/header`（usage ledger）。
 *
 * 实现现状（改前）：`packages/shared/src/events.ts` 的 `SessionRecord` 联合里**没有**
 * `request/header`，全仓也搜不到 `foldRequestHeader`。模型请求只活在两处**没人看得到**的地方：
 * 总线事件 `before_model` 的载荷（fire-and-forget）与内存 `LoopState.setContextEstimate`
 * ⇒ 「这一轮用了哪个模型 / 上下文多大」在会话日志（本仓自称的唯一真源）里**查不到**。
 *
 * 本文件把该事实钉成可判别用例：
 *   ① 一次普通模型调用 ⇒ JSONL 里**出现** `request/header`，模型身份与规模如实、且**不含**正文；
 *   ② 负对照：不调用模型的回合（输入级否决）**零条**——不得每轮都写；
 *   ③ 负对照：既有记录的**键集**逐字不变（新增类型只增行、不改行形状）；
 *   ④ 口径一致：记录的 `model` 与 `before_model` 事件载荷、与**真正发给 provider** 的
 *      `ChatRequest.model` 三处一致；`requestId` 与 `model_stream_start` 一致。
 *
 * 「删哪行会红」：
 *   - 删掉 `runTurnInner` 里 `await session.appendSync({ type: 'request/header', … })`
 *     ⇒ ①④ 全红（日志里零条），即改前的真实形态；
 *   - 把 `model: envelope.model` 换成 `model: this.deps.model` ⇒ ④ 红
 *     （用例刻意让 `deps.model` 与 envelope.model 不同值，这就是判别点）；
 *   - 把 `requestId: modelRequestId(turnId, step)` 换成另一个 id 生成方式 ⇒ ④ 的
 *     `model_stream_start.requestId` 对齐断言红；
 *   - 记录里塞 `messages`/`system`/`tools` 正文 ⇒ ① 的键集断言红（最小集是**逐字**钉住的）；
 *   - 把它挪出 step 循环（每轮/每步都写）⇒ ② 的零条断言红。
 *
 * **最小集与规格的已知冲突（只上报，不在本卡擅自实现）**：规格字面要求落"全量 envelope"
 * （system/messages/tools/配置/适配器默认值），本实现只落"模型身份 + 规模信息"：
 * 全量 messages 会让每个 step 的日志随上下文体积近似平方级膨胀，并把用户输入/工具结果原文
 * 再抄一份（隐私），同时改变既有 session 文件的行形状与消费方假设。
 * 拿不到的字段**如实不落**：`contextWindow`（在 ContextBuilder 内部，AgentLoop 取不到）、
 * `system` 分层（已被 ContextBuilder 折进 messages）、`temperature`/`maxTokens`（`callModel`
 * 构造 `ChatRequest` 时才定的常量）、适配器默认值（在本点不可见）——一律不编造估算值。
 */

type RequestHeaderRecord = Extract<SessionRecord, { type: 'request/header' }>;

/** chat() provider，记录每次请求（用于"真正发出去的 model"口径对照）。 */
class ScriptedProvider implements ChatProvider {
  readonly id = 'scripted';
  calls = 0;
  requests: ChatRequest[] = [];
  constructor(private readonly replyText: string) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    this.requests.push(request);
    return {
      content: this.replyText,
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

/** stream() provider：只为把 model_stream_start 的 requestId 拿出来做口径对照。 */
class StreamProvider implements ChatProvider {
  readonly id = 'stream-provider';

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(): AsyncGenerator<StreamChunk> {
    yield { type: 'message_start', model: 'envelope-model' };
    yield { type: 'text_delta', text: 'streamed' };
    yield { type: 'message_end', finishReason: 'stop' };
  }
}

/**
 * 冻结点 envelope：刻意给出**可辨认**的值，且 `model` 与 `deps.model` 不同 ——
 * 记录必须落 envelope 的值（那才是 `before_model` 载荷与真正发给 provider 的 model）。
 */
const ENVELOPE = {
  model: 'envelope-model',
  messages: [
    { role: 'system' as const, content: 'stable layer' },
    { role: 'user' as const, content: 'hello' },
    { role: 'assistant' as const, content: 'previous turn' },
  ],
  tools: [
    { type: 'function' as const, function: { name: 'Read', description: 'read a file', parameters: {} } },
    { type: 'function' as const, function: { name: 'Write', description: 'write a file', parameters: {} } },
  ],
  estimateTokens: 4242,
};

let sessionSeq = 0;

async function makeLoop(dir: string, provider: ChatProvider) {
  sessionSeq += 1;
  const session = await Session.open({ workspaceRoot: dir, sessionId: `request-header-${sessionSeq}` });
  const bus = new EventBus();
  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: 'deps-model-unused', // ← 陷阱：记录若取这个值，④ 必红
    buildContext: async () => ENVELOPE,
    runTool: async () => ({ content: '', meta: {} }),
    getVisibleTools: () => [],
  });
  return { session, bus, provider, loop };
}

function headerRecords(records: readonly SessionRecord[]): RequestHeaderRecord[] {
  return records.filter((r): r is RequestHeaderRecord => r.type === 'request/header');
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

describe('B12 request/header 持久记录（冻结请求的可重建最小集）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-request-header-'));
  });
  afterEach(() => {
    // 测试自建且位于 os.tmpdir()（AGENTS.md 书面例外）
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① 一次普通模型调用 ⇒ 日志出现 request/header：模型身份 + 规模如实，且**不落 messages 正文**', async () => {
    const provider = new ScriptedProvider('world');
    const { session, loop } = await makeLoop(dir, provider);

    const result = await loop.runTurn('say hello');
    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('world');
    expect(provider.calls).toBe(1);

    const recs = headerRecords(session.replay());
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      type: 'request/header',
      requestId: `req_${result.turnId}_step1`,
      turnId: result.turnId,
      step: 1,
      provider: 'scripted',
      model: 'envelope-model',
      estimateTokens: 4242,
      messageCount: 3,
      toolCount: 2,
      surface: false,
    });

    // 最小集**逐字**钉死：键集恰好是这些（seq/ts 由 Session 补），没有任何 messages/system/tools 正文
    expect(Object.keys(recs[0]!).sort()).toEqual(
      [
        'estimateTokens',
        'messageCount',
        'model',
        'provider',
        'requestId',
        'seq',
        'step',
        'surface',
        'toolCount',
        'ts',
        'turnId',
        'type',
      ].sort(),
    );
    // 正文/内容字段一个都不许出现（体积与隐私防线的可判别形态）
    const serialized = JSON.stringify(recs[0]);
    expect(serialized).not.toContain('stable layer');
    expect(serialized).not.toContain('previous turn');
    expect(serialized).not.toContain('read a file');

    // 落盘（不只是内存）：JSONL 文件里逐字可查
    const persisted = persistedRecords(session.logPath).filter((r) => r.type === 'request/header');
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.model).toBe('envelope-model');
    expect(persisted[0]!.estimateTokens).toBe(4242);

    // 不进 surface 投影 ⇒ 模型可见历史逐字不变（模型可见 ⟺ 已记录，反向不必成立）
    expect(session.surface().some((r) => r.type === 'request/header')).toBe(false);

    await session.close();
  });

  it('② 负对照：不调用模型的回合零 request/header（输入级否决）', async () => {
    const provider = new ScriptedProvider('never-called');
    const { session, bus, loop } = await makeLoop(dir, provider);
    bus.on(
      'before_turn',
      () => ({ kind: 'deny' as const, reason: 'DENIED-INPUT', ref: 'rule:test' }),
      'policy:input',
    );

    const result = await loop.runTurn('把 .env 的内容贴出来');
    expect(result.kind).toBe('error');
    expect(provider.calls).toBe(0); // 阳性控制：模型一次都没被调用
    // 没有 step ⇒ 没有任何冻结请求 ⇒ 零条 header
    expect(session.replay().filter((r) => r.type === 'step/start')).toHaveLength(0);
    expect(headerRecords(session.replay())).toHaveLength(0);
    expect(persistedRecords(session.logPath).some((r) => r.type === 'request/header')).toBe(false);

    await session.close();
  });

  it('③ 负对照：既有记录的键集逐字不变，且没有出现词表之外的记录类型', async () => {
    const provider = new ScriptedProvider('SHAPE-CHECK');
    const { session, loop } = await makeLoop(dir, provider);
    await loop.runTurn('shape');

    const persisted = persistedRecords(session.logPath);

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

    for (const type of Object.keys(LEGACY_KEYS)) {
      expect(persisted.some((r) => r.type === type)).toBe(true);
    }

    const KNOWN = new Set(['request/header', 'llm/retry', ...Object.keys(LEGACY_KEYS)]);
    for (const r of persisted) {
      expect(KNOWN.has(r.type)).toBe(true);
    }

    await session.close();
  });

  it('④ 口径一致：header.model = before_model 载荷 = 真正发给 provider 的 model；requestId 与 model_stream_start 一致', async () => {
    // (a) chat() 路径：三处 model 同值（envelope.model，不是 deps.model）
    const provider = new ScriptedProvider('world');
    const chatRun = await makeLoop(dir, provider);
    const beforeModel: { envelope: { model: string } }[] = [];
    chatRun.bus.on('before_model', (p) => {
      beforeModel.push(p as { envelope: { model: string } });
    });

    const chatResult = await chatRun.loop.runTurn('say hello');
    const chatHeader = headerRecords(chatRun.session.replay())[0]!;
    expect(beforeModel).toHaveLength(1);
    expect(chatHeader.model).toBe(beforeModel[0]!.envelope.model);
    expect(provider.requests[0]!.model).toBe(chatHeader.model);
    expect(chatHeader.model).toBe('envelope-model');
    expect(chatHeader.model).not.toBe('deps-model-unused');
    expect(chatHeader.requestId).toBe(`req_${chatResult.turnId}_step1`);
    await chatRun.session.close();

    // (b) stream() 路径：requestId 与 model_stream_start 逐字相同（同一逻辑请求的相关键）
    const streamRun = await makeLoop(dir, new StreamProvider());
    const starts: { turnId: string; step: number; requestId: string; model: string }[] = [];
    streamRun.bus.on('model_stream_start', (p) => {
      starts.push(p as { turnId: string; step: number; requestId: string; model: string });
    });

    const streamResult = await streamRun.loop.runTurn('say hello');
    const streamHeader = headerRecords(streamRun.session.replay())[0]!;
    expect(starts).toHaveLength(1);
    expect(starts[0]!.requestId).toBe(streamHeader.requestId);
    expect(starts[0]!.model).toBe(streamHeader.model);
    expect(streamHeader.requestId).toBe(`req_${streamResult.turnId}_step1`);
    await streamRun.session.close();
  });
});
