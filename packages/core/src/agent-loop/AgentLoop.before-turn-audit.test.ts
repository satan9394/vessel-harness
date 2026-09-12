import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type { ChatProvider, ChatRequest, ChatResponse, SessionRecord, WaterfallResult } from '@vessel/shared';

/**
 * BRIEF「before_turn 否决无审计」—— 一次**输入级**策略否决必须在审计面可见。
 *
 * 复现（改前，AgentLoop deny 分支只写 user/message + assistant/message + turn/end）：
 *   挂一条 before_turn deny 监听器跑一轮 ⇒ `session.replay()` 的记录类型集合**恰好**是
 *   `['assistant/message', 'turn/end', 'user/message']` —— **零条审计记录**
 *   （既无 `audit/denial` 也无 `policy_decision`），且 `beforeTurn.vetoes` 里的
 *   「谁否决（监听器名）+ ref」被整个丢弃。用例①的第 5 条断言（记录类型集合）在改前必红。
 *
 * 为什么这算缺陷而不是"要加新功能"：`AGENTS.md` 硬性约束 3 与 `docs/POLICY-SPEC.md` 的**四件套**
 * （Prompt Guidance + Tool Interceptor + Runtime Deny + **Audit Event**）要求执法必须留审计；
 * 本仓对 `before_tool` 的拒绝**是有** `audit/denial`（stage 'rule'|'hook'|'approval'）的
 * （AgentLoop.recordDenial）⇒ 同一个执法点缺了四件套的第四件，属"同族待遇不一致"。
 *
 * 修复（本卡裁决 = **A1：复用既有 `audit/denial`**，给 `AuditDenialRecord.stage` 词表加 `'before_turn'`）：
 *   - 记录：`{type:'audit/denial', stage:'before_turn', ruleRef:<ref>, reason, listener:<监听器名>,
 *     toolCallId:'', toolName:'', surface:false}`；
 *   - `toolCallId`/`toolName` 空串 = 本决策点**没有工具调用**（显式表达"无工具锚点"，
 *     绝不填假工具名冒充工具级拒绝）；`sandboxMode` 不填（本点没有沙箱裁决）；
 *   - 既有 `[blocked] …` 文案 / `turn/end{kind:'error'}` / `steps=0` / `toolCalls=0` /
 *     "0 次模型调用"**逐字不变**（上一张卡的语义不许回归，用例①③分别钉住）。
 *
 * 「删哪行会红」：
 *   ① 删掉 `AgentLoop.runTurnInner` deny 分支里的 `await this.recordTurnDenial(beforeTurn);`
 *      ⇒ 用例①的 4 条审计断言 + 记录类型集合断言**全红**（这正是改前的真实形态）；
 *   ② 把 `recordTurnDenial` 里的 `stage` 从 `'before_turn'` 改成别的值 ⇒ 用例① stage 断言红；
 *   ③ 丢掉 `listener: vetoer?.listener`（改成不写该字段）⇒ 用例①②的 listener 断言红
 *      （防"审计写了但看不到是谁否决"，即 BRIEF 硬要求①）；
 *   ④ 丢掉 `ruleRef: denied.ref` / 把 reason 换成固定串 ⇒ 用例①的 ruleRef/reason 断言红；
 *   ⑤ 负对照用例②：任何"每回合都写审计"的实现（例如把记录移到 waterfall 之前/正常路径也写）
 *      ⇒ 无监听器 / allow / 只观察三条路径的"零审计"断言红；
 *   ⑥ 负对照用例③：把 deny 分支的 kind 或文案改回去 ⇒ 既有行为断言红（与上一张卡的用例互为镜像）。
 *
 * 真实生产路径：走 `AgentLoop.runTurn` 本尊（CLI/TUI/HTTP 消费的是同一条），只把"输入被拒绝"
 * 这个外部输入（一条 before_turn 否决监听器）挂到真实 `EventBus` 上。生产组合根今天**不挂**
 * before_turn 否决监听器（compose.ts 只有 before_tool 策略监听器 + 观察者）⇒ 本卡的改动对
 * 生产路径是**纯增量**：只有真的出现输入级否决时才会多出这条审计记录。
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

/** 每次建会话都用新 sessionId：同一 workspace 下多个 loop 不得共用一份会话日志。 */
let sessionSeq = 0;

