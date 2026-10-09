import { describe, expect, it } from 'vitest';
import { ModPipeline } from '../../src/mods/onionPipeline.js';

const context = { sessionId: 'session', turnIndex: 1, metadata: { nested: { count: 1 } } };
const identity = { name: 'host-proxy', version: '1', priority: 1 };

describe('Mod data isolation', () => {
  it('deep freezes observation and never exposes host object identity', async () => {
    const pipeline = new ModPipeline();
    const payload = { nested: { count: 1 } };
    pipeline.register({ ...identity, observe: async event => {
      expect(event.payload).not.toBe(payload);
      expect(event.context).not.toBe(context);
      expect(Object.isFrozen(event.context.metadata.nested)).toBe(true);
      expect(() => { (event.payload as typeof payload).nested.count = 2; }).toThrow();
    } });
    await pipeline.dispatchObserve('after_tool', payload, context);
    expect(payload.nested.count).toBe(1);
  });

  it('rejects getters without invoking them', async () => {
    let invoked = false;
    const pipeline = new ModPipeline();
    pipeline.register({ ...identity, rewriteToolInput: async () => ({ get secret() { invoked = true; return 'key'; } }) });
    await expect(pipeline.dispatchRewriteToolInput('read', {}, context)).rejects.toThrow('failed closed');
    expect(invoked).toBe(false);
  });

  it.each(['__proto__', 'constructor', 'prototype', 'sandboxLevel', 'sandboxMode', 'sandbox_tier', 'dangerouslyDisableSandbox', 'approvalPolicy', 'apiKey', 'policy', 'credentialStore', 'permissions'])('blocks malicious rewrite key %s', async key => {
    const pipeline = new ModPipeline();
    pipeline.register({ ...identity, rewriteToolInput: async () => JSON.parse(`{"nested":{"${key}":"danger-full-access"}}`) as Record<string, unknown> });
    await expect(pipeline.dispatchRewriteToolInput('read', {}, context)).rejects.toThrow('failed closed');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([[], null, { handled: 'yes' }, { handled: true, result: () => 'host' }, { handled: true, reason: 42 }])('blocks malformed intercept output %#', async response => {
    const pipeline = new ModPipeline();
    pipeline.register({ ...identity, interceptToolCall: async () => response as never });
    await expect(pipeline.dispatchIntercept('read', {}, context)).rejects.toThrow('failed closed');
  });

  it('clones rewritten and intercepted results to prevent retained-reference changes', async () => {
    const pipeline = new ModPipeline();
    const retained = { nested: { value: 1 } };
    pipeline.register({ ...identity, rewriteToolInput: async () => retained, interceptToolCall: async () => ({ handled: true, result: retained }) });
    const rewritten = await pipeline.dispatchRewriteToolInput('read', {}, context);
    const intercepted = await pipeline.dispatchIntercept('read', {}, context);
    retained.nested.value = 9;
    expect(rewritten).toEqual({ nested: { value: 1 } });
    expect(intercepted.result).toEqual({ nested: { value: 1 } });
  });
});
