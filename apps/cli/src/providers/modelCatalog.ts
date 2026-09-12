import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCatalogPriceSource, matchModelName, type CatalogPriceSource, type ModelMatch } from '@vessel/shared';
import { resolveUsageRoot } from '../usage/UsageStore.js';

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
 *
 * Round 20（读写落点对齐）：目录解析改为「**用户数据优先、包内兜底**」——
 * `loadModelCatalog` 先读用户态 `<usageRoot>/model-catalog.json`
 * （`~/.vessel/model-catalog.json`；`VESSEL_USAGE_ROOT` 可覆盖，与 `pricing.override.json` 同根），
 * 没有（或坏到不可用）才回落包内 `<configRoot>/configs/model-catalog.json`。
 * 写侧同源：`vessel pricing sync` 的**默认**落点就是这个用户态文件（写得到才读得到）。
 * 目录文件层级**不变**：`override > 内置 pricing.json > catalog > protocol > default`，
 * 这里只改「catalog 这一档从哪儿取」，不改层序、不改命中即终结的语义。
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

/** 目录文件名（包内 `<configRoot>/configs/` 与用户态 `<usageRoot>/` 同名）。 */
export const MODEL_CATALOG_FILENAME = 'model-catalog.json';

/**
 * 用户态目录路径：`<usageRoot>/model-catalog.json`
 * （缺省 `~/.vessel/model-catalog.json`；`VESSEL_USAGE_ROOT` 可覆盖——与
 * `pricing.override.json` **同根**，于是测试隔离一个环境变量即可覆盖两者）。
 */
export function userModelCatalogPath(): string {
  return path.join(resolveUsageRoot(), MODEL_CATALOG_FILENAME);
}

/** 包内（内置）目录路径：`<configRoot>/configs/model-catalog.json`。 */
export function builtinModelCatalogPath(configRoot: string = process.cwd()): string {
  return path.join(configRoot, 'configs', MODEL_CATALOG_FILENAME);
}

/**
 * 读盘状态位：
 *   - `ok`       JSON 对象且带 `models` 数组；
 *   - `empty`    能解析成 JSON 对象，但没有 `models` 数组（例如 `{}`）→ 视为**空表**；
 *   - `missing`  文件不存在（ENOENT）；
 *   - `invalid`  JSON 解析失败 / 顶层不是对象 / 读盘失败（EACCES、EISDIR…）。
 */
export type CatalogReadStatus = 'ok' | 'empty' | 'missing' | 'invalid';

export interface CatalogReadResult {
  catalog: ModelCatalog;
  status: CatalogReadStatus;
  file: string;
  /** 非 `ok` 时的原因（供调用方拼告警文案；本函数**不打印、不抛**）。 */
  error?: string;
}

function emptyCatalog(): ModelCatalog {
  return { version: 1, source: '', models: [] };
}

/**
 * 带状态位的目录读取——优先级链要靠它区分三种「读不到」：
 * 「没有文件（→ 回落）」「文件坏了（→ 回落 + 告警）」「文件就是空表（→ 生效，**不**回落）」。
 *
 * `empty` 的判定（`{}` / 只写了 `version` 的文件）：按**用户主动清空**处理——空表生效，
 * **不**回落包内目录。理由：否则用户「清了文件却还在按旧价算钱」，而这正是本卡要修的
 * 读写不对称的镜像问题（`delete` 文件与 `{}` 文件表达的是两件事：前者=没意见，后者=我不要）。
 * 代价是「写错字段名（如 `model` 写单数）会静默变空表」——但那已经是**改成空目录**的
 * 可观察结果（目录价消失、成本落到 pricing.json/协议/兜底），不是静默用旧价。
 */
