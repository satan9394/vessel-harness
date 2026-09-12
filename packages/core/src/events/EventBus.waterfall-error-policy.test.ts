import { describe, it, expect, vi } from 'vitest';
import { EventBus, LISTENER_ERROR_REF_PREFIX, isListenerErrorRef } from './EventBus.js';

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
 */

type HandlerErrorPayload = {
  eventName: string;
  listenerId: string;
  error: { kind: string; message: string };
  policy?: string;
  verdict?: string;
  agentId?: unknown;
};

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

    const out = await bus.waterfall('before_tool', {}, { ctx: { onListenerError: onErr } });

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
});
