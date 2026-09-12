import { describe, it, expect, vi } from 'vitest';
import { EventBus, narrow } from './EventBus.js';

describe('EventBus', () => {
  it('emit delivers to all listeners and isolates errors', async () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on('before_tool', (p) => { seen.push(p); });
    bus.on('before_tool', () => { throw new Error('boom'); }, 'bad');
    bus.on('before_tool', (p) => { seen.push(p); });
    await bus.emit('before_tool', { x: 1 });
    expect(seen).toHaveLength(2);
  });

  it('waterfall short-circuits on first terminal result', async () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('before_tool', () => { order.push('l1'); return { kind: 'allow' as const }; });
    bus.on('before_tool', () => { order.push('l2'); return { kind: 'deny' as const, reason: 'no' }; });
    bus.on('before_tool', () => { order.push('l3'); });
    // 本用例验的是 waterfall 的通用机制（不是安全门禁）：安全门禁点现在在类型上要求显式声明策略，
    // 这里写出历史默认 'defer'，与改动前的隐式默认逐字等价，断言不变。
    const out = await bus.waterfall('before_tool', {}, { listenerErrorPolicy: 'defer' });
    expect(out.result.kind).toBe('allow');
    expect(order).toEqual(['l1']);
  });

  it('deny result is never relaxed by guard narrowing (monotonic)', () => {
    expect(narrow({ kind: 'deny', reason: 'x' }, 'ask').kind).toBe('deny');
    expect(narrow({ kind: 'deny', reason: 'x' }, 'allow').kind).toBe('deny');
    expect(narrow({ kind: 'ask', ref: 'r' }, 'allow').kind).toBe('ask');
    expect(narrow({ kind: 'allow' }, 'deny').kind).toBe('deny');
    expect(narrow({ kind: 'allow' }, 'ask').kind).toBe('ask');
  });

  it('serial veto stops the chain', async () => {
    const bus = new EventBus();
    let ran = false;
    bus.on('before_stop', () => ({ kind: 'deny' as const, reason: 'veto' }));
    bus.on('before_stop', () => { ran = true; });
    const r = await bus.serial('before_stop', {});
    expect(r.vetoed).toBe(true);
    expect(ran).toBe(false);
  });

  it('listener error in waterfall does not break the chain', async () => {
    const bus = new EventBus();
    const onErr = vi.fn();
    bus.on('before_tool', () => { throw new Error('boom'); }, 'bad');
    bus.on('before_tool', () => ({ kind: 'deny' as const, reason: 'after-error' }));
    // 同上：显式写出历史默认 'defer'（"抛错 = 该监听器没有意见 ⇒ 链继续"），断言不变。
    const out = await bus.waterfall('before_tool', {}, {
      listenerErrorPolicy: 'defer',
      ctx: { onListenerError: onErr },
    });
    expect(out.result.kind).toBe('deny');
    expect(onErr).toHaveBeenCalledWith('before_tool', 'bad', expect.any(Error));
  });
});
