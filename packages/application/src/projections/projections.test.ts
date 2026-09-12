import { describe, it, expect } from 'vitest';
import { EventBus } from '@vessel/core';
import type { ToolErrorPayload } from '@vessel/shared';
import { ConversationProjection } from './ConversationProjection.js';
import { ToolActivityProjection } from './ToolActivityProjection.js';
import { UsageProjection } from './UsageProjection.js';
import { PolicyProjection } from './PolicyProjection.js';
import { EnforcementProjection } from './EnforcementProjection.js';
import { DEFAULT_TOKEN_PRICE, type PricingTable } from './types.js';

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

  it('estimates costUsd from the injected pricing table (shared resolvePrice, task 087)', async () => {
    const bus = new EventBus();
    // gpt-4o tariffs per 1M tokens: input 2.5, output 10, cacheRead 1.25
    const full = new UsageProjection({
      model: 'gpt-4o',
      pricingTable: { models: { 'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 } }, protocols: {} },
    });
    const detachFull = full.attach(bus);
    await bus.emit('after_model', { turnId: 't', step: 1, response: {}, usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } });
    const usage = full.usage();
    expect(usage.costUsd).toBeCloseTo(12.5, 6); // 2.5 + 10
    expect(usage.pricingSource).toBe('model');
    expect(usage.estimated).toBe(false);
    expect(full.pricing().matchedKey).toBe('gpt-4o');
    detachFull();
  });

  it('normalized model name hits the table (task 085 in the projection path)', async () => {
    const bus = new EventBus();
    const projection = new UsageProjection({
      model: 'openrouter/anthropic/claude-3.5-sonnet-20241022',
      pricingTable: { models: { 'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3 } }, protocols: {} },
    });
    const detach = projection.attach(bus);
    await bus.emit('after_model', { turnId: 't', step: 1, response: {}, usage: { inputTokens: 1_000_000 } });
    expect(projection.usage().costUsd).toBeCloseTo(3, 6);
    expect(projection.usage().pricingSource).toBe('model');
    expect(projection.usage().estimated).toBe(false);
    detach();
  });

  it('no pricing table → default fallback is explicitly marked estimated (task 086)', () => {
    const projection = new UsageProjection({ model: 'unknown-model' });
    const record = projection.usage();
    expect(record.pricingSource).toBe('default');
    expect(record.estimated).toBe(true);
    expect(projection.pricing().price).toEqual(DEFAULT_TOKEN_PRICE);
  });

  it('strict mode leaves unknown models unpriced at zero cost (task 086)', () => {
    const projection = new UsageProjection({ model: 'unknown-model', strict: true });
    const record = projection.usage();
    expect(record.pricingSource).toBe('unpriced');
    expect(record.estimated).toBe(false);
    expect(record.costUsd).toBe(0);
  });

  it('catalog price source is used before the default fallback (task 087)', () => {
    const catalog = {
      findPrice: (m: string) => (m === 'gemini-2.5-pro' ? { input: 1.25, output: 10, cacheRead: 0.12 } : undefined),
    };
    const projection = new UsageProjection({ model: 'gemini-2.5-pro', catalog });
    expect(projection.pricing().source).toBe('catalog');
    expect(projection.pricing().price.input).toBe(1.25);
  });

  it('protocol fallback is available when a protocol is injected', () => {
    const table: PricingTable = { models: {}, protocols: { anthropic: { input: 3, output: 15, cacheRead: 0.3 } } };
    const projection = new UsageProjection({ model: 'whatever', pricingTable: table, protocol: 'anthropic' });
    expect(projection.pricing().source).toBe('protocol');
    expect(projection.pricing().price.input).toBe(3);
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

describe('EnforcementProjection (task 074 runtime enforcement telemetry)', () => {
  it('aggregates policy denials from the policy_decision bus event (050 reuse)', async () => {
    const bus = new EventBus();
    const ep = new EnforcementProjection();
    const detach = ep.attach(bus);

    await bus.emit('policy_decision', { toolCallId: 'tc1', toolName: 'Shell', verdict: 'deny', ruleRef: 'policy:no-rm', reason: 'rm -rf' });
    await bus.emit('policy_decision', { toolCallId: 'tc2', toolName: 'Read', verdict: 'allow' }); // ignored

    const events = ep.events();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'deny', source: 'policy', detail: 'rm -rf' });
    expect(events[0]?.meta).toMatchObject({ toolName: 'Shell', ruleRef: 'policy:no-rm' });
    detach();
  });

  it('counts per classified type and per source across multiple enforcement seams', () => {
    const ep = new EnforcementProjection();
    ep.recordProcessTree({ kind: 'escape-detected', pid: 42, detail: 'pid 42 escaped', at: 1 });
    ep.recordProcessTree({ kind: 'escape-terminated', pid: 42, detail: 'pid 42 terminated', at: 2 });
    ep.reportStatus({ enabled: true, supported: 'windows-job-object', active: true, backend: 'job-object' }, ['maxActiveProcesses=8']);

    const counts = ep.counts();
    expect(counts['escape-detected']).toBe(1);
    expect(counts['escape-terminated']).toBe(1);
    expect(counts.report).toBe(1);
    expect(ep.sourceCounts()).toMatchObject({ 'process-tree': 2, 'sandbox-status': 1, policy: 0, 'fs-confinement': 0 });
  });

  it('recent(n) returns the newest n events in reverse order', async () => {
    const bus = new EventBus();
    const ep = new EnforcementProjection();
    const detach = ep.attach(bus);

    await bus.emit('policy_decision', { toolCallId: 'a', toolName: 'T1', verdict: 'deny', reason: 'one' });
    await bus.emit('policy_decision', { toolCallId: 'b', toolName: 'T2', verdict: 'deny', reason: 'two' });
    ep.recordProcessTree({ kind: 'spawn', pid: 7, detail: 's', at: Date.now() });

    const recent = ep.recent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.type).toBe('spawn'); // newest first
    expect(recent[1]?.type).toBe('deny');
    expect(ep.recent(99)).toHaveLength(3);
    detach();
  });

  it('reports sandbox backend/resource-limit status via the injectable seam', () => {
    const ep = new EnforcementProjection();
    expect(ep.status()).toBeUndefined();
    ep.reportStatus(
      { enabled: true, supported: 'windows-job-object', active: true, backend: 'job-object', fallbackReason: 'restricted-token not implemented' },
      ['maxWorkingSetBytes=524288000'],
    );
    const st = ep.status();
    expect(st).toMatchObject({ backend: 'job-object', active: true });
    expect(ep.treeAudit()).toEqual([]);
  });

  it('folds fs-confinement guard DENIED from session tool/result records (073 reuse)', () => {
    const ep = new EnforcementProjection();
    const session = {
      replay: (): Array<{
        type: 'tool/result';
        toolCallId: string;
        toolName: string;
        error?: { errorClass: 'DENIED' | 'TOOL_FAILURE'; message: string };
        meta: Record<string, unknown>;
      }> => [
        { type: 'tool/result', toolCallId: 'x1', toolName: 'Write', error: { errorClass: 'DENIED', message: 'path outside confinement allow set' }, meta: { guard: 'confinement' } },
        // size guard denied → folded
        { type: 'tool/result', toolCallId: 'x2', toolName: 'Read', error: { errorClass: 'DENIED', message: 'file too large' }, meta: { guard: 'size' } },
        // DENIED without guard → not an enforcement record, skipped
        { type: 'tool/result', toolCallId: 'x3', toolName: 'Shell', error: { errorClass: 'DENIED', message: 'policy' }, meta: {} },
        // non-DENIED error with guard-like meta → skipped
        { type: 'tool/result', toolCallId: 'x4', toolName: 'Read', error: { errorClass: 'TOOL_FAILURE', message: 'io' }, meta: { guard: 'escape' } },
      ],
    };
    ep.foldSession(session);
    const events = ep.events();
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type).sort()).toEqual(['confinement', 'size']);
    expect(events.every((e) => e.source === 'fs-confinement')).toBe(true);
    expect(ep.counts()).toMatchObject({ confinement: 1, size: 1 });
  });

  /**
   * task 074 § 死 seam 接线 ③ 的幂等性：生产折点在 `after_turn`（每回合一次），
   * 所以 `foldSession()` 会被同一个会话反复调用 —— 同一记录只能计一次。
   */
  it('foldSession is idempotent: folding the same session twice never double-counts', () => {
    const ep = new EnforcementProjection();
    type Folded = {
      type: 'tool/result';
      toolCallId: string;
      toolName: string;
      // 用生产的共享类型（errorClass 是联合类型）而不是收窄成 'DENIED'：本夹具要能构造
      // **非 DENIED** 的 tool/result（如 TOOL_FAILURE，真实会话里本就有），用来证明它们
      // 不会被折成 enforcement 记录；而 string 又太宽、无法赋给 FoldableToolResultRecord。
      error?: ToolErrorPayload;
      meta: Record<string, unknown>;
    };
    const records: Folded[] = [
      {
        type: 'tool/result',
        toolCallId: 'x1',
        toolName: 'Read',
        error: { errorClass: 'DENIED', message: 'path escapes workspace: ../a.txt' },
        meta: { guard: 'escape' },
      },
      // 非 DENIED（guard 字段存在也不算）→ 从来不是 enforcement 记录
      {
        type: 'tool/result',
        toolCallId: 'x2',
        toolName: 'Read',
        error: { errorClass: 'TOOL_FAILURE', message: 'io' },
        meta: { guard: 'escape' },
      },
    ];
    const session = { replay: () => records };
    ep.foldSession(session);
    ep.foldSession(session); // 同一会话对象再折一次
    ep.foldSession({ replay: () => records }); // replay 视图重建（记录对象仍是同一批）
    ep.foldSession({ replay: () => records.map((r) => ({ ...r })) }); // 连记录对象都是新的（按键去重）

    expect(ep.events()).toHaveLength(1);
    expect(ep.counts()).toEqual({ escape: 1 });
    expect(ep.sourceCounts()['fs-confinement']).toBe(1);
  });

  it('foldSession dedups by log identity — two denials sharing a toolCallId are both kept', () => {
    const ep = new EnforcementProjection();
    // mock provider 的工具调用 id 是按位置生成的（`tc_mock_1`），同一个 id 会重复出现；
    // 去重必须按日志身份（`seq`）而不是只按 toolCallId，否则会漏掉真实发生的第二次拒绝。
    const session = {
      replay: () => [
        {
          type: 'tool/result' as const,
          seq: 5,
          toolCallId: 'tc_mock_1',
          toolName: 'Read',
          error: { errorClass: 'DENIED' as const, message: 'path escapes workspace: ../a.txt' },
          meta: { guard: 'escape' },
        },
        {
          type: 'tool/result' as const,
          seq: 9,
          toolCallId: 'tc_mock_1',
          toolName: 'Read',
          error: { errorClass: 'DENIED' as const, message: 'path escapes workspace: ../b.txt' },
          meta: { guard: 'escape' },
        },
      ],
    };
    ep.foldSession(session);
    ep.foldSession(session); // 幂等：不因第二次折叠而翻倍
    expect(ep.counts()).toEqual({ escape: 2 });
    expect(ep.sourceCounts()['fs-confinement']).toBe(2);
  });

  it('multi-source aggregation keeps each event type/source distinct in one snapshot', async () => {
    const bus = new EventBus();
    const ep = new EnforcementProjection();
    const detach = ep.attach(bus);

    await bus.emit('policy_decision', { toolCallId: 'a', toolName: 'Shell', verdict: 'deny', reason: 'no-shell' });
    ep.recordProcessTree({ kind: 'escape-detected', pid: 5, detail: 'esc', at: Date.now() });
    ep.reportStatus({ enabled: true, supported: 'windows-job-object', active: true, backend: 'job-object' });

    const snap = ep.snapshot();
    expect(snap.sources).toMatchObject({ policy: 1, 'process-tree': 1, 'sandbox-status': 1 });
    expect(snap.counts.deny).toBe(1);
    expect(snap.counts['escape-detected']).toBe(1);
    expect(snap.recent(1)[0]?.source).toBe('sandbox-status');
    expect(snap.treeAudit()).toHaveLength(1);
    detach();
  });

  it('exposes an empty aggregate before any enforcement event, and defensive copies on queries', () => {
    const ep = new EnforcementProjection();
    expect(ep.events()).toEqual([]);
    expect(ep.counts()).toEqual({});
    expect(ep.recent(0)).toEqual([]);
    ep.reportStatus({ enabled: false, supported: 'none', active: false });
    const st1 = ep.status();
    expect(st1).toBeDefined();
    ep.reportStatus({ enabled: true, supported: 'windows-job-object', active: true, backend: 'job-object' });
    // status() returns a copy, not the stored ref
    expect(ep.status()).toMatchObject({ backend: 'job-object' });
    expect(st1).not.toEqual(ep.status());
  });

  it('records escape events carried by a Shell result meta and keeps a FAILED kill distinct', () => {
    // This is the payload shape the Shell tool now emits on `meta.sandbox.audit`
    // (only escape/termination events, never routine bookkeeping). The production
    // consumer forwards each one here, so the escape conclusion is visible to the
    // enforcement telemetry instead of dying in Sandbox runtime memory.
    const ep = new EnforcementProjection();
    for (const e of [
      { kind: 'escape-detected' as const, pid: 4242, detail: 'pid 4242 running outside confined set (escaped)', at: 10 },
      { kind: 'escape-terminate-failed' as const, pid: 4242, detail: 'pid 4242 NOT verified terminated', at: 11 },
    ]) {
      ep.recordProcessTree(e);
    }
    expect(ep.counts()).toMatchObject({ 'escape-detected': 1, 'escape-terminate-failed': 1 });
    // a failed kill must NEVER be recorded as a successful termination
    expect(ep.counts()['escape-terminated']).toBeUndefined();
    expect(ep.treeAudit()).toHaveLength(2);
    expect(ep.treeAudit().some((e) => e.kind === 'escape-terminate-failed' && e.pid === 4242)).toBe(true);
    expect(ep.events().every((e) => e.source === 'process-tree')).toBe(true);
  });
});