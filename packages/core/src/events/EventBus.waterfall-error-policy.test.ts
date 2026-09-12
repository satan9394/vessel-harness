import { describe, it, expect, vi } from 'vitest';
import {
  EventBus,
  LISTENER_ERROR_REF_PREFIX,
  isListenerErrorRef,
  type WaterfallOptions,
  type WaterfallOutcome,
} from './EventBus.js';

/**
 * BRIEF-决策点 fail-open 的判别性用例。
 *
 * 修复前的 `waterfall` 在监听器抛错时执行 `catch → onListenerError → continue`，
 * `current` 因此停在 `{kind:'defer'}` —— 等于"该监听器没有意见"。AgentLoop 的
 * `before_tool` 门禁只判 `deny`，于是**一个抛错的拦截器 = 静默放行**。
 *
 * 修复后每个调用点显式声明 `listenerErrorPolicy`：安全门禁点 `'fail-closed'`
 * （抛错 ⇒ 带 `listener-error:<listenerName>` 标记的 deny），辅助决策点 `'defer'`
 * （保持历史语义，但错误仍以 `handler_error` 留痕）。
 *
 * BRIEF-决策点 fail-closed 长期成立（本文件 ⑥ 段）：安全门禁点（`'before_tool'` /
 * `'before_delegate'`）的 `listenerErrorPolicy` 现在**类型层必填** —— 漏声明 = `tsc` 红，
 * 而不是运行期静默回到 `'defer'`（fail-open）。运行期默认值本身未变（仍是 `'defer'`），
 * 因此需要验证"默认值语义"的用例必须显式绕过类型（见 {@link untypedWaterfall}）。
 */

type HandlerErrorPayload = {
  eventName: string;
  listenerId: string;
  error: { kind: string; message: string };
  policy?: string;
  verdict?: string;
  agentId?: unknown;
};

/**
 * "未接线的 JS / 动态事件名调用点"的替身：签名里 `opts` 可省。
 *
 * 这个签名**在 typed 调用点已无法表达**（安全点的 `listenerErrorPolicy` 必填），
 * 所以凡是需要验证"运行期忽略策略时默认是 `'defer'`"的用例都必须经由它显式绕过类型；
 * 绕过这件事本身，就是"如果没有类型层，口子长什么样"的证据。
 */
function untypedWaterfall(
  bus: EventBus,
  type: string,
  payload: unknown,
  opts?: WaterfallOptions,
): Promise<WaterfallOutcome> {
  const loose = bus.waterfall as unknown as (
    t: string,
    p: unknown,
    o?: WaterfallOptions,
  ) => Promise<WaterfallOutcome>;
  // MUST be called with the receiver: detaching the method (loose(...)) leaves
  // `this` undefined and blows up on `this.listeners`. Binding here keeps the
  // bypass to the *type* layer only — the runtime path is the real method.
  return loose.call(bus, type, payload, opts);
}

