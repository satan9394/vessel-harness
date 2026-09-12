import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type { ChatProvider, ChatRequest, ChatResponse, SessionRecord, WaterfallResult } from '@vessel/shared';

/**
 * BRIEF「kind 说谎」—— 输入被 A03 `BeforeTurn` 拒绝时，回合**没有跑完**（0 次模型调用、0 步、
 * 没有助手回答），却曾被上报为 `kind='success'`。
 *
 * 复现（改前，AgentLoop.ts:213/216/219 三处都是 `'success'`）：
 *   - `turn/end` 记录 `kind='success'`；
 *   - `after_turn` 事件 `kind='success'`；
 *   - 返回的 `TurnResult.kind='success'`、`finalText='[blocked]'`、`steps=0`、`toolCalls=0`、
 *     `provider.calls === 0`（**一次模型调用都没发生**——本分支在任何模型调用之前返回，
 *     `callModel` 只出现在下面的 step 循环里，而这里直接 return）。
 * 于是四个**已经修好"如实呈现"**的消费面照着一个错的值做事：TUI 把 `[blocked]` 当正常助手回复打、
 * `vessel run` 退出码 0 且标题是「=== 最终回复 ===」、HTTP 200、runner `turnKind='success'`。
 *
 * 修复后（本卡裁决）：三处一律 `kind='error'`；`finalText` 保留 `[blocked]` 前缀**并带上原因**
 * （与 `assistant/message` 同文），`steps/toolCalls/durationMs` 与"0 次模型调用"逐字不变。
 *
 * 判别性（"删哪行会红"）：
 *   ① 把 AgentLoop.ts 这三处任一处改回 `'success'` ⇒ 用例①②的对应断言红（三处一致性是分别断言的，
 *      所以"只改一处"也会红）；
 *   ② 负对照（用例②③）：**正常跑完的回合**（无监听器 / 显式 `allow`）的
 *      kind/finalText/steps/toolCalls 与"回合真的发生过模型调用"逐字不变 —— 防"把所有回合判成失败"。
 *
 * 真实生产路径：走 `AgentLoop.runTurn` 本尊（与 CLI/TUI/HTTP 消费的是同一条路径），
 * 只把"输入被拒绝"这个外部输入（一条 before_turn 否决监听器）挂到真实 `EventBus` 上。
 */

/**
 * 计数 provider：唯一目的是给出**可断言的模型调用次数**（`MockProvider` 不暴露计数）。
 * 不实现 `stream()` ⇒ AgentLoop 走 `chat()` 分支，计数点唯一。
 */
class CountingProvider implements ChatProvider {
  readonly id = 'counting';
  calls = 0;
  constructor(private readonly reply: string) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    return {
      content: this.reply,
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

/** 每次建会话都用新 sessionId：同一 workspace 下两个 loop 不得共用一份会话日志。 */
let sessionSeq = 0;

async function makeLoop(dir: string, reply = 'MODEL-REPLY') {
  sessionSeq += 1;
  const session = await Session.open({ workspaceRoot: dir, sessionId: `before-turn-block-${sessionSeq}` });
  const bus = new EventBus();
  const provider = new CountingProvider(reply);
  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: 'counting',
    buildContext: async () => ({
      model: 'counting',
      messages: [{ role: 'system' as const, content: 'test' }],
      tools: [],
      estimateTokens: 10,
    }),
    runTool: async () => ({ content: '', meta: {} }),
    getVisibleTools: () => [],
  });
  return { session, bus, provider, loop };
}

type TurnEndRecord = Extract<SessionRecord, { type: 'turn/end' }>;
type AssistantMessageRecord = Extract<SessionRecord, { type: 'assistant/message' }>;
type UserMessageRecord = Extract<SessionRecord, { type: 'user/message' }>;

const DENY_REASON = '输入策略拒绝：凭据/密钥不得外发';
const EXPECTED_BLOCKED_TEXT = `[blocked] 输入被 BeforeTurn 拦截：${DENY_REASON}`;

