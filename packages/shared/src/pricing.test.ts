import { describe, it, expect } from 'vitest';
import {
  CACHE_WRITE_INPUT_MULTIPLIER,
  DEFAULT_TOKEN_PRICE,
  ZERO_TOKEN_PRICE,
  costBreakdown,
  costOf,
  createCatalogPriceSource,
  isFamilyPrefix,
  matchModelName,
  modelNameCandidates,
  resolveCacheWritePrice,
  resolvePrice,
  type PricingTable,
  type TokenPrice,
} from './pricing.js';

/**
 * task 085/086 — 归一 + 查价单一实现测试。
 *
 * 表里用真实世界的模型名（含 pricing.json / model-catalog.json 已有条目），
 * 断言「归一前落不到价、归一后能落到」。
 */

/** pricing.json 形状（models.default 为通用兜底）。 */
const TABLE: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    mock: { input: 0, output: 0, cacheRead: 0 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
    'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3 },
    'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3 },
    'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5 },
    'gpt-5.1': { input: 1.25, output: 10, cacheRead: 0.12 },
    'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 },
    'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.07 },
    'mimo-v2.5-pro': { input: 0.3, output: 1.2, cacheRead: 0.05 },
    'deepseek-ai/DeepSeek-V4-Flash': { input: 0.14, output: 0.28, cacheRead: 0.03 },
  },
  protocols: {
    anthropic: { input: 3, output: 15, cacheRead: 0.3 },
    'openai-compatible': { input: 0.5, output: 1.5, cacheRead: 0.1 },
  },
};

/** model-catalog.json 形状（目录价源，仅收录未出现在 pricing.json 的模型）。 */
const CATALOG: { model: string; priceIn?: number; priceOut?: number; priceCache?: number }[] = [
  { model: 'gemini-2.5-pro', priceIn: 1.25, priceOut: 10, priceCache: 0.12 },
  { model: 'kimi-k2.7-code', priceIn: 0.95, priceOut: 4, priceCache: 0.19 },
  { model: 'glm-5', priceIn: 1, priceOut: 3.2, priceCache: 0.2 },
];
const CATALOG_SOURCE = createCatalogPriceSource(CATALOG, {
  idOf: (m) => m.model,
  priceOf: (m) => (m.priceIn == null ? undefined : { input: m.priceIn, output: m.priceOut ?? 0, cacheRead: m.priceCache }),
});

/**
 * 归一前的旧实现（basename 精确匹配 pricing.json + model-catalog）——仅作对照
 * 基准，不参与生产路径。用于量化「归一前/后」命中差异。
 */
function legacyBasenameLookup(model: string): TokenPrice | undefined {
  const base = model.includes('/') ? model.split('/').pop()! : model;
  const row = TABLE.models[base];
  if (row && base !== 'default') return row;
  const cat = CATALOG.find((m) => m.model === base);
  return cat && cat.priceIn != null ? { input: cat.priceIn, output: cat.priceOut ?? 0, cacheRead: cat.priceCache } : undefined;
}

