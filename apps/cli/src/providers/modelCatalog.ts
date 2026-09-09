import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCatalogPriceSource, matchModelName, type CatalogPriceSource, type ModelMatch } from '@vessel/shared';

/**
 * apps/cli/providers/modelCatalog — curated model metadata (V0.9, task 030)。
 *
 * Data source: configs/model-catalog.json (generated from the models.dev
 * 2026-09 snapshot — see its `source` field). Entries carry context window,
 * output limit and per-1M-token USD prices so `vessel models --meta`,
 * `vessel pricing` and UsageStore cost estimation can use them.
 *
 * 查名规则（task 085）：走 `@vessel/shared/pricing` 的 `matchModelName`——
 * 与 `resolvePrice` 共用同一套归一候选（命名空间/日期/effort/点号/大小写），
 * 本文件不再自己写 basename 逻辑。
 */

export interface CatalogModel {
  model: string;
  provider: string;
  contextWindow?: number;
  outputLimit?: number;
  priceIn?: number;
  priceOut?: number;
  priceCache?: number;
}

export interface ModelCatalog {
  version: number;
  source: string;
  models: CatalogModel[];
}

/** load configs/model-catalog.json; missing/corrupt → empty catalog. */
export function loadModelCatalog(configRoot = process.cwd()): ModelCatalog {
  const file = path.join(configRoot, 'configs', 'model-catalog.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ModelCatalog;
    if (!Array.isArray(raw.models)) return { version: 1, source: '', models: [] };
    return { version: raw.version ?? 1, source: raw.source ?? '', models: raw.models };
  } catch {
    return { version: 1, source: '', models: [] };
  }
}

/** exact id lookup (model id as-is, e.g. claude-sonnet-4-5). */
export function findCatalogModel(catalog: ModelCatalog, model: string): CatalogModel | undefined {
  return catalog.models.find((m) => m.model === model);
}

/**
 * lookup by normalized name (task 085)：容忍命名空间前缀 / 日期后缀 /
 * effort 后缀 / Claude 点号 / 大小写，先精确再家族前缀。
 * 例：`openrouter/anthropic/claude-3.5-sonnet-20241022` → `claude-3-5-sonnet`。
 */
export function findCatalogModelMatch(catalog: ModelCatalog, model: string): ModelMatch<CatalogModel> | undefined {
  return matchModelName(model, catalog.models, (m) => m.model);
}

/** 兼容旧名（语义已升级为归一匹配，见 `findCatalogModelMatch`）。 */
export function findCatalogModelByBase(catalog: ModelCatalog, model: string): CatalogModel | undefined {
  return findCatalogModelMatch(catalog, model)?.entry;
}

/** 目录价源：喂给 `resolvePrice(..., catalog)`（与查名共用同一归一实现）。 */
export function catalogPriceSource(catalog: ModelCatalog): CatalogPriceSource {
  return createCatalogPriceSource(catalog.models, {
    idOf: (m) => m.model,
    priceOf: (m) =>
      m.priceIn == null ? undefined : { input: m.priceIn, output: m.priceOut ?? 0, cacheRead: m.priceCache },
  });
}

/** all models (for pricing tables / listings), sorted by provider then model. */
export function listCatalogModels(catalog: ModelCatalog): CatalogModel[] {
  return [...catalog.models].sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : a.model < b.model ? -1 : 1));
}