describe('EventBus.waterfall — 监听器错误策略（BRIEF-决策点 fail-open）', () => {
  // ── 复现件：修复前的语义就是"抛错 ⇒ 没有意见 ⇒ 未拒绝" ─────────────────────
  it('REPRO（旧语义 catch→continue）：抛错的 before_tool 监听器 ⇒ 结果未拒绝（defer）⇒ 工具会照常执行', async () => {
    const bus = new EventBus();
    bus.on(
      'before_tool',
      () => {
        throw new Error('policy engine exploded');
      },
      'policy:engine',
    );

    // 旧代码的 catch 分支逐字等价于显式声明 'defer'（抛错 = 该监听器没有意见）
    const legacy = await bus.waterfall('before_tool', {}, { listenerErrorPolicy: 'defer' });
    expect(legacy.result.kind).toBe('defer');
    expect(legacy.result.kind).not.toBe('deny'); // AgentLoop 只判 deny ⇒ 落到执行分支
    expect(legacy.listenerErrors.map((e) => e.listener)).toEqual(['policy:engine']);

    // 同一场景 + 生产调用点显式声明的策略 ⇒ 明确拒绝
    const fixed = await bus.waterfall('before_tool', {}, { listenerErrorPolicy: 'fail-closed' });
    expect(fixed.result.kind).toBe('deny');
  });

  // ── ① 抛错 ⇒ 必须拒绝 ────────────────────────────────────────────────────
  it('① 安全门禁点 fail-closed：抛错的监听器铸出带 listener-error 标记的拒绝，绝不"没有意见"', async () => {
    const bus = new EventBus();
    bus.on(
      'before_tool',
      () => {
        throw new Error('policy engine exploded');
      },
      'policy:engine',
    );

    const out = await bus.waterfall('before_tool', {}, { listenerErrorPolicy: 'fail-closed' });

    // ← 把 EventBus 的 catch 分支改回 `continue`（删掉修复）⇒ 这里变 'defer' ⇒ 必红
    expect(out.result.kind).toBe('deny');
    if (out.result.kind !== 'deny') throw new Error(`expected deny, got ${out.result.kind}`);
    // 可机读标记：ref 与 reason 都带 listener-error:<listenerName>
    expect(out.result.ref).toBe(`${LISTENER_ERROR_REF_PREFIX}policy:engine`);
    expect(isListenerErrorRef(out.result.ref)).toBe(true);
    expect(out.result.reason).toBe(`${LISTENER_ERROR_REF_PREFIX}policy:engine: policy engine exploded`);
    // 审计面：谁抛的、抛了什么
    expect(out.listenerErrors).toHaveLength(1);
    expect(out.listenerErrors[0]?.listener).toBe('policy:engine');
    expect((out.listenerErrors[0]?.error as Error).message).toBe('policy engine exploded');
    // vetoes 如实记录这次否决
    expect(out.vetoes.map((v) => v.listener)).toEqual(['policy:engine']);
  });

  it('①b fail-closed 短路：抛错之后的监听器不再运行（其后的 allow/deny 都改变不了结论）', async () => {
    const bus = new EventBus();
    const ran: string[] = [];
    bus.on(
      'before_tool',
      () => {
        ran.push('boom');
        throw new Error('interceptor crashed');
      },
      'interceptor',
    );
    bus.on('before_tool', () => {
      ran.push('allow-after');
      return { kind: 'allow' as const };
    }, 'allow-after');

    const out = await bus.waterfall('before_tool', {}, { listenerErrorPolicy: 'fail-closed' });

    expect(ran).toEqual(['boom']);
    expect(out.result.kind).toBe('deny');
  });

  // ── ② 负对照：不能变成"一律拒绝" ──────────────────────────────────────────
  it('② 负对照：无监听器 / 返回 void / 返回 defer ⇒ 在同一个 fail-closed 策略下仍然放行', async () => {
    const none = new EventBus();
    const noneOut = await none.waterfall('before_tool', {}, { listenerErrorPolicy: 'fail-closed' });
    expect(noneOut.result.kind).toBe('defer');
    expect(noneOut.listenerErrors).toEqual([]);

    const bus = new EventBus();
    const calls: string[] = [];
    bus.on('before_tool', () => {
      calls.push('void');
    }, 'observer');
    bus.on('before_tool', () => ({ kind: 'defer' as const }), 'deferrer');
    const out = await bus.waterfall('before_tool', {}, { listenerErrorPolicy: 'fail-closed' });

    expect(out.result.kind).toBe('defer'); // ← 没有被"一律拒绝"掐死
    expect(calls).toEqual(['void']);
    expect(out.vetoes).toEqual([]);
    expect(out.listenerErrors).toEqual([]);
  });

  // ── ③ 正向：正常 deny 路径行为不变 ────────────────────────────────────────
  it('③ 正向：正常 deny 监听器仍然拒绝，reason/ref 与今日完全一致', async () => {
    const bus = new EventBus();
    bus.on(
      'before_tool',
      () => ({ kind: 'deny' as const, reason: 'blocked by policy', ref: 'rule:no-rm' }),
      'policy:engine',
    );
    const out = await bus.waterfall('before_tool', {}, { listenerErrorPolicy: 'fail-closed' });
    expect(out.result).toEqual({ kind: 'deny', reason: 'blocked by policy', ref: 'rule:no-rm' });
    expect(out.vetoes).toEqual([{ listener: 'policy:engine', result: { kind: 'deny', reason: 'blocked by policy', ref: 'rule:no-rm' } }]);
    expect(out.listenerErrors).toEqual([]);
  });

  it('③b 单调性：fail-closed 铸出的 deny 不会被 guard 放宽（narrow 只能更严）', async () => {
    const bus = new EventBus();
    bus.on('before_tool', () => {
      throw new Error('boom');
    }, 'bad');
    const out = await bus.waterfall(
      'before_tool',
      {},
      { listenerErrorPolicy: 'fail-closed', guard: 'allow' },
    );
    expect(out.result.kind).toBe('deny');

    // 既有 guard 语义不受影响：无监听器 + guard 'ask' ⇒ ask
    const guardOnly = await bus.waterfall('before_model', {}, { guard: 'ask' });
    expect(guardOnly.result.kind).toBe('ask');
  });

  it('ask 策略：抛错 ⇒ 显式 ask（仍带可机读标记，下游 approval=never 会 fail-closed 拒绝）', async () => {
    const bus = new EventBus();
    bus.on('before_delegate', () => {
      throw new Error('delegate hook down');
    }, 'delegate-hook');
    const out = await bus.waterfall('before_delegate', {}, { listenerErrorPolicy: 'ask' });
    expect(out.result.kind).toBe('ask');
    if (out.result.kind !== 'ask') throw new Error('unreachable');
    expect(out.result.ref).toBe(`${LISTENER_ERROR_REF_PREFIX}delegate-hook`);
    expect(out.result.reason).toContain('delegate hook down');
  });

  // ── ④ emit 的观察型语义必须原样保留 ──────────────────────────────────────
  it('④ emit() 观察型语义不变：监听器抛错既不打断 emit，也不产生任何裁决', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('before_tool', () => {
      throw new Error('observer boom');
    }, 'observer');
    bus.on('before_tool', () => {
      seen.push('after');
    }, 'after');

    await expect(bus.emit('before_tool', { x: 1 })).resolves.toBeUndefined();
    expect(seen).toEqual(['after']); // 抛错没有打断主循环
  });

  // ── ⑤ 审计事件确实被铸出 ─────────────────────────────────────────────────
  it('⑤ 审计：抛错被铸成 handler_error（谁 / 哪个 type / 什么原因 / 采取的策略）', async () => {
    const bus = new EventBus();
    const minted: HandlerErrorPayload[] = [];
    bus.on('handler_error', (p) => {
      minted.push(p as HandlerErrorPayload);
    }, 'audit:handler_error');
    bus.on('before_tool', () => {
      throw new TypeError('decide() blew up');
    }, 'policy:engine');

    const out = await bus.waterfall('before_tool', {}, {
      listenerErrorPolicy: 'fail-closed',
      ctx: { agentId: 'agent-7' },
    });

    expect(out.result.kind).toBe('deny');
    expect(minted).toHaveLength(1);
    expect(minted[0]).toEqual({
      eventName: 'before_tool',
      listenerId: 'policy:engine',
      error: { kind: 'TypeError', message: 'decide() blew up' },
      policy: 'fail-closed',
      verdict: 'deny',
      agentId: 'agent-7',
    });
  });

  it('默认策略（省略 listenerErrorPolicy）= defer：既有调用点语义不变，但错误仍被上报', async () => {
    const bus = new EventBus();
    const onErr = vi.fn();
    bus.on('before_tool', () => {
      throw new Error('boom');
    }, 'bad');
    bus.on('before_tool', () => ({ kind: 'deny' as const, reason: 'after-error' }), 'later');

    // 省略策略的调用形态现在只能经 untypedWaterfall 表达（typed 安全点已必填）；
    // 断言与改动前逐字一致：运行期默认仍是 'defer'（链继续 → 后续 deny 生效）。
    const out = await untypedWaterfall(bus, 'before_tool', {}, { ctx: { onListenerError: onErr } });

    expect(out.result.kind).toBe('deny'); // 链继续 → 后续 deny 生效（历史行为，未变）
    expect(onErr).toHaveBeenCalledWith('before_tool', 'bad', expect.any(Error));
  });

  it('诊断回调 onListenerError 自身抛错，不得改变本决策点的错误策略', async () => {
    const bus = new EventBus();
    bus.on('before_tool', () => {
      throw new Error('boom');
    }, 'bad');
    const out = await bus.waterfall('before_tool', {}, {
      listenerErrorPolicy: 'fail-closed',
      ctx: {
        onListenerError: () => {
          throw new Error('diagnostic callback is broken too');
        },
      },
    });
    expect(out.result.kind).toBe('deny');
  });

  // ── ⑥ 口子的复现 + 类型层封堵（BRIEF-决策点 fail-closed 长期成立）─────────────
  it('REPRO-③ 漏声明（绕过类型层）在安全点仍是 defer ⇒ 抛错的拦截器 = 静默放行（这正是要堵的口子）', async () => {
    const bus = new EventBus();
    bus.on(
      'before_tool',
      () => {
        throw new Error('interceptor exploded');
      },
      'policy:engine',
    );

    // 运行期默认值没有变（仍是 'defer'，兼容 JS / 动态事件名调用点）——
    // 所以"漏声明"必须由**类型层**兜住，而不是指望运行期默认值自己变严。
    const out = await untypedWaterfall(bus, 'before_tool', {});

    expect(out.result.kind).toBe('defer'); // ← 没有拒绝
    expect(out.result.kind).not.toBe('deny'); // ← AgentLoop 只判 deny ⇒ 工具照常执行
    expect(out.listenerErrors.map((e) => e.listener)).toEqual(['policy:engine']);
    expect(out.vetoes).toEqual([]);
  });

  it('⑥ 类型层判别：安全点省略 listenerErrorPolicy 是编译期错误（@ts-expect-error 反向自检）', async () => {
    const bus = new EventBus();

    // 下面两行**必须**编译不过（TS2769：没有任何一条重载匹配）。
    // 若有人删掉 EventBus 的安全点类型约束 ⇒ 它们编译通过 ⇒ 指令变成"未使用的
    // 抑制指令（TS2578）"⇒ `tsc -b` 立刻变红。这就是"删掉修复就红"的类型级判据。
    // 注意：本注释**刻意不写指令字面量的行首形态** —— 以它开头的一行会被 TS 当成真指令，
    // 从而要求下一行有错（下一行是注释）并报 TS2578（本卡第一版正是栽在这里）。
    // @ts-expect-error 安全门禁点 before_tool：不带第三个参数（漏声明 listenerErrorPolicy）
    const missing = await bus.waterfall('before_tool', {});
    // @ts-expect-error 安全门禁点 before_tool：带了 opts 但缺必填的 listenerErrorPolicy
    const alsoMissing = await bus.waterfall('before_tool', {}, { ctx: { agentId: 'a1' } });

    // 运行期行为未变：没有监听器 ⇒ defer，且不铸任何监听器错误（本卡不改行为）。
    expect(missing.result.kind).toBe('defer');
    expect(missing.listenerErrors).toEqual([]);
    expect(missing.vetoes).toEqual([]);
    expect(alsoMissing.result.kind).toBe('defer');

    // 正面对照（这两条必须编译通过）：安全点带策略、非安全点省略策略。
    const declared = await bus.waterfall('before_tool', {}, { listenerErrorPolicy: 'fail-closed' });
    expect(declared.result.kind).toBe('defer'); // 无监听器 ⇒ 策略本身不改变裁决
    const nonSafety = await bus.waterfall('before_turn', {});
    expect(nonSafety.result.kind).toBe('defer');
  });

  it('⑥ 负对照（类型层）：非安全点仍可省略 listenerErrorPolicy，任一事件名也可显式声明策略', async () => {
    const bus = new EventBus();
    const onErr = vi.fn();
    bus.on('before_turn', () => {
      throw new Error('admission hook down');
    }, 'admission');
    bus.on('before_turn', () => ({ kind: 'deny' as const, reason: 'after-error' }), 'later');

    // typed 调用点、不带 opts ⇒ 合法（非安全点保持可选）⇒ 历史默认 'defer'，链继续。
    const omitted = await bus.waterfall('before_turn', {}, { ctx: { onListenerError: onErr } });
    expect(omitted.result.kind).toBe('deny');
    expect(onErr).toHaveBeenCalledWith('before_turn', 'admission', expect.any(Error));

    // 非安全点也可以显式声明三种策略（逐调用点治理没有退化成"只有安全点能用"）。
    const fresh = new EventBus();
    fresh.on('before_turn', () => {
      throw new Error('boom');
    }, 'bad');
    const explicit = await fresh.waterfall('before_turn', {}, { listenerErrorPolicy: 'fail-closed' });
    expect(explicit.result.kind).toBe('deny');

    // 自定义 / 动态事件名：类型上无法判定"是不是安全点"，故一律要求显式声明策略
    // （宁可在安全点多写一个字段，也不留"漏声明即静默 fail-open"的口子）。
    const custom = new EventBus();
    custom.on('custom/decision', () => {
      throw new Error('boom');
    }, 'bad');
    const declared = await custom.waterfall('custom/decision', {}, { listenerErrorPolicy: 'defer' });
    expect(declared.result.kind).toBe('defer'); // 显式 defer ⇒ 抛错 = 没有意见，未拒绝

    // 未声明时运行期默认值仍是 'defer'（绕过类型层的复现件，与 ⑥ 段的判据互为对照）。
    const dynamic = await untypedWaterfall(custom, 'custom/decision', {});
    expect(dynamic.result.kind).toBe('defer');
  });
});
