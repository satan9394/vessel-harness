import { describe, expect, it } from 'vitest';
import { ModPipeline, ModPipelineError } from '../../src/mods/onionPipeline.js';
import type { ModMiddleware } from '../../src/mods/types.js';

const context = { sessionId: 's1', turnIndex: 1, metadata: {} };
const mod = (name: string, priority = 100): ModMiddleware => ({ name, version: '1', priority });

describe('onion pipeline', () => {
  it('orders outer layers by priority and preserves registration ties', async () => {
    const pipeline = new ModPipeline();
    const seen: string[] = [];
    for (const [name, priority] of [['late', 200], ['first', 10], ['tie', 10]] as const) {
      pipeline.register({ ...mod(name, priority), observe: async () => { seen.push(name); } });
    }
    await pipeline.dispatchObserve('before_tool', {}, context);
    expect(seen).toEqual(['first', 'tie', 'late']);
    seen.length = 0;
    await pipeline.dispatchObserve('after_tool', {}, context);
    expect(seen).toEqual(['late', 'tie', 'first']);
    expect(pipeline.unregister('first')).toBe(true);
    expect(pipeline.unregister('missing')).toBe(false);
    expect(pipeline.list().map(m => m.name)).toEqual(['tie', 'late']);
  });

  it('passes rewritten input down the layers and intercepts before execution', async () => {
    const pipeline = new ModPipeline();
    pipeline.register({ ...mod('outer', 1), rewriteToolInput: async (input, ctx) => ({ ...input, tool: ctx.toolName, value: 2 }) });
    pipeline.register({ ...mod('inner', 2), rewriteToolInput: async input => ({ ...input, value: Number(input.value) * 3 }), interceptToolCall: async input => ({ handled: true, result: input.value }) });
    pipeline.register({ ...mod('unreached', 3), interceptToolCall: async () => { throw new Error('must not execute'); } });
    const input = await pipeline.dispatchRewriteToolInput('read', { value: 1 }, context);
    expect(input).toEqual({ value: 6, tool: 'read' });
    expect(await pipeline.dispatchIntercept('read', input, context)).toEqual({ handled: true, result: 6 });
  });

  it('defers when no interceptor handles the call', async () => {
    const pipeline = new ModPipeline();
    pipeline.register({ ...mod('defer'), interceptToolCall: async () => ({ handled: false }) });
    expect(await pipeline.dispatchIntercept('read', {}, context)).toEqual({ handled: false });
  });

  it('latches a failure even after the failing mod is removed', async () => {
    const pipeline = new ModPipeline();
    const seen: string[] = [];
    pipeline.register({ ...mod('failed', 1), observe: async () => { throw new Error('failure'); } });
    pipeline.register({ ...mod('later', 2), observe: async () => { seen.push('later'); } });
    await expect(pipeline.dispatchObserve('turn_start', {}, context)).rejects.toBeInstanceOf(ModPipelineError);
    pipeline.unregister('failed');
    await expect(pipeline.dispatchIntercept('read', {}, context)).rejects.toThrow('failed closed');
    expect(seen).toEqual([]);
    expect(await new ModPipeline().dispatchIntercept('read', {}, context)).toEqual({ handled: false });
  });

  it('rejects invalid registrations and captures callbacks against later reassignment', async () => {
    const pipeline = new ModPipeline();
    expect(() => pipeline.register(mod('bad]'))).toThrow();
    expect(() => pipeline.register(mod('nan', NaN))).toThrow();
    const original = { ...mod('stable'), rewriteToolInput: async () => ({ value: 1 }) };
    pipeline.register(original);
    expect(() => pipeline.register(original)).toThrow('Duplicate');
    original.rewriteToolInput = async () => ({ value: 9 });
    expect(await pipeline.dispatchRewriteToolInput('read', {}, context)).toEqual({ value: 1 });
  });
});
