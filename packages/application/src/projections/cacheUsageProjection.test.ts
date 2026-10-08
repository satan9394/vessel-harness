import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '@vessel/core';
import { createOverridePriceSource, extractProviderCacheMetrics, type ChatProvider } from '@vessel/shared';
import { anthropicUsageChunk } from '@vessel/llm';
import { UsageProjection } from './UsageProjection.js';
import { SessionController } from '../session/SessionController.js';
import { UsageStore } from '../../../../apps/cli/src/usage/UsageStore.js';
import { createIsolatedRuntime } from '@vessel/agents';
import { loadPolicyArtifacts } from '@vessel/policy';
const prices = { models: { m: { input: 2, output: 5, cacheRead: 0.5, cacheWrite: 2.5 } }, protocols: {} };
describe('cache projection and production stream', () => {
  it.each([
    { price: { input: 2, output: 5 }, cached: 90, creation: 0, expected: 0.0002, estimated: true },
    { price: { input: 2, output: 5 }, cached: 70, creation: 20, expected: 0.0002, estimated: true },
    { price: { input: 2, output: 5, cacheRead: 0, cacheWrite: 0 }, cached: 70, creation: 20, expected: 0.00002, estimated: false },
    { price: { input: 2, output: 5, cacheRead: 0.5 }, cached: 70, creation: 20, expected: 0.000105, estimated: true },
  ])('accounts unknown cache tariffs conservatively, explicit zero exactly: $price', async ({ price, cached, creation, expected, estimated }) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cache-tariff-'));
    try {
      const table = { models: { m: price }, protocols: {} };
      const projection = new UsageProjection({ model: 'm', pricingTable: table }); const bus = new EventBus(); projection.attach(bus);
      const cacheMetrics = extractProviderCacheMetrics({ input_tokens: 100 - cached - creation, cache_read_input_tokens: cached, cache_creation_input_tokens: creation }, 'p', 'm');
      const usage = { inputTokens: 100 - cached - creation, outputTokens: 0, cacheReadTokens: cached, cacheCreationTokens: creation, cacheMetrics };
      await bus.emit('after_model', { usage });
      let store = new UsageStore({ rootDir: root, pricing: table }); store.record({ provider: 'p', model: 'm', ...usage });
      expect(projection.usage().costUsd).toBeCloseTo(expected, 9); expect(projection.usage().estimated).toBe(estimated);
      expect(projection.costForUsage(usage)).toMatchObject({ estimated }); expect(projection.costForUsage(usage).costUsd).toBeCloseTo(expected, 9);
      expect(store.totals().costUsd).toBeCloseTo(expected, 9); expect(store.byModel()[0]?.estimated).toBe(estimated);
      store = new UsageStore({ rootDir: root, pricing: table }); expect(store.recompute().changed).toBe(0);
      expect(store.totals().costUsd).toBeCloseTo(expected, 9);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('preserves isolated streamed cache metadata on a shared team bus', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cache-isolated-'));
    const bus = new EventBus(); const seen: unknown[] = [];
    bus.on('after_model', payload => { seen.push((payload as { usage: unknown }).usage); });
    const provider: ChatProvider = { id: 'custom', chat: async () => { throw new Error('stream expected'); }, stream: async function* () {
      yield { type: 'text_delta', text: 'done' };
      yield anthropicUsageChunk({ input_tokens: 10, cache_read_input_tokens: 90 });
      yield { type: 'message_end', finishReason: 'stop' };
    } };
    const runtime = await createIsolatedRuntime({ workspaceRoot: root, provider, model: 'm', bus, tools: [], policyArtifacts: loadPolicyArtifacts({ systemPath: path.resolve(import.meta.dirname, '../../../../configs/policy.default.yaml') }) });
    try {
      await runtime.loop.runTurn('offline cache metadata');
      expect(seen).toMatchObject([{ cacheMetrics: { promptTokens: 100, cachedTokens: 90, billedHitRate: 0.9 } }]);
    } finally { await runtime.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('weights rates by prompt tokens and prices inclusive cache once', async () => {
    const bus = new EventBus(); const projection = new UsageProjection({ model: 'm', pricingTable: prices }); projection.attach(bus);
    for (const raw of [{ prompt_tokens: 1000, prompt_cache_hit_tokens: 900 }, { prompt_tokens: 100, prompt_cache_hit_tokens: 0 }]) {
      await bus.emit('after_model', { usage: { inputTokens: raw.prompt_tokens, outputTokens: 0, cacheReadTokens: raw.prompt_cache_hit_tokens, cacheMetrics: extractProviderCacheMetrics(raw, 'p', 'm') } });
    }
    expect(projection.usage()).toMatchObject({ promptTokensTotal: 1100, cachedTokensTotal: 900, estimatedSavingsUsd: 0.00135, estimated: false });
    expect(projection.usage().overallCacheHitRate).toBeCloseTo(900 / 1100);
    expect(projection.usage().costUsd).toBeCloseTo(200 * 2 / 1e6 + 900 * 0.5 / 1e6);
  });
  it('excludes legacy unknown cache semantics from measured rates', async () => {
    const bus = new EventBus(); const projection = new UsageProjection({ model: 'm', pricingTable: prices }); projection.attach(bus);
    await bus.emit('after_model', { usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 90 } });
    expect(projection.usage()).toMatchObject({ measuredCalls: 0, promptTokensTotal: 0, cachedTokensTotal: 0 });
    await bus.emit('after_model', { usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 50, cacheMetrics: extractProviderCacheMetrics({ prompt_tokens: 100, prompt_cache_hit_tokens: 50 }, 'p', 'm') } });
    expect(projection.usage()).toMatchObject({ calls: 2, measuredCalls: 1, promptTokensTotal: 100, cachedTokensTotal: 50, overallCacheHitRate: 0.5 });
  });
  it('preserves priced parity and normalized counts across persistent reload and recompute', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cache-store-'));
    try {
      let store = new UsageStore({ rootDir: root, pricing: prices });
      const metrics = extractProviderCacheMetrics({ prompt_tokens: 1000, prompt_cache_hit_tokens: 900 }, 'p', 'm');
      const bus = new EventBus(); const projection = new UsageProjection({ model: 'm', pricingTable: prices }); projection.attach(bus);
      const usage = { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 900, cacheMetrics: metrics };
      await bus.emit('after_model', { usage }); store.record({ provider: 'p', model: 'm', ...usage });
      expect(store.totals().costUsd).toBeCloseTo(projection.usage().costUsd);
      expect(store.cacheSummary()).toMatchObject({ promptTokensTotal: 1000, cachedTokensTotal: 900, overallCacheHitRate: 0.9, estimatedSavingsUsd: 0.00135 });
      store = new UsageStore({ rootDir: root, pricing: prices });
      expect(store.recompute().changed).toBe(0);
      expect(store.totals().costUsd).toBeCloseTo(projection.usage().costUsd);
      expect(store.cacheSummary().overallCacheHitRate).toBe(0.9);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('reprices measured read savings after an override and multiplier change without counting legacy reads', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cache-reprice-'));
    try {
      let store = new UsageStore({ rootDir: root, pricing: prices, multiplierOf: () => 2 });
      store.record({ provider: 'p', model: 'm', inputTokens: 100, outputTokens: 0, cacheReadTokens: 70 });
      store.record({ provider: 'p', model: 'm', inputTokens: 100, outputTokens: 0, cacheReadTokens: 90,
        cacheMetrics: extractProviderCacheMetrics({ prompt_tokens: 100, prompt_cache_hit_tokens: 90 }, 'p', 'm') });
      expect(store.cacheSummary().estimatedSavingsUsd).toBeCloseTo(90 * 1.5 / 1e6 * 2, 9);
      const override = createOverridePriceSource({ models: { m: { input: 4, output: 5, cacheRead: 1 } } });
      store = new UsageStore({ rootDir: root, pricing: prices, override, multiplierOf: () => 3 });
      expect(store.recompute().changed).toBeGreaterThan(0);
      expect(store.cacheSummary().estimatedSavingsUsd).toBeCloseTo(90 * 3 / 1e6 * 3, 9);
      expect(store.recompute().changed).toBe(0);
      store = new UsageStore({ rootDir: root, pricing: prices, override, multiplierOf: () => 3 });
      expect(store.cacheSummary().estimatedSavingsUsd).toBeCloseTo(90 * 3 / 1e6 * 3, 9);
      expect(store.cacheSummary().cachedTokensTotal).toBe(90);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('folds split frames through AgentLoop into projection, store, and durable audit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cache-app-'));
    const repo = path.resolve(import.meta.dirname, '../../../..');
    let call = 0; const recorded: unknown[] = [];
    const provider: ChatProvider = { id: 'arbitrary-provider', chat: async () => { throw new Error('stream expected'); }, stream: async function* () {
      const hit = call++ === 0 ? 90 : 0;
      yield { type: 'text_delta', text: 'done' };
      yield anthropicUsageChunk({ input_tokens: 100 - hit, cache_read_input_tokens: hit });
      yield anthropicUsageChunk({ output_tokens: 10 });
      yield { type: 'message_end', finishReason: 'stop' };
    } };
    const ctl = await SessionController.create({ workspaceRoot: root, provider, model: 'm', memory: { enabled: false }, pricingTable: prices,
      usageStore: { record: input => { recorded.push(input); } }, policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') });
    try {
      const alerts: unknown[] = []; ctl.bus.on('audit/cache_drift', alert => { alerts.push(alert); });
      await ctl.runTurn('first'); await ctl.runTurn('second');
      expect(ctl.projections.usage.usage()).toMatchObject({ promptTokensTotal: 200, cachedTokensTotal: 90, overallCacheHitRate: 0.45 });
      expect(recorded).toHaveLength(2); expect(recorded[0]).toMatchObject({ cacheMetrics: { promptTokens: 100, cachedTokens: 90 } });
      expect(alerts).toHaveLength(1);
      expect(ctl.session.replay().filter(record => record.type === 'audit/cache_drift')).toMatchObject([{ droppedTokens: 90, previousPrefixHash: expect.any(String), currentPrefixHash: expect.any(String) }]);
      expect(ctl.session.replay().filter(record => record.type === 'model/usage')).toMatchObject([{ usage: { cacheMetrics: { billedHitRate: 0.9 } } }, { usage: { cacheMetrics: { billedHitRate: 0 } } }]);
    } finally { await ctl.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
});
