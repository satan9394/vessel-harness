import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  catalogEntryKey,
  readModelCatalog,
  sameCatalogModel,
  type CatalogModel,
  type ModelCatalog,
} from './modelCatalog.js';

/**
 * apps/cli/providers/pricingSync — models.dev 价目同步（task 093）。
 *
 * 学 cc-switch「价格更新三通道」的**设计思想**（seed / 值守卫修复 / models.dev 同步），
 * 实现为本仓库自有代码，三通道在这里对齐：
 *   1. **seed**：`configs/pricing.json` 由版本维护（手工/发版更新），本文件不碰它；
 *   2. **值守卫修复**：`~/.vessel/pricing.override.json` 的 `repair`（task 092），只改「现值 = 旧值」的行；
 *   3. **models.dev 同步**：本文件——拉 `https://models.dev/api.json`，**增量 upsert**
 *      `configs/model-catalog.json`（或 `--catalog` 指定的文件）。
 *
 * 与 cc-switch 的关键差异（刻意避开它的坑）：
 *   - cc-switch 的批量同步会**静默覆盖同名手动价**；这里同步只写 **catalog**，
 *     用户覆盖文件 `pricing.override.json` 一个字节都不动（优先级链
 *     override > 内置 pricing.json > catalog > protocol > default 保持 100/092 的语义）。
 *   - 拉取失败（超时/断网/代理）→ **保留旧表 + 明确提示**，绝不静默清空；
 *     返回 `status:'offline'`，CLI 打印警告并以 exit 1 收尾（同步没发生就要能看出来）。
 *   - 远端未覆盖的既有条目**保留**（不删）：删条目不在这张卡的范围内，
 *     宁可留旧价也不制造空洞（旧价错了由 override/repair 修）。
 *
 * 幂等：相同远端数据第二次同步 `status:'unchanged'`、**不写盘**（文件逐字节不变）。
 * 原子写：tmp + rename（同 ProviderStore / UsageStore；Windows 上有界重试）。
 */

/** models.dev 公开 API（返回 `{ [providerId]: { models: { [modelId]: {...} } } }`）。 */
export const MODELS_DEV_URL = 'https://models.dev/api.json';

/** 拉取超时（毫秒）——与 cc-switch 的 15s 一致。 */
export const DEFAULT_SYNC_TIMEOUT_MS = 15_000;

/** 失败后的**额外**重试次数上限（1 次；即最多请求 2 次）。 */
export const MAX_SYNC_RETRIES = 1;

/** 同步写盘时写入 catalog 的 `source` 描述（不含时间戳——时间戳放 `lastSyncAt`，保证幂等比较只看 models）。 */
export function catalogSourceLine(url: string = MODELS_DEV_URL): string {
  return (
    `models.dev 同步（${url}）；价目单位 USD/1M tokens。` +
    'priceCache = 缓存读取价，priceCacheWrite = 缓存写入价（Anthropic cache_creation；' +
    '缺省时按 input×1.25 推导，见 docs/PRICING.md §7）。' +
    '用户覆盖 ~/.vessel/pricing.override.json 优先级最高，同步不会覆盖它（task 093/100）。'
  );
}

/** 注入用 fetch 形状（只需 CLI 用到的字段；测试注入 mock，不依赖真实网络）。 */
export interface SyncFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type SyncFetch = (url: string, init: { signal?: AbortSignal }) => Promise<SyncFetchResponse>;

export interface ParseCatalogOptions {
  /** 只收录这些 provider（缺省 = 全部）。 */
  providers?: readonly string[];
  /** 排除 glob（大小写不敏感，`*` 匹配任意字符）；匹配对象：model / provider / `provider/model` / `provider::model`。 */
  exclude?: readonly string[];
}

export interface ParsedCatalog {
  models: CatalogModel[];
  /** 远端 provider 数 */
  providers: number;
  /** 远端模型条目数（未过滤前） */
  remoteModels: number;
  /** 被过滤掉的条数，按原因分列（不静默丢） */
  skipped: { nonText: number; noPrice: number; deprecated: number; excluded: number; provider: number };
}

export interface SyncModelCatalogOptions extends ParseCatalogOptions {
  /** 目标 catalog 文件路径（`configs/model-catalog.json` 或用户态目录）。 */
  catalogPath: string;
  /** true = 只算差异、不写盘。 */
  dryRun?: boolean;
  url?: string;
  fetchImpl?: SyncFetch;
  timeoutMs?: number;
  /** 额外重试次数（缺省 `MAX_SYNC_RETRIES` = 1，即最多请求 2 次）。 */
  retries?: number;
  /** 时钟（测试注入固定时间）。 */
  now?: () => Date;
}

export type SyncStatus = 'updated' | 'unchanged' | 'dry-run' | 'offline';

