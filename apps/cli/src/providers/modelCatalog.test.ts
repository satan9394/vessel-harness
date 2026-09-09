import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadModelCatalog,
  findCatalogModel,
  findCatalogModelByBase,
  findCatalogModelMatch,
  catalogPriceSource,
  listCatalogModels,
} from './modelCatalog.js';
import { resolvePrice, loadPricing } from './pricing.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)); // providers -> src -> cli -> apps -> repo root

describe('modelCatalog (V0.9, task 030)', () => {
  it('loads the repo catalog with 20+ mainstream models', () => {
    const c = loadModelCatalog(REPO_ROOT);
    expect(c.models.length).toBeGreaterThanOrEqual(20);
    expect(c.source).toContain('models.dev');
  });

  it('finds a model by exact id and by basename', () => {
    const c = loadModelCatalog(REPO_ROOT);
    const claude = findCatalogModel(c, 'claude-sonnet-4-5');
    expect(claude).toBeDefined();
    expect(claude!.priceIn).toBeGreaterThan(0);
    // basename lookup tolerates provider prefixes
    const byBase = findCatalogModelByBase(c, 'anthropic/claude-sonnet-4-5');
    expect(byBase?.model).toBe('claude-sonnet-4-5');
  });

  it('normalizes real-world model name variants (task 085)', () => {
    const c = loadModelCatalog(REPO_ROOT);
    const cases: { input: string; expect: string }[] = [
      { input: 'anthropic/claude-sonnet-4-5', expect: 'claude-sonnet-4-5' },
      { input: 'claude-sonnet-4-5-20250929', expect: 'claude-sonnet-4-5' },
      { input: 'claude-opus-4.5', expect: 'claude-opus-4-5' },
      { input: 'CLAUDE-HAIKU-4-5', expect: 'claude-haiku-4-5' },
      { input: 'openai/gpt-5.1-codex-high', expect: 'gpt-5.1' },
      { input: 'gpt-4o-mini-2024-07-18', expect: 'gpt-4o-mini' },
      { input: 'google/gemini-2.5-pro-001', expect: 'gemini-2.5-pro' },
      { input: 'moonshotai/kimi-k2.7-code', expect: 'kimi-k2.7-code' },
      { input: 'siliconflow/deepseek-ai/DeepSeek-V4-Flash', expect: 'deepseek-ai/DeepSeek-V4-Flash' },
      { input: 'zai-org/GLM-5', expect: 'zai-org/GLM-5' },
    ];
    for (const c2 of cases) {
      expect(findCatalogModelMatch(c, c2.input)?.key, c2.input).toBe(c2.expect);
    }
  });

  it('lists models sorted by provider then model', () => {
    const c = loadModelCatalog(REPO_ROOT);
    const list = listCatalogModels(c);
    expect(list.length).toBe(c.models.length);
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.provider >= list[i - 1]!.provider).toBe(true);
    }
  });

  it('missing catalog returns empty without throwing', () => {
    const empty = loadModelCatalog('/nonexistent');
    expect(empty.models).toEqual([]);
  });

  it('resolvePrice falls back to catalog price when pricing.json has no entry', () => {
    const table = loadPricing(REPO_ROOT);
    const catalog = loadModelCatalog(REPO_ROOT);
    const src = catalogPriceSource(catalog);
    const price = resolvePrice(table, 'claude-sonnet-4-5', 'anthropic', src);
    expect(price.price.input).toBe(3); // catalog: claude-sonnet-4-5 input $3/1M
    expect(price.source).toBe('model'); // pricing.json also has claude-sonnet-4-5
    // pricing.json deepseek-chat still wins over catalog
    expect(resolvePrice(table, 'deepseek-chat', 'openai-compatible', src).price.input).toBe(0.27);
    // catalog-only model resolves through the catalog source
    const gemini = resolvePrice(table, 'google/gemini-2.5-pro-001', 'openai-compatible', src);
    expect(gemini.source).toBe('catalog');
    expect(gemini.price.input).toBe(1.25);
  });

  it('catalog price source normalizes namespaced/dated variants (task 085/087)', () => {
    const src = catalogPriceSource(loadModelCatalog(REPO_ROOT));
    expect(src.findPrice('moonshotai/kimi-k2.7-code')?.input).toBe(0.95);
    expect(src.findPrice('zai-org/GLM-5')?.input).toBe(0.95); // 目录里 glm-5 有多家 → 首条命中
    expect(src.findPrice('nonexistent-model')).toBeUndefined();
  });
});
