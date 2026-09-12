import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentLoop, EventBus, Session } from '@vessel/core';
import type { ChatProvider, ChatResponse, SessionRecord, WaterfallResult } from '@vessel/shared';

/**
 * BRIEF「before_stop 的裁决被无视」—— 本卡的裁决是：**如实标注"未接线"，不发明语义**。
 *
 * 复现（改前/改后一致的代码事实，AgentLoop.runTurnInner 收尾段）：
 * ```ts
 * const stop = await bus.serial('before_stop', { turnId, finalText, dispatchedAny });
 * void stop;                      // ← 裁决被丢弃：`stop` 之后再无任何读取点
 * ```
 * 于是监听器返回 `deny` 对回合结果**零影响**：回合照样以原 `kind` 落 `turn/end`，
 * `TurnResult` 的 kind/finalText/steps/toolCalls 与**不挂监听器**时逐字一致。
 * 本文件用例①就是这条事实的可判别版本（阳性控制保证"决策点确实被到达"）。当前**无生产监听器**
 * （`compose.ts` 未注册 before_stop）⇒ 这是一条**潜伏死缝**（与本段已处理的
 * reportStatus / foldSession / Registry.execute 同族）。
 *
 * 为什么本卡**不接线**（而不是"让它看起来有用"）：
 *  1. `docs/EVENT-SPEC.md` §5.B A04 给本点定义的终态裁决是 `forceContinue(reason)`——
 *     "拒绝停"= **必须再走一步**（回到 step 循环）。而 `EventBus.serial` 只返回
 *     `{vetoed, reason}`（EventBus.ts:266），词表里没有 forceContinue，也不区分
 *     "拒绝停"与"拒绝整个回合"。
 *  2. 把 `deny` 解释成 `kind='error'` 与 A04 **反向**（A04 里停点的否决意味着继续，不是失败），
 *     且此时 `step/end`、`assistant/message` 都已落盘、回合事实上已跑完——"事后判失败"该不该改
 *     kind、`finalText` 要不要清空、与紧随其后的 `after_turn` 是什么顺序，**全都没有既定义**。
 *  3. 连载荷都对不上：A04 规定 `{turnId, candidateKind, pendingToolCalls, stats, stopVotes}`，
 *     本点只发 `{turnId, finalText, dispatchedAny}` ⇒ 监听器即使想裁决也拿不到"候选停因"。
 *  4. 无监听器路径必须零变化（今日生产形态）；接线不能靠猜。
 *  ⇒ 按本卡Brief 的既有做法：行为逐字不变 + 代码注释如实标注"未接线"
 *     （AgentLoop.ts 的 A04 注释），并由本文件把"裁决被丢弃"钉成可判别事实。
 *
 * 接线的最小改法（留给后续卡，勿在本卡做）：
 *  ① 给"停点裁决"补词汇：要么把 `EventBus.serial` 的返回值扩成
 *     `{action:'continue', reason}|{action:'stop'}`（A04 的 forceContinue），要么显式改用能表达
 *     "继续"的裁决载体；**先写清语义**（谁有权强制继续、与 max_steps 硬顶/预算如何交互、重入几次）。
 *  ② 载荷补齐 A04 字段（至少 `candidateKind` + `stats`），让监听器有据可裁。
 *  ③ 循环侧需要**回到 step 循环**的能力（当前 `break` 已退出 for 循环；forceContinue 要么复位
 *     `finalText` 并续跑一步，要么走"轮末续做"的既有语义），并明确与 `after_turn`/`turn/end` 的顺序。
 *  ④ 任何裁决都要留审计（"谁裁决、理由是什么"），否则又是一次无审计的裁决。
 *  ⑤ 用例：本文件①（当前行为）必须**有意**更新成新语义，并保留负对照②③。
 *
 * 「删哪行会红」：
 *   ① 删掉 `// ← 未接线（见上）` 那一行（`void stop;`）——**本卡内不会红**（它本来就只标注未使用，
 *      删掉行为完全相同：这正是"未接线"的定义）；但若把它换成任何真实消费（例如
 *      `if (stop.vetoed) kind = 'error'`）⇒ 用例①的"与基线逐字一致"断言 + 用例③的
 *      `turn/end.kind === 'success'` 断言**立刻红**——这就是接线必须连带更新语义与用例的护栏。
 *   ② 把 `bus.serial('before_stop', …)` 整段删掉 ⇒ 用例①的**阳性控制**（监听器确实被调用）
 *      与用例③的载荷形状断言红（防"死缝被悄悄拔掉、连缝都不剩"）。
 *   ③ 负对照②：任何"一律拒绝继续/一律改 kind"的实现 ⇒ 三条无裁决路径与基线不一致 ⇒ 红。
 */

interface BeforeStopPayload {
  turnId: string;
  finalText: string;
  dispatchedAny: boolean;
}

/** 第一步发一次工具调用、第二步纯文本收尾 ⇒ `dispatchedAny=true`、`steps=2`、`kind='success'`。 */
class ScriptedProvider implements ChatProvider {
  readonly id = 'scripted';
  calls = 0;