export function readModelCatalogFile(file: string): CatalogReadResult {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return { catalog: emptyCatalog(), status: 'missing', file };
    return { catalog: emptyCatalog(), status: 'invalid', file, error: `读取失败：${(error as Error).message}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { catalog: emptyCatalog(), status: 'invalid', file, error: `JSON 解析失败：${(error as Error).message}` };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { catalog: emptyCatalog(), status: 'invalid', file, error: '顶层不是 JSON 对象' };
  }
  const obj = raw as Partial<ModelCatalog>;
  if (!Array.isArray(obj.models)) return { catalog: emptyCatalog(), status: 'empty', file };
  const out: ModelCatalog = { version: obj.version ?? 1, source: obj.source ?? '', models: obj.models };
  if (typeof obj.lastSyncAt === 'string') out.lastSyncAt = obj.lastSyncAt;
  return { catalog: out, status: 'ok', file };
}

/** 目录文件读取（缺失 / JSON 损坏 / 结构非法 → 空目录，不抛错）。签名与语义逐字不变。 */
export function readModelCatalog(file: string): ModelCatalog {
  return readModelCatalogFile(file).catalog;
}

/** 生效目录来自哪一层。 */
export type CatalogOrigin = 'user' | 'builtin';

export interface ModelCatalogLoad {
  catalog: ModelCatalog;
  /** 实际生效的文件（两层都没有时 = 包内候选路径，内容为空目录）。 */
  file: string;
  origin: CatalogOrigin;
  /** 非致命告警（用户态损坏回落 / 用户态空表不兜底）；正常路径下为 `undefined`（零噪音）。 */
  warning?: string;
}

/**
 * 目录解析：**① 用户态优先 → ② 包内兜底 → ③ 空目录**（无控制台输出，纯报告，便于直接断言）。
 *
 *   ① `<usageRoot>/model-catalog.json`（`~/.vessel/…`，`VESSEL_USAGE_ROOT` 可覆盖）：
 *      `ok` / `empty` **命中即终结**（`empty` 也算命中，见 `readModelCatalogFile`）；
 *   ② 回落 `<configRoot>/configs/model-catalog.json`（包内 models.dev 快照）；
 *   ③ 两层都拿不到 → 空目录（**不抛错**：成本计算照常跑，价走 override/pricing.json/协议/兜底）。
 *
 * 用户态文件**损坏**时回落包内 + 一条 `warning`（不静默当空表：那会把目录价悄悄算丢）。
 * **无用户态文件时，返回值与「只有包内」的旧实现逐字相同**（`catalog` 就是包内读取结果）。
 */
export function loadModelCatalogDetailed(configRoot: string = process.cwd()): ModelCatalogLoad {
  const userFile = userModelCatalogPath();
  const userRead = readModelCatalogFile(userFile);
  if (userRead.status === 'ok' || userRead.status === 'empty') {
    const load: ModelCatalogLoad = { catalog: userRead.catalog, file: userFile, origin: 'user' };
    if (userRead.status === 'empty') {
      load.warning =
        `[vessel] 用户态模型目录为空：${userFile}\n` +
        `  文件里没有 models 数组（例如 {}），按**空目录**生效——不再回落包内内置目录。\n` +
        `  恢复内置目录：删除该文件；装回一份完整目录：vessel pricing sync。`;
    }
    return load;
  }
  const builtinFile = builtinModelCatalogPath(configRoot);
  const builtinRead = readModelCatalogFile(builtinFile);
  if (userRead.status === 'invalid') {
    return {
      catalog: builtinRead.catalog,
      file: builtinFile,
      origin: 'builtin',
      warning:
        `[vessel] 用户态模型目录不可用，已回落包内内置目录：${userFile}\n` +
        `  原因：${userRead.error ?? '未知'}\n` +
        `  影响：本次按包内快照计价（可能不是最新价）；不静默当空表。\n` +
        `  修复：修正或删除该文件（vessel pricing sync 会重写它）。`,
    };
  }
  return { catalog: builtinRead.catalog, file: builtinFile, origin: 'builtin' };
}

/**
 * load configs/model-catalog.json 的兼容入口：**用户态优先 → 包内兜底**；
 * 两层都缺失/损坏 → 空目录（不抛错）。用户态有问题时打一条 warn（只提示，不改退出码）。
 */
export function loadModelCatalog(configRoot = process.cwd()): ModelCatalog {
  const load = loadModelCatalogDetailed(configRoot);
  if (load.warning !== undefined) console.warn(load.warning);
  return load.catalog;
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
