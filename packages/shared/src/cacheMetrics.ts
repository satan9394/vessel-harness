import type { PriceResolution, TokenPrice } from './pricing.js';

/** Prompt total includes cache reads/writes exactly once, unlike legacy raw inputTokens. */
export interface CacheUsageMetrics {
  promptTokens: number;
  cachedTokens: number;
  creationTokens: number;
  billedHitRate: number;
  estimatedSavingsUsd: number;
  provider: string;
  model: string;
  estimated?: boolean;
}
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function extractProviderCacheMetrics(rawUsage: Record<string, unknown>, provider: string, model: string): CacheUsageMetrics {
  const candidate = rawUsage.prompt_tokens_details;
  const details = candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : undefined;
  const creationTokens = count(rawUsage.cache_creation_input_tokens);
  const cached = count(rawUsage.cache_read_input_tokens ?? rawUsage.prompt_cache_hit_tokens ?? details?.cached_tokens ?? rawUsage.cachedContentTokenCount);
  // Wire fields, rather than a user-defined provider label, determine semantics.
  const anthropic = 'input_tokens' in rawUsage;
  const promptTokens = anthropic ? count(count(rawUsage.input_tokens) + cached + creationTokens)
    : count(rawUsage.prompt_tokens ?? rawUsage.promptTokenCount ?? (count(rawUsage.prompt_cache_hit_tokens) + count(rawUsage.prompt_cache_miss_tokens)));
  const cachedTokens = Math.min(cached, promptTokens);
  return { promptTokens, cachedTokens, creationTokens, billedHitRate: promptTokens > 0 ? cachedTokens / promptTokens : 0,
    estimatedSavingsUsd: 0, provider, model };
}
/** Read savings against the same tokens at normal input price; no guessed cache tariff. */
export function priceCacheMetrics(metrics: CacheUsageMetrics, resolution: PriceResolution, multiplier = 1): CacheUsageMetrics {
  const price = resolution.price;
  return { ...metrics, estimatedSavingsUsd: price.cacheRead === undefined ? 0
    : metrics.cachedTokens * (price.input - price.cacheRead) / 1_000_000 * multiplier,
    estimated: resolution.estimated || cacheTariffEstimated(price, metrics.cachedTokens, metrics.creationTokens) };
}


/** Missing cache prices are unknown, never an explicit zero tariff. */
export function cacheTariffEstimated(price: TokenPrice, reads: number, writes: number): boolean {
  return (reads > 0 && price.cacheRead === undefined) || (writes > 0 && price.cacheWrite === undefined);
}
/** Conservative base-input estimate for measured cache tokens with no applicable tariff. */
export function unknownCacheInputTokens(price: TokenPrice, reads: number, writes: number): number {
  return (price.cacheRead === undefined ? reads : 0)
    + (price.cacheWrite === undefined && price.cacheRead === undefined ? writes : 0);
}