/** ≥8 种真实模型名变体 → 期望命中的表键 / 目录条目。 */
const VARIANTS: { input: string; key: string; from: 'model' | 'catalog' }[] = [
  { input: 'openrouter/anthropic/claude-3.5-sonnet', key: 'claude-3-5-sonnet', from: 'model' }, // 命名空间 + 点号
  { input: 'claude-3-5-sonnet-20241022', key: 'claude-3-5-sonnet', from: 'model' }, // 日期后缀
  { input: 'anthropic/claude-sonnet-4-5', key: 'claude-sonnet-4-5', from: 'model' }, // 命名空间
  { input: 'claude-sonnet-4-5-20250929', key: 'claude-sonnet-4-5', from: 'model' }, // 日期后缀
  { input: 'claude-opus-4.5', key: 'claude-opus-4-5', from: 'model' }, // 点号→横线
  { input: 'CLAUDE-OPUS-4-5', key: 'claude-opus-4-5', from: 'model' }, // 大小写
  { input: 'gpt-5.1-codex-high', key: 'gpt-5.1', from: 'model' }, // effort 后缀 + 家族前缀
  { input: 'openai/gpt-4o-2024-11-20', key: 'gpt-4o', from: 'model' }, // 命名空间 + 日期
  { input: 'gpt-4o-mini-2024-07-18', key: 'gpt-4o-mini', from: 'model' }, // 日期（不能误落到 gpt-4o）
  { input: 'mimo-v2.5-pro', key: 'mimo-v2.5-pro', from: 'model' }, // 点号不破坏精确匹配
  { input: 'mimo-v2.5-pro-high', key: 'mimo-v2.5-pro', from: 'model' }, // effort 后缀
  { input: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', key: 'deepseek-ai/DeepSeek-V4-Flash', from: 'model' }, // 命名空间 + 大小写
  { input: 'gemini-2.5-pro-001', key: 'gemini-2.5-pro', from: 'catalog' }, // 目录源 + 日期
  { input: 'moonshotai/kimi-k2.7-code', key: 'kimi-k2.7-code', from: 'catalog' }, // 目录源 + 命名空间
];

describe('modelNameCandidates (task 085)', () => {
  it('keeps the raw name first and generates the normalized tail', () => {
    const candidates = modelNameCandidates('openrouter/anthropic/claude-3.5-sonnet-20241022');
    expect(candidates[0]).toBe('openrouter/anthropic/claude-3.5-sonnet-20241022');
    expect(candidates).toContain('anthropic/claude-3.5-sonnet-20241022');
    expect(candidates).toContain('openrouter/anthropic/claude-3-5-sonnet');
    expect(candidates).toContain('claude-3-5-sonnet');
  });

  it('dedupes and is order-stable (least transformed first)', () => {
    const candidates = modelNameCandidates('claude-3-5-sonnet-20241022');
    expect(candidates).toEqual([...new Set(candidates)]);
    expect(candidates.indexOf('claude-3-5-sonnet')).toBeGreaterThan(candidates.indexOf('claude-3-5-sonnet-20241022'));
  });

  it('handles empty / whitespace input', () => {
    expect(modelNameCandidates('')).toEqual([]);
    expect(modelNameCandidates('   ')).toEqual([]);
  });
});

describe('isFamilyPrefix (task 085)', () => {
  it('matches only on a delimiter boundary', () => {
    expect(isFamilyPrefix('gpt-5.1-codex', 'gpt-5.1')).toBe(true);
    expect(isFamilyPrefix('gpt-5.1-codex', 'gpt-5')).toBe(true); // '.' 也算边界（最长键优先）
    expect(isFamilyPrefix('gpt-5x', 'gpt-5')).toBe(false); // 无边界 → 不匹配
    expect(isFamilyPrefix('gpt-5.1', 'gpt-5.1')).toBe(false); // 相等不算前缀
  });
});

describe('resolvePrice 归一命中 (task 085) — ≥8 真实变体', () => {
  for (const v of VARIANTS) {
    it(`"${v.input}" → ${v.key}`, () => {
      const resolved = resolvePrice(TABLE, v.input, 'openai-compatible', CATALOG_SOURCE);
      expect(resolved.source).toBe(v.from);
      expect(resolved.matchedKey).toBe(v.key);
      expect(resolved.estimated).toBe(false);
      expect(resolved.price.input).toBeGreaterThan(0);
    });
  }

  it('归一前(basename 精确) 命中率低于归一后', () => {
    const legacyHits = VARIANTS.filter((v) => legacyBasenameLookup(v.input) !== undefined).length;
    const newHits = VARIANTS.filter((v) => {
      const r = resolvePrice(TABLE, v.input, 'openai-compatible', CATALOG_SOURCE);
      return r.source === 'model' || r.source === 'catalog';
    }).length;
    expect(newHits).toBe(VARIANTS.length);
    expect(newHits).toBeGreaterThan(legacyHits);
    // 归一前只有「已带命名空间或本身就精确」的少数几个能命中
    expect(legacyHits).toBeLessThan(VARIANTS.length);
  });

  it('gpt-4o-mini-2024-07-18 不会误落到 gpt-4o', () => {
    expect(resolvePrice(TABLE, 'gpt-4o-mini-2024-07-18', 'openai-compatible').matchedKey).toBe('gpt-4o-mini');
  });
});

describe('resolvePrice 匹配顺序（精确优先于家族前缀，task 085 修正）', () => {
  const miniCatalog = createCatalogPriceSource([{ model: 'gpt-4o-mini', priceIn: 0.15, priceOut: 0.6 }], {
    idOf: (m) => m.model,
    priceOf: (m) => ({ input: m.priceIn!, output: m.priceOut! }),
  });

  it('catalog 精确命中优先于 model 表家族前缀（gpt-4o-mini 不被 gpt-4o 抢走）', () => {
    const table: PricingTable = { models: { 'gpt-4o': { input: 2.5, output: 10 } }, protocols: {} };
    const r = resolvePrice(table, 'gpt-4o-mini-2024-07-18', undefined, miniCatalog);
    expect(r.source).toBe('catalog');
    expect(r.matchedKey).toBe('gpt-4o-mini');
    expect(r.price.input).toBe(0.15); // 不是 gpt-4o 的 2.5
  });

  it('家族前缀阶段取命中键最长者（catalog gpt-5.1 胜过 model gpt-5）', () => {
    const table: PricingTable = { models: { 'gpt-5': { input: 1.25, output: 10 } }, protocols: {} };
    const catalog = createCatalogPriceSource([{ model: 'gpt-5.1', priceIn: 1.25, priceOut: 10 }], {
      idOf: (m) => m.model,
      priceOf: (m) => ({ input: m.priceIn!, output: m.priceOut! }),
    });
    const r = resolvePrice(table, 'gpt-5.1-codex-high', undefined, catalog);
    expect(r.source).toBe('catalog');
    expect(r.matchedKey).toBe('gpt-5.1');
  });

  it('model 表精确命中始终优先于 catalog 精确命中（回退链 model > catalog）', () => {
    const table: PricingTable = { models: { 'gpt-4o-mini': { input: 0.2, output: 0.8 } }, protocols: {} };
    const r = resolvePrice(table, 'gpt-4o-mini', undefined, miniCatalog);
    expect(r.source).toBe('model');
    expect(r.price.input).toBe(0.2);
  });
});

describe('resolvePrice 来源与 estimated 语义 (task 086)', () => {
  it('model 级命中 → source=model, estimated=false, 带审计字段', () => {
    const r = resolvePrice(TABLE, 'deepseek-chat', 'openai-compatible');
    expect(r).toMatchObject({ source: 'model', estimated: false, matchedKey: 'deepseek-chat' });
    expect(r.price.input).toBe(0.27);
  });

  it('catalog 命中 → source=catalog, estimated=false', () => {
    const r = resolvePrice(TABLE, 'gemini-2.5-pro', 'openai-compatible', CATALOG_SOURCE);
    expect(r.source).toBe('catalog');
    expect(r.estimated).toBe(false);
    expect(r.price.input).toBe(1.25);
  });

  it('protocol 兜底 → source=protocol，且标 estimated（协议级通用价不是模型专属价）', () => {
    const r = resolvePrice(TABLE, 'totally-unknown-model', 'anthropic');
    expect(r).toMatchObject({ source: 'protocol', estimated: true, matchedKey: 'anthropic' });
    expect(r.price.input).toBe(3);
  });

  it('default 兜底 → source=default 且 estimated=true（假成本显式化）', () => {
    const r = resolvePrice(TABLE, 'zzz-unknown', undefined);
    expect(r).toMatchObject({ source: 'default', estimated: true, matchedKey: 'default' });
    expect(r.price).toEqual(DEFAULT_TOKEN_PRICE);
  });

  it('strict 模式不用 default 兜底 → source=unpriced + 零价', () => {
    const r = resolvePrice(TABLE, 'zzz-unknown', undefined, undefined, { strict: true });
    expect(r).toMatchObject({ source: 'unpriced', estimated: false });
    expect(r.price).toEqual(ZERO_TOKEN_PRICE);
  });

  it('strict 模式只用模型专属价目：protocol 级与 default 都不用', () => {
    expect(resolvePrice(TABLE, 'deepseek-chat', undefined, undefined, { strict: true }).source).toBe('model');
    expect(resolvePrice(TABLE, 'gemini-2.5-pro', undefined, CATALOG_SOURCE, { strict: true }).source).toBe('catalog');
    // protocol 兜底在 strict 下不可用（否则 strict 形同虚设）
    const byProto = resolvePrice(TABLE, 'zzz', 'anthropic', undefined, { strict: true });
    expect(byProto).toMatchObject({ source: 'unpriced', estimated: false });
    expect(byProto.price).toEqual(ZERO_TOKEN_PRICE);
  });

  it('mock 零价仍按 model 级命中（不是 default 估算）', () => {
    const r = resolvePrice(TABLE, 'mock', 'mock');
    expect(r).toMatchObject({ source: 'model', estimated: false });
    expect(r.price.input).toBe(0);
  });

  it('空表 + 无 catalog + 无 protocol → default 估算', () => {
    const r = resolvePrice({ models: {}, protocols: {} }, 'whatever');
    expect(r.estimated).toBe(true);
    expect(r.price).toEqual(DEFAULT_TOKEN_PRICE);
  });
});

describe('createCatalogPriceSource (task 085/087)', () => {
  it('复用同一套归一规则查目录价', () => {
    expect(CATALOG_SOURCE.findPrice('moonshotai/kimi-k2.7-code')?.input).toBe(0.95);
    expect(CATALOG_SOURCE.findPrice('GLM-5')?.input).toBe(1);
    expect(CATALOG_SOURCE.findPrice('nope')).toBeUndefined();
  });
});

describe('cache 写入计价 (task 090)', () => {
  const SONNET: TokenPrice = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

  it('costBreakdown 四项分算：input/output/cacheRead/cacheWrite', () => {
    const b = costBreakdown(SONNET, {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    });
    expect(b.inputUsd).toBeCloseTo(3, 10);
    expect(b.outputUsd).toBeCloseTo(15, 10);
    expect(b.cacheReadUsd).toBeCloseTo(0.3, 10);
    expect(b.cacheWriteUsd).toBeCloseTo(3.75, 10);
    expect(b.totalUsd).toBeCloseTo(22.05, 10);
    expect(b.cacheWritePriceSource).toBe('explicit');
    expect(b.cacheWriteDerived).toBe(false);
  });

  it('cache 写入不再被低估：只算 read 的旧口径 vs 含 write 的新口径', () => {
    const tokens = { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000 };
    const withWrite = costOf(SONNET, tokens);
    const withoutWrite = costOf(SONNET, { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 });
    expect(withWrite - withoutWrite).toBeCloseTo(3.75, 10);
    expect(withWrite).toBeCloseTo(7.05, 10);
  });

  it('缺 cacheWrite → 按 input×1.25 推导并标 derived', () => {
    const noWrite: TokenPrice = { input: 3, output: 15, cacheRead: 0.3 };
    expect(CACHE_WRITE_INPUT_MULTIPLIER).toBe(1.25);
    expect(resolveCacheWritePrice(noWrite)).toEqual({ unitPrice: 3 * CACHE_WRITE_INPUT_MULTIPLIER, source: 'derived' });
    const b = costBreakdown(noWrite, { cacheCreationTokens: 1_000_000 });
    expect(b.cacheWriteUsd).toBeCloseTo(3.75, 10);
    expect(b.cacheWritePriceSource).toBe('derived');
    expect(b.cacheWriteDerived).toBe(true);
  });

  it('显式 cacheWrite=0（不单独收写入费）不触发推导', () => {
    const zero: TokenPrice = { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 };
    expect(resolveCacheWritePrice(zero)).toEqual({ unitPrice: 0, source: 'explicit' });
    const b = costBreakdown(zero, { cacheCreationTokens: 1_000_000 });
    expect(b.cacheWriteUsd).toBe(0);
    expect(b.cacheWriteDerived).toBe(false);
  });

  it('价目行连 cache 语义都没有 → absent + 0（不凭空加钱）', () => {
    const plain: TokenPrice = { input: 1, output: 2 };
    expect(resolveCacheWritePrice(plain)).toEqual({ unitPrice: 0, source: 'absent' });
    const b = costBreakdown(plain, { cacheCreationTokens: 1_000_000 });
    expect(b.cacheWriteUsd).toBe(0);
    expect(b.totalUsd).toBe(0);
  });

  it('未上报 cache 写入 token 时成本与旧口径完全一致（向后兼容）', () => {
    const legacy = costOf(SONNET, { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 });
    const withZeroWrite = costOf(SONNET, {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 0,
    });
    expect(withZeroWrite).toBeCloseTo(legacy, 10);
  });

  it('ZERO_TOKEN_PRICE 的 cacheWrite 显式为 0（strict 未收录不推导）', () => {
    expect(ZERO_TOKEN_PRICE.cacheWrite).toBe(0);
    expect(resolveCacheWritePrice(ZERO_TOKEN_PRICE)).toEqual({ unitPrice: 0, source: 'explicit' });
  });
});
