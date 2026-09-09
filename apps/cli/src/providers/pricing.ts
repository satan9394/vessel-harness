import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_TOKEN_PRICE,
  EMPTY_PRICING_TABLE,
  resolvePrice,
  type CatalogPriceSource,
  type PricingTable,
  type TokenPrice,
} from '@vessel/shared';

/**
 * apps/cli/providers/pricing — load configs/pricing.json（task 017 / 085-087）。
 *
 * 本文件只负责**读盘**：查价规则（模型名归一 + 回退链 + estimated 语义）在
 * `@vessel/shared/pricing` 里，CLI / application / benchmarks 共用同一实现，
 * 这里只 re-export，禁止再写第二套。
 *
 * 回退链：pricing.json models[model]（含归一）> model-catalog 价 > protocols[protocol] > default。
 * 命中 protocol / default 时 `estimated=true`（086：只要不是该模型的专属价目就显式标估算）。
 */

export {
  resolvePrice,
  costOf,
  costBreakdown,
  resolveCacheWritePrice,
  modelNameCandidates,
  createCatalogPriceSource,
  createOverridePriceSource,
  overrideModelCandidates,
  matchModelName,
  DEFAULT_TOKEN_PRICE,
  ZERO_TOKEN_PRICE,
  EMPTY_PRICING_TABLE,
  CACHE_WRITE_INPUT_MULTIPLIER,
} from '@vessel/shared';
export type {
  TokenPrice,
  PricingTable,
  PriceSource,
  PriceResolution,
  CatalogPriceSource,
  OverridePriceSource,
  OverridePriceMatch,
  PricingOverrideData,
  ModelMatch,
  ResolvePriceOptions,
  CostBreakdown,
  CacheWritePriceSource,
  UsageTokens,
} from '@vessel/shared';

/** Load pricing.json from a repo/config root; missing/corrupt → default-only table. */
export function loadPricing(configRoot = process.cwd()): PricingTable {
  const file = path.join(configRoot, 'configs', 'pricing.json');
  const fallbackModels: Record<string, TokenPrice> = { default: { ...DEFAULT_TOKEN_PRICE } };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      models?: Record<string, TokenPrice>;
      protocols?: Record<string, TokenPrice>;
    };
    return {
      models: raw.models && raw.models.default ? raw.models : { ...fallbackModels, ...(raw.models ?? {}) },
      protocols: raw.protocols ?? {},
    };
  } catch {
    return { ...EMPTY_PRICING_TABLE, models: fallbackModels };
  }
}
