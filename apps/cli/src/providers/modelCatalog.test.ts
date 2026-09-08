import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelCatalog, findCatalogModel, findCatalogModelByBase, listCatalogModels } from './modelCatalog.js';
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
    // pricing.json has deepseek-chat; pick a catalog-only model like claude-sonnet-4-5
    const src = {
      findPrice: (m: string) => {
        const e = findCatalogModel(catalog, m) ?? findCatalogModelByBase(catalog, m);
        return e && e.priceIn != null ? { input: e.priceIn, output: e.priceOut ?? 0, cacheRead: e.priceCache } : undefined;
      },
    };
    const price = resolvePrice(table, 'claude-sonnet-4-5', 'anthropic', src);
    expect(price.input).toBe(3); // catalog: claude-sonnet-4-5 input $3/1M
    // pricing.json deepseek-chat still wins over catalog
    expect(resolvePrice(table, 'deepseek-chat', 'openai-compatible', src).input).toBe(0.27);
  });
});