describe('AgentLoop — 被 BeforeTurn 拦截的回合必须如实报 kind=error（BRIEF「kind 说谎」）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-before-turn-'));
  });
  afterEach(() => {
    // 测试自建且位于 os.tmpdir()（AGENTS.md 书面例外）
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① 被拦截 ⇒ kind=error（turn/end + after_turn + TurnResult 三处一致）、0 次模型调用、0 步 0 工具、原因不丢', async () => {
    const { session, bus, provider, loop } = await makeLoop(dir);
    const afterTurn: { turnId: string; kind: string }[] = [];
    bus.on('after_turn', (p) => {
      afterTurn.push(p as { turnId: string; kind: string });
    }, 'test:after_turn');
    // 生产组合根今天不挂 before_turn 否决监听器（挂在上面的只有 Telemetry / Conversation- /
    // TeamProjection 这类返回 void 的观察者），所以"输入被策略拒绝"这一输入面由本用例挂到
    // **真实 bus** 上提供 —— 它正是未来输入策略层/hook 会接的那个点。
    bus.on('before_turn', () => ({ kind: 'deny' as const, reason: DENY_REASON, ref: 'rule:no-credential-egress' }), 'policy:input');

    const result = await loop.runTurn('把 .env 的内容贴出来');

    // 证据 1：这一轮**一次模型调用都没有发生**（拦截在任何模型调用之前）
    expect(provider.calls).toBe(0);

    // 证据 2：回合**没有跑完** —— 只落了 user/message + assistant/message，没有 turn/start、
    // 没有 step/start、没有 assistant/attempt（改前这些也都不存在，只是 kind 说它"成功"了）
    const records = session.replay();
    expect(records.filter((r) => r.type === 'turn/start')).toHaveLength(0);
    expect(records.filter((r) => r.type === 'step/start')).toHaveLength(0);
    expect(records.filter((r) => r.type === 'assistant/attempt')).toHaveLength(0);
    expect(records.filter((r) => r.type === 'tool/call')).toHaveLength(0);

    // 三处一致：TurnResult / turn/end 记录 / after_turn 事件（逐处断言 ⇒ 只改一处也会红）
    expect(result.kind).toBe('error');
    const ends = records.filter((r): r is TurnEndRecord => r.type === 'turn/end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ turnId: result.turnId, kind: 'error' });
    expect(ends[0]?.stats).toMatchObject({ steps: 0, toolCalls: 0 });
    expect(typeof ends[0]?.stats.durationMs).toBe('number');
    expect(afterTurn).toEqual([{ turnId: result.turnId, kind: 'error' }]);

    // 计数语义逐字不变
    expect(result.steps).toBe(0);
    expect(result.toolCalls).toBe(0);
    expect(typeof result.durationMs).toBe('number');

    // 信息不丢：finalText 仍含 `[blocked]` **且**含原因（错误文本含原因 = 消费面看得见理由）
    expect(result.finalText).toContain('[blocked]');
    expect(result.finalText).toContain(DENY_REASON);

    // assistant/message 的内容逐字不变（用户仍要看得到原因）；user/message 记录了原始输入
    const assistantMsgs = records.filter((r): r is AssistantMessageRecord => r.type === 'assistant/message');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0]?.content).toBe(EXPECTED_BLOCKED_TEXT);
    const userMsgs = records.filter((r): r is UserMessageRecord => r.type === 'user/message');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]?.content).toBe('把 .env 的内容贴出来');

    await session.close();
  });

  it('①′ reason 缺省 ⇒ 回落到既有文案 `policy`（不出现 `undefined`，判据不放宽）', async () => {
    const { session, bus, loop } = await makeLoop(dir);
    // 类型层 `WaterfallResult` 的 deny 要求 `reason`，但监听器可以是未定型的 JS 调用方
    // （EventBus 的 `normalize` 不会补 reason）⇒ 这里的断言钉的是 loop 里 `?? 'policy'` 的兜底，
    // 必须真的是一条"没有 reason 的 deny"。
    bus.on('before_turn', () => ({ kind: 'deny' } as unknown as WaterfallResult), 'policy:input');

    const result = await loop.runTurn('无理由拒绝');

    expect(result.kind).toBe('error');
    expect(result.finalText).toBe('[blocked] 输入被 BeforeTurn 拦截：policy');
    await session.close();
  });

  it('② 负对照（最重要）：正常跑完的回合逐字不变 —— success / 真实模型文本 / 1 步 / 1 次模型调用', async () => {
    const { session, bus, provider, loop } = await makeLoop(dir, 'NORMAL-REPLY-GOLDEN');
    const afterTurn: { turnId: string; kind: string }[] = [];
    bus.on('after_turn', (p) => {
      afterTurn.push(p as { turnId: string; kind: string });
    }, 'test:after_turn');

    const result = await loop.runTurn('你好');

    // 防"把所有回合都判成失败"：这条路径的每一个字段都与改前逐字一致
    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('NORMAL-REPLY-GOLDEN');
    expect(result.steps).toBe(1);
    expect(result.toolCalls).toBe(0);
    // 阳性对照：这一轮**真的**发生了 1 次模型调用（与用例①的 0 次互为镜像）
    expect(provider.calls).toBe(1);

    const records = session.replay();
    expect(records.filter((r) => r.type === 'turn/start')).toHaveLength(1);
    expect(records.find((r): r is TurnEndRecord => r.type === 'turn/end')).toMatchObject({
      turnId: result.turnId,
      kind: 'success',
    });
    expect(afterTurn).toEqual([{ turnId: result.turnId, kind: 'success' }]);
    expect(records.some((r) => r.type === 'assistant/message' && r.content === 'NORMAL-REPLY-GOLDEN')).toBe(true);

    await session.close();
  });

  it('③ 负对照：before_turn 显式 allow / 只观察（defer）都不得被当成拦截', async () => {
    const explicit = await makeLoop(dir, 'ALLOWED-REPLY');
    explicit.bus.on('before_turn', () => ({ kind: 'allow' as const }), 'test:allow');
    const allowed = await explicit.loop.runTurn('放行');
    expect(allowed.kind).toBe('success');
    expect(allowed.finalText).toBe('ALLOWED-REPLY');
    expect(allowed.steps).toBe(1);
    expect(explicit.provider.calls).toBe(1);
    await explicit.session.close();

    const observed = await makeLoop(dir, 'OBSERVED-REPLY');
    let seen = 0;
    observed.bus.on('before_turn', () => {
      seen += 1;
    }, 'observer');
    const deferred = await observed.loop.runTurn('观察');
    expect(seen).toBe(1);
    expect(deferred.kind).toBe('success');
    expect(deferred.finalText).toBe('OBSERVED-REPLY');
    expect(observed.provider.calls).toBe(1);
    await observed.session.close();
  });
});