async function makeLoop(dir: string, reply = 'MODEL-REPLY') {
  sessionSeq += 1;
  const session = await Session.open({ workspaceRoot: dir, sessionId: `before-turn-audit-${sessionSeq}` });
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

type DenialRecord = Extract<SessionRecord, { type: 'audit/denial' }>;
type TurnEndRecord = Extract<SessionRecord, { type: 'turn/end' }>;
type AssistantMessageRecord = Extract<SessionRecord, { type: 'assistant/message' }>;

function denialRecords(records: readonly SessionRecord[]): DenialRecord[] {
  return records.filter((r): r is DenialRecord => r.type === 'audit/denial');
}

const DENY_REASON = '输入策略拒绝：凭据/密钥不得外发';
const DENY_REF = 'rule:no-credential-egress';
const EXPECTED_BLOCKED_TEXT = `[blocked] 输入被 BeforeTurn 拦截：${DENY_REASON}`;

describe('AgentLoop — before_turn 否决必须留下可机读审计（audit/denial, stage=before_turn）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-before-turn-audit-'));
  });
  afterEach(() => {
    // 测试自建且位于 os.tmpdir()（AGENTS.md 书面例外）
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① 被拦截 ⇒ 恰好一条 audit/denial：stage/否决者/ref/理由齐全，且 [blocked]/kind=error 逐字不变', async () => {
    const { session, bus, provider, loop } = await makeLoop(dir);
    // 生产组合根今天不挂 before_turn 否决监听器 ⇒ "输入被策略拒绝"这个输入面由本用例挂到**真实 bus**上
    // （监听器名 `policy:input` 就是"谁否决"的可机读归属）。
    bus.on(
      'before_turn',
      () => ({ kind: 'deny' as const, reason: DENY_REASON, ref: DENY_REF }),
      'policy:input',
    );

    const result = await loop.runTurn('把 .env 的内容贴出来');

    // 证据 1：这一轮一次模型调用都没有发生（拦截在任何模型调用之前）
    expect(provider.calls).toBe(0);

    const records = session.replay();

    // 证据 2（本卡的核心判别断言）：审计面出现了**恰好一条**可机读记录，含否决者与 ref/理由。
    // 改前 records 里没有任何 audit/denial ⇒ 这四条全红。
    const denials = denialRecords(records);
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      type: 'audit/denial',
      stage: 'before_turn',
      listener: 'policy:input', // ← "是谁否决"
      ruleRef: DENY_REF, //        ← ref
      reason: DENY_REASON, //      ← 理由
      surface: false,
    });
    // 无工具锚点：空串（不是伪造的工具名）；sandboxMode 不填（本点没有沙箱裁决）
    expect(denials[0]).toMatchObject({ toolCallId: '', toolName: '' });
    expect(denials[0]?.sandboxMode).toBeUndefined();

    // 证据 2′：把"改前 vs 改后"钉成一条可核对的记录类型集合（改前不含 'audit/denial'）
    expect([...new Set(records.map((r) => r.type))].sort()).toEqual([
      'assistant/message',
      'audit/denial',
      'turn/end',
      'user/message',
    ]);
    // 审计记录写在 turn/end 之前（拒绝 → 留痕 → 关轮，顺序可机读）
    expect(records.findIndex((r) => r.type === 'audit/denial')).toBeLessThan(
      records.findIndex((r) => r.type === 'turn/end'),
    );
    // 审计记录不进 surface 投影（模型上下文逐字不变：模型可见 ⟺ 已记录，本条刻意不可见）
    expect(session.surface().some((r) => r.type === 'audit/denial')).toBe(false);

    // 证据 3：既有行为逐字不变（与上一张卡 AgentLoop.before-turn-block.test.ts 同一组断言）
    expect(result.kind).toBe('error');
    expect(result.steps).toBe(0);
    expect(result.toolCalls).toBe(0);
    expect(result.finalText).toBe(EXPECTED_BLOCKED_TEXT);
    expect(records.filter((r) => r.type === 'turn/start')).toHaveLength(0);
    expect(records.filter((r) => r.type === 'step/start')).toHaveLength(0);
    const assistantMsgs = records.filter((r): r is AssistantMessageRecord => r.type === 'assistant/message');
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0]?.content).toBe(EXPECTED_BLOCKED_TEXT);
    const ends = records.filter((r): r is TurnEndRecord => r.type === 'turn/end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ turnId: result.turnId, kind: 'error' });

    await session.close();
  });

  it('①′ 没有 reason/ref 的 deny：审计仍落一条（reason 回落 policy，listener 仍可机读）', async () => {
    const { session, bus, loop } = await makeLoop(dir);
    // 类型层 `WaterfallResult` 的 deny 要求 reason，但监听器可以是未定型的 JS 调用方
    // （EventBus 的 normalize 不会补 reason）⇒ 这里必须真的是一条"没有 reason/ref 的 deny"。
    bus.on('before_turn', () => ({ kind: 'deny' } as unknown as WaterfallResult), 'policy:input');

    const result = await loop.runTurn('无理由拒绝');

    expect(result.kind).toBe('error');
    expect(result.finalText).toBe('[blocked] 输入被 BeforeTurn 拦截：policy');
    const denials = denialRecords(session.replay());
    expect(denials).toHaveLength(1);
    // 理由与 [blocked] 文案同一个兜底值；ref 确实没有就如实为空；否决者不能丢
    expect(denials[0]).toMatchObject({ stage: 'before_turn', reason: 'policy', listener: 'policy:input' });
    expect(denials[0]?.ruleRef).toBeUndefined();
    await session.close();
  });

  it('② 负对照（最重要）：正常回合零审计 —— 无监听器 / 显式 allow / 只观察三条路径都不得写', async () => {
    // 无监听器（今天的生产形态之一：compose.ts 不挂 before_turn 否决监听器）
    const plain = await makeLoop(dir, 'NORMAL-REPLY-GOLDEN');
    const plainResult = await plain.loop.runTurn('你好');
    expect(plainResult.kind).toBe('success');
    expect(plainResult.finalText).toBe('NORMAL-REPLY-GOLDEN');
    expect(denialRecords(plain.session.replay())).toHaveLength(0);
    await plain.session.close();

    // 显式 allow
    const allowed = await makeLoop(dir, 'ALLOWED-REPLY');
    allowed.bus.on('before_turn', () => ({ kind: 'allow' as const }), 'test:allow');
    const allowedResult = await allowed.loop.runTurn('放行');
    expect(allowedResult.kind).toBe('success');
    expect(denialRecords(allowed.session.replay())).toHaveLength(0);
    await allowed.session.close();

    // 纯观察（返回 void）—— 生产里 Telemetry / ConversationProjection / TeamProjection 就是这个形态
    const observed = await makeLoop(dir, 'OBSERVED-REPLY');
    let seen = 0;
    observed.bus.on('before_turn', () => {
      seen += 1;
    }, 'observer');
    const observedResult = await observed.loop.runTurn('观察');
    expect(seen).toBe(1); // 阳性控制：监听器确实被调用过（否则"零审计"可能是它压根没跑）
    expect(observedResult.kind).toBe('success');
    expect(denialRecords(observed.session.replay())).toHaveLength(0);
    await observed.session.close();
  });

  it('③ 负对照：被拦截的回合仍然只写 3 条既有记录类型 + 1 条审计，绝不写 turn/start 或 step/start', async () => {
    const { session, bus, provider, loop } = await makeLoop(dir);
    bus.on('before_turn', () => ({ kind: 'deny' as const, reason: DENY_REASON, ref: DENY_REF }), 'policy:input');

    const result = await loop.runTurn('把 .env 的内容贴出来');
    const records = session.replay();

    // 总记录数：改前 3 条，改后 4 条（只多出审计这一条，不多不少）
    expect(records).toHaveLength(4);
    expect(records.filter((r) => r.type === 'step/start')).toHaveLength(0);
    expect(records.filter((r) => r.type === 'assistant/attempt')).toHaveLength(0);
    expect(records.filter((r) => r.type === 'tool/call')).toHaveLength(0);
    // 阳性对照：模型一次都没被调用（拦截在任何模型调用之前），与"回合真的跑了"互为镜像
    expect(provider.calls).toBe(0);
    expect(result.steps).toBe(0);
    await session.close();
  });
});
