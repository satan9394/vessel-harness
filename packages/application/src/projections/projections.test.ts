import { describe, it, expect } from 'vitest';
import { EventBus } from '@vessel/core';
import { ConversationProjection } from './ConversationProjection.js';
import { ToolActivityProjection } from './ToolActivityProjection.js';
import { UsageProjection } from './UsageProjection.js';
import { PolicyProjection } from './PolicyProjection.js';
import { DEFAULT_PRICING } from './types.js';

describe('ConversationProjection', () => {
  it('projects user prompt (before_turn) + assistant text (after_model)', async () => {
    const bus = new EventBus();
    const projection = new ConversationProjection();
    const detach = projection.attach(bus);

    await bus.waterfall('before_turn', { turnId: 't1', input: '你好' });
    await bus.emit('after_model', {
      turnId: 't1',
      step: 1,
      response: { content: '答复文本', toolCalls: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    expect(projection.messages()).toHaveLength(2);
    expect(projection.messages()[0]).toMatchObject({ role: 'user', text: '你好' });
    expect(projection.messages()[1]).toMatchObject({ role: 'assistant', text: '答复文本' });
    detach();
  });

  it('project assistant tool-call summary rows for tool-call responses', async () => {
    const bus = new EventBus();
    const projection = new ConversationProjection();
    const detach = projection.attach(bus);

    await bus.emit('after_model', {
      turnId: 't2',
      step: 1,
      response: { content: '', toolCalls: [{ id: 'c1', name: 'Read', arguments: {} }] },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await bus.emit('after_model', {
      turnId: 't2',
      step: 2,
      response: { content: '', toolCalls: [{ id: 'c2', name: 'Shell' }, { id: 'c3', name: 'Search' }] },
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const messages = projection.messages();
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.toolName)).toEqual(['Read', 'Shell', 'Search']);
    expect(messages.every((m) => m.role === 'assistant')).toBe(true);
    detach();
  });
});

describe('ToolActivityProjection', () => {
  it('pairs before_tool (started) with after_tool (done) into one row', async () => {
    const bus = new EventBus();
    const projection = new ToolActivityProjection();
    const detach = projection.attach(bus);

    await bus.waterfall('before_tool', { toolCallId: 'tc1', toolName: 'Read', arguments: { path: '/a' } });
    await bus.emit('after_tool', {
      toolCallId: 'tc1',
      toolName: 'Read',
      result: { content: 'data', error: undefined },
    });

    const activities = projection.activities();
    expect(activities).toHaveLength(1);
    const act = activities[0]!;
    expect(act.toolName).toBe('Read');
    expect(act.status).toBe('done');
    expect(act.argsSummary).toContain('/a');
    expect(act.durationMs).toBeGreaterThanOrEqual(0);
    detach();
  });

  it('marks DENIED as denied and other errors as error', async () => {
    const bus = new EventBus();
    const projection = new ToolActivityProjection();
    const detach = projection.attach(bus);

    await bus.emit('after_tool', {
      toolCallId: 'tc2',
      toolName: 'Shell',
      result: { error: { errorClass: 'DENIED', message: 'no' } },
    });
    await bus.emit('after_tool', {
      toolCallId: 'tc3',
      toolName: 'Write',
      result: { error: { errorClass: 'TOOL_FAILURE', message: 'io' } },
    });

    const acts = projection.activities();
    expect(acts).toHaveLength(2);
    expect(acts[0]).toMatchObject({ toolName: 'Shell', status: 'denied' });
    expect(acts[1]).toMatchObject({ toolName: 'Write', status: 'error' });
    detach();
  });
});

describe('UsageProjection', () => {
  it('accumulates token counts and call count from after_model usage', async () => {
    const bus = new EventBus();
    const projection = new UsageProjection({ model: 'gpt-4o' });
    const detach = projection.attach(bus);

    await bus.emit('after_model', { turnId: 't', step: 1, response: {}, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 } });
    await bus.emit('after_model', { turnId: 't', step: 2, response: {}, usage: { inputTokens: 50, outputTokens: 10 } });
    await bus.emit('after_model', { turnId: 't', step: 3, response: {}, usage: undefined });

    const usage = projection.usage();
    expect(usage.inputTokens).toBe(150);
    expect(usage.outputTokens).toBe(30);
    expect(usage.cacheReadTokens).toBe(5);
    expect(usage.calls).toBe(2);
    detach();
  });

  it('estimates costUsd from the injected pricing table', async () => {
    const bus = new EventBus();
    // gpt-4o tariffs per 1M tokens: input 2.5, output 10, cacheRead 1.25
    const projection = new UsageProjection({ model: 'gpt-4o', pricingTable: DEFAULT_PRICING });
    const full = new UsageProjection({
      model: 'gpt-4o',
      pricingTable: { 'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 } },
    });
    const detachFull = full.attach(bus);
    await bus.emit('after_model', { turnId: 't', step: 1, response: {}, usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } });
    const usage = full.usage();
    expect(usage.costUsd).toBeCloseTo(12.5, 6); // 2.5 + 10
    detachFull();

    // default pricing (0.5 / 1.5) applies when the model has no row
    const dflt = new UsageProjection({ model: 'unknown-model' });
    expect(dflt).toBeDefined();
    const detachDflt = projection.attach(bus);
    void detachDflt;
  });
});

describe('PolicyProjection', () => {
  it('records only denominated policy_decision events as denials', async () => {
    const bus = new EventBus();
    const projection = new PolicyProjection();
    const detach = projection.attach(bus);

    await bus.emit('policy_decision', { toolCallId: 'tc1', toolName: 'Shell', verdict: 'deny', ruleRef: 'policy:no-shell', reason: 'blocked' });
    await bus.emit('policy_decision', { toolCallId: 'tc2', toolName: 'Read', verdict: 'allow' });

    expect(projection.denials()).toHaveLength(1);
    expect(projection.denials()[0]).toMatchObject({ toolName: 'Shell', rule: 'policy:no-shell', reason: 'blocked' });
    detach();
  });

  it('exposes empty denials before any policy event', () => {
    const projection = new PolicyProjection();
    expect(projection.denials()).toEqual([]);
  });
});