export interface SyncModelCatalogResult {
  status: SyncStatus;
  catalogPath: string;
  url: string;
  /** 实际请求次数（1 = 首次成功；2 = 重试过一次）。 */
  attempts: number;
  wrote: boolean;
  added: CatalogModel[];
  updated: { before: CatalogModel; after: CatalogModel }[];
  unchanged: number;
  /** 远端未覆盖、原样保留的既有条目（同步不删条目）。 */
  kept: CatalogModel[];
  /** 同步后的条目总数（offline 时 = 旧表条目数）。 */
  total: number;
  parsed: ParsedCatalog;
  error?: string;
}

/** 简单的 glob（`*` → 任意字符、`?` → 单个字符；大小写不敏感，整串匹配）。 */
export function matchGlob(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return regex.test(value);
}

function isExcluded(provider: string, model: string, patterns: readonly string[]): boolean {
  const targets = [model, provider, `${provider}/${model}`, `${provider}::${model}`];
  return patterns.some((p) => p.trim() !== '' && targets.some((t) => matchGlob(p.trim(), t)));
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 非文本输出（embedding / 语音 / 图像生成）不进价目表——它们没有 token 计价语义。 */
function isNonTextModel(model: Record<string, unknown>): boolean {
  const modalities = model.modalities;
  if (modalities === null || typeof modalities !== 'object') return false; // 缺字段 → 不武断排除
  const output = (modalities as { output?: unknown }).output;
  if (!Array.isArray(output)) return false;
  return !output.some((m) => m === 'text');
}

function isDeprecated(model: Record<string, unknown>): boolean {
  if (model.deprecated === true) return true;
  const status = model.status;
  return typeof status === 'string' && /deprecat/i.test(status);
}

/**
 * 解析 models.dev 响应 → 目录条目（纯函数，零 I/O；测试直接喂 mock 数据）。
 *
 * 映射：`cost.input → priceIn`、`cost.output → priceOut`、`cost.cache_read → priceCache`、
 * `cost.cache_write → priceCacheWrite`、`limit.context → contextWindow`、`limit.output → outputLimit`。
 * 过滤：非文本输出 / 已弃用 / 缺价（没有 input 或 output）/ 被 `--provider`·`--exclude` 排除。
 */
export function parseModelsDevCatalog(api: unknown, options: ParseCatalogOptions = {}): ParsedCatalog {
  const providers = new Set(options.providers ?? []);
  const exclude = options.exclude ?? [];
  const skipped = { nonText: 0, noPrice: 0, deprecated: 0, excluded: 0, provider: 0 };
  const models: CatalogModel[] = [];
  const seen = new Set<string>();
  if (api === null || typeof api !== 'object' || Array.isArray(api)) {
    return { models, providers: 0, remoteModels: 0, skipped };
  }
  const root = api as Record<string, unknown>;
  let providerCount = 0;
  let remoteModels = 0;
  for (const [providerId, rawProvider] of Object.entries(root)) {
    if (rawProvider === null || typeof rawProvider !== 'object') continue;
    const provider = rawProvider as Record<string, unknown>;
    const id = typeof provider.id === 'string' && provider.id !== '' ? provider.id : providerId;
    const rawModels = provider.models;
    if (rawModels === null || typeof rawModels !== 'object') continue;
    providerCount += 1;
    if (providers.size > 0 && !providers.has(id) && !providers.has(providerId)) {
      const count = Object.keys(rawModels as Record<string, unknown>).length;
      remoteModels += count;
      skipped.provider += count;
      continue;
    }
    for (const [modelKey, rawModel] of Object.entries(rawModels as Record<string, unknown>)) {
      remoteModels += 1;
      if (rawModel === null || typeof rawModel !== 'object') {
        skipped.noPrice += 1;
        continue;
      }
      const model = rawModel as Record<string, unknown>;
      const modelId = typeof model.id === 'string' && model.id !== '' ? model.id : modelKey;
      if (isNonTextModel(model)) {
        skipped.nonText += 1;
        continue;
      }
      if (isDeprecated(model)) {
        skipped.deprecated += 1;
        continue;
      }
      if (isExcluded(id, modelId, exclude)) {
        skipped.excluded += 1;
        continue;
      }
      const cost = (model.cost ?? {}) as Record<string, unknown>;
      const priceIn = finite(cost.input);
      const priceOut = finite(cost.output);
      if (priceIn === undefined || priceOut === undefined || priceIn < 0 || priceOut < 0) {
        skipped.noPrice += 1;
        continue;
      }
      const limit = (model.limit ?? {}) as Record<string, unknown>;
      const entry: CatalogModel = { model: modelId, provider: id, priceIn, priceOut };
      const contextWindow = finite(limit.context);
      const outputLimit = finite(limit.output);
      const priceCache = finite(cost.cache_read);
      const priceCacheWrite = finite(cost.cache_write);
      if (contextWindow !== undefined) entry.contextWindow = contextWindow;
      if (outputLimit !== undefined) entry.outputLimit = outputLimit;
      if (priceCache !== undefined) entry.priceCache = priceCache;
      if (priceCacheWrite !== undefined) entry.priceCacheWrite = priceCacheWrite;
      const key = catalogEntryKey(entry);
      if (seen.has(key)) continue; // 同一 provider 内同名（理论上不出现）：首个胜
      seen.add(key);
      models.push(entry);
    }
  }
  return { models: sortCatalog(models), providers: providerCount, remoteModels, skipped };
}

/** 目录条目排序：provider → model（与 `listCatalogModels` 同序，保证写盘确定性）。 */
export function sortCatalog(models: readonly CatalogModel[]): CatalogModel[] {
  return [...models].sort((a, b) =>
    a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : a.model < b.model ? -1 : a.model > b.model ? 1 : 0,
  );
}

/** 一次拉取结果（失败不抛，交给调用方决定回退语义）。 */
async function fetchModelsDev(
  options: Required<Pick<SyncModelCatalogOptions, 'url' | 'timeoutMs' | 'retries'>> & { fetchImpl?: SyncFetch },
): Promise<{ ok: true; data: unknown; attempts: number } | { ok: false; error: string; attempts: number }> {
  const doFetch: SyncFetch =
    options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as Promise<SyncFetchResponse>);
  const maxAttempts = Math.max(1, options.retries + 1);
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const res = await doFetch(options.url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { ok: true, data, attempts: attempt };
    } catch (error) {
      lastError = (error as Error)?.message ?? String(error);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError, attempts: maxAttempts };
}

