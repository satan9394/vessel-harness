import { describe, expect, it } from 'vitest';
import { extractProviderCacheMetrics, priceCacheMetrics, resolvePrice } from '@vessel/shared';
import { CacheDriftDetector } from './CacheDriftDetector.js';
import { anthropicUsageChunk } from '../stream/parseAnthropic.js';
import { observeProviderCacheUsage } from './observeProviderCacheUsage.js';

describe('wire cache economics', () => {
  it('assigns actual request and provider identity on both chat and streaming metrics', async () => {
    const wire = extractProviderCacheMetrics({ prompt_tokens: 100, prompt_cache_hit_tokens: 90 }, 'parser-protocol', '');
    const observer = observeProviderCacheUsage({ id: 'actual-provider', chat: async () => ({ content: 'done', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 0, cacheMetrics: wire } }), stream: async function* () { yield { type: 'usage', inputTokens: 100, cacheMetrics: wire }; } });
    const request = { model: 'actual-model', messages: [] };
    expect((await observer.provider.chat(request)).usage.cacheMetrics).toMatchObject({ provider: 'actual-provider', model: 'actual-model' });
    for await (const chunk of observer.provider.stream!(request)) { expect(chunk.type).toBe('usage'); }
    const usage = { inputTokens: 100, outputTokens: 0, cacheMetrics: undefined as typeof wire | undefined };
    observer.annotate(usage);
    expect(usage.cacheMetrics).toMatchObject({ provider: 'actual-provider', model: 'actual-model' });
  });
  it('counts Anthropic separate cache and OpenAI inclusive prompt exactly once', () => {
    expect(extractProviderCacheMetrics({ input_tokens: 100, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 }, 'custom', 'm')).toMatchObject({ promptTokens: 1000, billedHitRate: 0.8, creationTokens: 100 });
    expect(extractProviderCacheMetrics({ prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 800 } }, 'custom', 'm')).toMatchObject({ promptTokens: 1000, billedHitRate: 0.8 });
  });
  it('reads DeepSeek hit/miss and Google', () => {
    expect(extractProviderCacheMetrics({ prompt_cache_hit_tokens: 90, prompt_cache_miss_tokens: 10 }, 'custom', 'm')).toMatchObject({ promptTokens: 100, billedHitRate: 0.9 });
    expect(extractProviderCacheMetrics({ promptTokenCount: 100, cachedContentTokenCount: 90 }, 'google', 'm')).toMatchObject({ promptTokens: 100, billedHitRate: 0.9 });
  });
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '10'])('rejects invalid token count %s', value => {
    expect(extractProviderCacheMetrics({ prompt_tokens: value, prompt_tokens_details: null }, 'p', 'm').promptTokens).toBe(0);
  });
  it('bounds hit rates and handles absent usage', () => {
    expect(extractProviderCacheMetrics({ prompt_tokens: 2, prompt_tokens_details: { cached_tokens: 5 } }, 'p', 'm').billedHitRate).toBe(1);
    expect(extractProviderCacheMetrics({}, 'p', 'm').billedHitRate).toBe(0);
  });
  it('uses resolved tariffs without inventing read prices', () => {
    const metrics = extractProviderCacheMetrics({ prompt_tokens: 1_000_000, prompt_cache_hit_tokens: 900_000 }, 'p', 'm');
    const resolution = resolvePrice({ models: { m: { input: 2, output: 5, cacheRead: 0.5 } }, protocols: {} }, 'm');
    expect(priceCacheMetrics(metrics, resolution)).toMatchObject({ estimatedSavingsUsd: 1.35, estimated: false });
    expect(priceCacheMetrics(metrics, resolvePrice({ models: {}, protocols: {} }, 'unknown')).estimated).toBe(true);
    expect(priceCacheMetrics(metrics, { ...resolution, price: { input: 2, output: 5 } }).estimatedSavingsUsd).toBe(0);
  });
  it('records one collapse per session and preserves hashes', () => {
    const detector = new CacheDriftDetector();
    const high = extractProviderCacheMetrics({ prompt_tokens: 100, prompt_cache_hit_tokens: 90 }, 'p', 'm');
    const low = { ...high, cachedTokens: 0, billedHitRate: 0 };
    expect(detector.check('a', high, 'old')).toBeNull(); expect(detector.check('b', low)).toBeNull();
    expect(detector.check('a', low, 'new')).toMatchObject({ droppedTokens: 90, previousPrefixHash: 'old', currentPrefixHash: 'new' });
    expect(detector.check('a', low)).toBeNull();
  });
  it('carries wire metadata only on complete input usage frames', () => {
    expect(anthropicUsageChunk({ input_tokens: 10, cache_read_input_tokens: 90 }).cacheMetrics?.billedHitRate).toBe(0.9);
    expect(anthropicUsageChunk({ output_tokens: 10 }).cacheMetrics).toBeUndefined();
  });
});