  async chat(): Promise<ChatResponse> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        content: '',
        toolCalls: [{ id: 'tc_1', name: 'Stub', arguments: {} }],
        finishReason: 'tool_calls',
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    }
    return {
      content: 'FINAL-TEXT-GOLDEN',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

let sessionSeq = 0;

/**
 * 跑一轮真实 `AgentLoop.runTurn`。`stopListener` 省略 = **完全不注册** before_stop 监听器
 * （即今日生产形态：无监听器路径）。
 */
async function runOnce(dir: string, stopListener?: (p: BeforeStopPayload) => WaterfallResult | void) {
  sessionSeq += 1;
  const session = await Session.open({ workspaceRoot: dir, sessionId: `before-stop-verdict-${sessionSeq}` });
  const bus = new EventBus();
  const provider = new ScriptedProvider();
  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: 'scripted',
    buildContext: async () => ({
      model: 'scripted',
      messages: [{ role: 'system' as const, content: 'test' }],
      tools: [],
      estimateTokens: 10,
    }),
    runTool: async () => ({ content: 'TOOL-OK', meta: {} }),
    getVisibleTools: () => [],
  });
  const payloads: BeforeStopPayload[] = [];
  if (stopListener) {
    bus.on(
      'before_stop',
      (p) => {
        const payload = p as BeforeStopPayload;
        payloads.push(payload);
        return stopListener(payload);
      },
      'test:before_stop',
    );
  }
  const result = await loop.runTurn('干活');
  return { session, provider, result, payloads };
}

/** 只比较**回合语义**（turnId/durationMs 天然不同，不参与比较）。 */
function turnShape(result: { kind: string; finalText: string; steps: number; toolCalls: number }) {
  return {
    kind: result.kind,
    finalText: result.finalText,
    steps: result.steps,
    toolCalls: result.toolCalls,
  };
}

function turnEnds(records: readonly SessionRecord[]): Extract<SessionRecord, { type: 'turn/end' }>[] {
  return records.filter((r): r is Extract<SessionRecord, { type: 'turn/end' }> => r.type === 'turn/end');
}

describe('AgentLoop — A04 before_stop 的裁决当前未接线（如实标注；行为逐字不变）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-before-stop-'));
  });
  afterEach(() => {
    // 测试自建且位于 os.tmpdir()（AGENTS.md 书面例外）
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① 监听器返回 deny：决策点确实被到达（阳性控制），但回合结果与"无监听器基线"逐字一致（裁决被丢弃）', async () => {
    const baseline = await runOnce(dir); // 完全不注册 before_stop 监听器
    await baseline.session.close();

    const denied = await runOnce(dir, () => ({ kind: 'deny', reason: '目标未达成，禁止停' }));

    // 阳性控制（判别性关键）：本决策点**确实被到达**，且载荷带的是本回合的真实值 ——
    // 否则下面的"结果无变化"就无法与"监听器根本没被调用"区分。
    expect(denied.payloads).toHaveLength(1);
    expect(denied.payloads[0]?.turnId).toBe(denied.result.turnId);
    expect(denied.payloads[0]?.finalText).toBe('FINAL-TEXT-GOLDEN');
    expect(denied.payloads[0]?.dispatchedAny).toBe(true); // 本回合真的派发过工具（不是常量 false）

    // 裁决被丢弃：`deny` 对回合结果零影响 —— 与基线**逐字一致**（kind/finalText/steps/toolCalls）
    expect(turnShape(denied.result)).toEqual(turnShape(baseline.result));
    expect(denied.result.kind).toBe('success');
    expect(denied.result.finalText).toBe('FINAL-TEXT-GOLDEN');
    expect(denied.result.steps).toBe(2);
    expect(denied.result.toolCalls).toBe(1);

    // 落盘面同样没被改动：turn/end 仍是 kind='success'，且**没有**为这个被丢弃的裁决新造审计
    //（未接线 = 既不执行、也不假装执行）
    const records = denied.session.replay();
    expect(turnEnds(records).map((r) => r.kind)).toEqual(['success']);
    expect(records.filter((r) => r.type === 'audit/denial')).toHaveLength(0);

    await denied.session.close();
  });

  it('② 负对照：无监听器 / 返回 void / 显式 allow 三条路径的回合结果逐字一致（防"接错线一律拒绝"）', async () => {
    const baseline = await runOnce(dir);
    await baseline.session.close();

    const observed = await runOnce(dir, () => {
      /* 纯观察：返回 void = 没有意见 */
    });
    expect(turnShape(observed.result)).toEqual(turnShape(baseline.result));
    await observed.session.close();

    const allowed = await runOnce(dir, () => ({ kind: 'allow' }));
    expect(turnShape(allowed.result)).toEqual(turnShape(baseline.result));
    await allowed.session.close();
  });

  it('③ 未接线的两个可核对事实：载荷形状与 A04 规格不符，且裁决不落任何记录', async () => {
    const run = await runOnce(dir, () => ({ kind: 'deny', reason: '禁止停' }));

    // 事实 1：载荷只有 3 个字段，**缺** A04 规格要求的 candidateKind/stats/stopVotes
    //（EVENT-SPEC §5.B A04）⇒ 监听器即使想裁决也拿不到"候选停因"。接线时这条断言必须被有意更新。
    expect(Object.keys(run.payloads[0] ?? {}).sort()).toEqual(['dispatchedAny', 'finalText', 'turnId']);

    // 事实 2：裁决不落任何记录 —— 会话里除既有 B## 记录外没有为新裁决造的记录
    const records = run.session.replay();
    expect(records.filter((r) => r.type === 'audit/denial')).toHaveLength(0);
    expect(records.filter((r) => r.type === 'audit/decision')).toHaveLength(0);
    // 既有配对不变：turn/start → turn/end 各一条（未接线不得破坏配对）
    expect(records.filter((r) => r.type === 'turn/start')).toHaveLength(1);
    expect(records.filter((r) => r.type === 'turn/end')).toHaveLength(1);

    await run.session.close();
  });
});
