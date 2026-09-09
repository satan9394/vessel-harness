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
 *
 * task 093：该文件由 `vessel pricing sync`（`pricingSync.ts`）从 models.dev 增量更新；
 * 本文件只负责**读**与结构比较，拉取/合并/原子写都在 `pricingSync.ts`。
 */

export interface CatalogModel {
  model: string;
  provider: string;
  contextWindow?: number;
  outputLimit?: number;
  priceIn?: number;
  priceOut?: number;
  priceCache?: number;
  /** cache **写入**价（Anthropic cache_creation），每 1M tokens；task 090。 */
  priceCacheWrite?: number;
}

export interface ModelCatalog {
  version: number;
  source: string;
  models: CatalogModel[];
  /** 最近一次 `vessel pricing sync` 成功写盘的 ISO 时间（task 093；手工维护的目录可缺省）。 */
  lastSyncAt?: string;
}

/** 目录条目键：`provider::model`（与 usage.json 条目键同格式）。 */
export function catalogEntryKey(entry: Pick<CatalogModel, 'provider' | 'model'>): string {
  return `${entry.provider}::${entry.model}`;
}

/**
 * 条目等价比较（task 093 幂等判定）：`null` 与「字段缺失」等价，
 * 其余数值按 `===` 比较（同步写盘用精确数值，不做容差——避免每次同步都写盘）。
 */
export function sameCatalogModel(a: CatalogModel, b: CatalogModel): boolean {
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return (
    a.model === b.model &&
    a.provider === b.provider &&
    num(a.contextWindow) === num(b.contextWindow) &&
    num(a.outputLimit) === num(b.outputLimit) &&
    num(a.priceIn) === num(b.priceIn) &&
    num(a.priceOut) === num(b.priceOut) &&
    num(a.priceCache) === num(b.priceCache) &&
    num(a.priceCacheWrite) === num(b.priceCacheWrite)
  );
}

/** 目录文件读取（缺失 / JSON 损坏 / 结构非法 → 空目录，不抛错）。 */
export function readModelCatalog(file: string): ModelCatalog {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ModelCatalog;
    if (!Array.isArray(raw.models)) return { version: 1, source: '', models: [] };
    const out: ModelCatalog = { version: raw.version ?? 1, source: raw.source ?? '', models: raw.models };
    if (typeof raw.lastSyncAt === 'string') out.lastSyncAt = raw.lastSyncAt;
    return out;
  } catch {
    return { version: 1, source: '', models: [] };
  }
}

/** load configs/model-catalog.json; missing/corrupt → empty catalog. */
export function loadModelCatalog(configRoot = process.cwd()): ModelCatalog {
  return readModelCatalog(path.join(configRoot, 'configs', 'model-catalog.json'));
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
      m.priceIn == null
        ? undefined
        : { input: m.priceIn, output: m.priceOut ?? 0, cacheRead: m.priceCache, cacheWrite: m.priceCacheWrite },
  });
}

/** all models (for pricing tables / listings), sorted by provider then model. */
export function listCatalogModels(catalog: ModelCatalog): CatalogModel[] {
  return [...catalog.models].sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : a.model < b.model ? -1 : 1));
}