/** 原子写（tmp + rename；Windows 上 EPERM/EBUSY 有界重试）。 */
function writeCatalogAtomic(file: string, catalog: ModelCatalog): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt === 0 ? 5 : 15);
    }
  }
  throw lastError;
}

/**
 * 同步一次：拉取 → 解析 → 与既有目录增量合并 → （非 dry-run 且有变更时）原子写。
 *
 * 返回的 `status`：
 *   - `updated`   有新增/更新并已写盘
 *   - `unchanged` 远端数据与既有目录一致 → **不写盘**（幂等）
 *   - `dry-run`   只算差异、不写盘
 *   - `offline`   拉取/解析失败 → 旧表**原样保留**（`wrote:false`），带 `error`
 */
export async function syncModelCatalog(options: SyncModelCatalogOptions): Promise<SyncModelCatalogResult> {
  const url = options.url ?? MODELS_DEV_URL;
  const existing = readModelCatalog(options.catalogPath);
  const base: SyncModelCatalogResult = {
    status: 'offline',
    catalogPath: options.catalogPath,
    url,
    attempts: 0,
    wrote: false,
    added: [],
    updated: [],
    unchanged: 0,
    kept: [],
    total: existing.models.length,
    parsed: { models: [], providers: 0, remoteModels: 0, skipped: { nonText: 0, noPrice: 0, deprecated: 0, excluded: 0, provider: 0 } },
  };

  const fetched = await fetchModelsDev({
    url,
    timeoutMs: options.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS,
    retries: options.retries ?? MAX_SYNC_RETRIES,
    fetchImpl: options.fetchImpl,
  });
  if (!fetched.ok) {
    // 离线回退：**不写盘、不清空**，把原因原样带回（CLI 打印并 exit 1）。
    return { ...base, attempts: fetched.attempts, error: fetched.error };
  }

  const parsed = parseModelsDevCatalog(fetched.data, {
    providers: options.providers,
    exclude: options.exclude,
  });
  if (parsed.models.length === 0) {
    return { ...base, attempts: fetched.attempts, parsed, error: '远端解析后 0 条可用模型（响应格式变化或过滤过严）' };
  }

  const byKey = new Map(existing.models.map((m) => [catalogEntryKey(m), m] as const));
  const added: CatalogModel[] = [];
  const updated: { before: CatalogModel; after: CatalogModel }[] = [];
  let unchanged = 0;
  const remoteKeys = new Set<string>();
  for (const remote of parsed.models) {
    const key = catalogEntryKey(remote);
    remoteKeys.add(key);
    const current = byKey.get(key);
    if (current === undefined) {
      added.push(remote);
      continue;
    }
    if (sameCatalogModel(current, remote)) {
      unchanged += 1;
      continue;
    }
    updated.push({ before: current, after: remote });
  }
  const kept = existing.models.filter((m) => !remoteKeys.has(catalogEntryKey(m)));
  const nextModels = sortCatalog([...kept, ...parsed.models]);
  const changed = added.length > 0 || updated.length > 0;

  const result: SyncModelCatalogResult = {
    status: changed ? 'updated' : 'unchanged',
    catalogPath: options.catalogPath,
    url,
    attempts: fetched.attempts,
    wrote: false,
    added,
    updated,
    unchanged,
    kept,
    total: nextModels.length,
    parsed,
  };

  if (!changed) return result; // 幂等：无变更不写盘
  if (options.dryRun) return { ...result, status: 'dry-run' };

  const now = options.now ?? (() => new Date());
  const catalog: ModelCatalog = {
    version: existing.version || 1,
    source: catalogSourceLine(url),
    lastSyncAt: now().toISOString(),
    models: nextModels,
  };
  writeCatalogAtomic(options.catalogPath, catalog);
  return { ...result, wrote: true };
}
