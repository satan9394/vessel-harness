import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * apps/cli/providers/modelCatalog — curated model metadata (V0.9, task 030).
 *
 * Data source: configs/model-catalog.json (generated from the models.dev
 * 2026-09 snapshot — see its `source` field). Entries carry context window,
 * output limit and per-1M-token USD prices so `vessel models --meta`,
 * `vessel pricing` and UsageStore cost estimation can use them.
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

/** lookup by basename (e.g. 'claude-sonnet-4-5' matches 'anthropic/claude-sonnet-4-5'). */
export function findCatalogModelByBase(catalog: ModelCatalog, model: string): CatalogModel | undefined {
  const base = model.includes('/') ? model.split('/').pop()! : model;
  return catalog.models.find((m) => m.model === base || m.model.endsWith(`/${base}`));
}

/** all models (for pricing tables / listings), sorted by provider then model. */
export function listCatalogModels(catalog: ModelCatalog): CatalogModel[] {
  return [...catalog.models].sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : a.model < b.model ? -1 : 1));
}
