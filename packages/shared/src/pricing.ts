/**
 * packages/shared/pricing — 模型名归一 + 价格解析（task 085/086/087）。
 *
 * 单一价源（single source of truth）：本文件是**唯一**的模型名归一与查价实现，
 * CLI（apps/cli/src/providers/pricing.ts）、application（UsageProjection）、
 * benchmarks（runners/adapters）全部复用它，禁止在别处再写一套。
 *
 * 纯函数、零 I/O（不 import node:fs）——读盘由各层自己的 loader 负责，这样
 * shared 仍可被打包进浏览器侧。
 *
 * 归一规则（学 cc-switch 的 candidates 思路，实现为本仓库自有代码）：
 *   1. 大小写不敏感（原样 → 小写）
 *   2. 去命名空间前缀（`openrouter/anthropic/claude-...` → `claude-...`，可多级）
 *   3. Claude 点号→横线（`claude-3.5-sonnet` → `claude-3-5-sonnet`）
 *   4. 去日期后缀（`-20241022` / `-2025-08-07` / `@20241022`）
 *   5. 去 reasoning effort 后缀（`-high` / `-medium` / `-low` / `-minimal` /
 *      `-thinking` / `-reasoning` …）
 * 候选按「变换次数最少优先」BFS 生成，先精确匹配、再家族前缀匹配。
 */

/** 每 1M tokens 的 USD 单价。 */
export interface TokenPrice {
  input: number;
  output: number;
  cacheRead?: number;
}

/**
 * 价目表形状 = configs/pricing.json 的 `models` + `protocols`。
 * `models.default` 是通用兜底行（缺价时使用，见 `resolvePrice`）。
 */
export interface PricingTable {
  models: Record<string, TokenPrice>;
  protocols: Record<string, TokenPrice>;
}

/**
 * 价格来源：
 *  - `model`    命中 pricing.json 的模型级价（真实价目）
 *  - `catalog`  命中 model-catalog.json（models.dev 快照）价（真实价目）
 *  - `protocol` 命中协议级价（真实配置，但非模型级精确价）
 *  - `default`  落到通用兜底价 —— 这是**估算**（estimated=true）
 *  - `unpriced` `--strict` 下未收录 → 按 0 计价（不估算、不猜）
 */
export type PriceSource = 'model' | 'catalog' | 'protocol' | 'default' | 'unpriced';

/**
 * 一次查价的完整结果：价格 + 来源 + 是否估算（086 显式化）。
 *
 * `estimated` 的含义是「这个价不是该模型的专属价目」：
 *   - `model` / `catalog` 命中 → 该模型的价，estimated=false
 *   - `protocol` 命中 → 只是该线协议的通用价（同协议所有未收录模型同价）→ estimated=true
 *   - `default` 命中 → 通用兜底价 → estimated=true
 *   - `unpriced`（strict 未收录）→ 没有价，按 0 记 → estimated=false
 */
export interface PriceResolution {
  price: TokenPrice;
  source: PriceSource;
  /** true = 价格不是该模型的专属价目（protocol 级通用价或 default 兜底价）。 */
  estimated: boolean;
  /** 命中的表键 / 协议名（审计用，便于解释「这个价从哪来」）。 */
  matchedKey?: string;
  /** 命中时所用的归一候选名（审计用；与原始 model 不同即说明发生了归一）。 */
  matchedCandidate?: string;
}

/** 目录价源（configs/model-catalog.json 适配出的查价接口）。 */
export interface CatalogPriceMatch {
  price: TokenPrice;
  key: string;
  candidate: string;
  /** true = 精确命中；false = 家族前缀命中。 */
  exact: boolean;
}

export interface CatalogPriceSource {
  findPrice(model: string): TokenPrice | undefined;
  /** 可选：带审计信息的命中（`createCatalogPriceSource` 会实现）。 */
  findMatch?(model: string, opts?: MatchModelNameOptions): CatalogPriceMatch | undefined;
}

/** 一次模型名匹配的结果（精确 / 家族前缀）。 */
export interface ModelMatch<T> {
  entry: T;
  /** 被命中的条目标识（原样大小写）。 */
  key: string;
  /** 命中时所用的归一候选名。 */
  candidate: string;
  /** true = 精确命中；false = 家族前缀命中（如 `gpt-5.1-codex` → `gpt-5.1`）。 */
  exact: boolean;
}

export interface MatchModelNameOptions {
  /** 只做精确匹配（用于「精确优先于任何前缀」的两阶段查价）。 */
  exactOnly?: boolean;
}

/** 通用兜底价（configs/pricing.json 的 models.default 缺省值）。 */
export const DEFAULT_TOKEN_PRICE: TokenPrice = Object.freeze({ input: 0.5, output: 1.5, cacheRead: 0.1 });

/** `--strict` 未收录模型时的零价（标 0，而不是猜一个默认价）。 */
export const ZERO_TOKEN_PRICE: TokenPrice = Object.freeze({ input: 0, output: 0, cacheRead: 0 });

/** 空价目表（无模型、无协议价，只有兜底 default）。 */
export const EMPTY_PRICING_TABLE: PricingTable = Object.freeze({ models: {}, protocols: {} });

/**
 * `--strict`：只用模型专属价目（model / catalog）。
 *
 * 未命中就返回 `source:'unpriced'` + 零价——protocol 级通用价与 default 兜底价
 * 都是「不是这个模型的价」，strict 下一并禁用，否则协议兜底会让 strict 变成空转。
 */
export interface ResolvePriceOptions {
  strict?: boolean;
}

/** reasoning effort / 推理档位后缀（去后缀后仍能落回基础模型名）。 */
const EFFORT_SUFFIXES = [
  'non-thinking',
  'xhigh',
  'minimal',
  'thinking',
  'reasoning',
  'instant',
  'medium',
  'high',
  'low',
  'none',
];

/** 日期后缀：`-20241022` / `-2025-08-07` / `.20241022` / `@20241022`。 */
const DATE_SUFFIX = /(?:[-_.]?(?:19|20)\d{6})|(?:[-_.]?(?:19|20)\d{2}-\d{2}-\d{2})|(?:@\d{8})$/;

/** 归一后的键（大小写不敏感比较用）。 */
export function normalizeModelKey(model: string): string {
  return model.trim().toLowerCase();
}

type Transform = (value: string) => string | undefined;

/** 去一级命名空间前缀（`a/b/c` → `b/c`）；无前缀则返回 undefined。 */
function stripNamespacePrefix(value: string): string | undefined {
  const slash = value.indexOf('/');
  if (slash < 0) return undefined;
  const rest = value.slice(slash + 1);
  return rest.length > 0 ? rest : undefined;
}

/** Claude 点号 → 横线（`claude-3.5-sonnet` → `claude-3-5-sonnet`）。 */
function dotsToDashes(value: string): string | undefined {
  if (!value.includes('.')) return undefined;
  return value.replace(/\./g, '-');
}

/** 去日期后缀；无日期后缀则返回 undefined。 */
function stripDateSuffix(value: string): string | undefined {
  const m = value.match(DATE_SUFFIX);
  if (!m) return undefined;
  const rest = value.slice(0, value.length - m[0].length);
  return rest.length > 0 ? rest : undefined;
}

/** 去 reasoning effort 后缀；无该后缀则返回 undefined。 */
function stripEffortSuffix(value: string): string | undefined {
  for (const effort of EFFORT_SUFFIXES) {
    for (const sep of ['-', '.', '_', '@']) {
      const suffix = sep + effort;
      if (value.length > suffix.length && value.endsWith(suffix)) {
        return value.slice(0, value.length - suffix.length);
      }
    }
  }
  return undefined;
}

const TRANSFORMS: readonly Transform[] = [
  (v) => (v === v.toLowerCase() ? undefined : v.toLowerCase()),
  stripNamespacePrefix,
  dotsToDashes,
  stripDateSuffix,
  stripEffortSuffix,
];

/**
 * 模型名归一候选队列（按变换次数最少优先，去重）。
 *
 * 例：`OpenRouter/anthropic/claude-3.5-sonnet-20241022` →
 *   `OpenRouter/anthropic/claude-3.5-sonnet-20241022`（原样）
 *   `openrouter/anthropic/claude-3.5-sonnet-20241022`（小写）
 *   `anthropic/claude-3.5-sonnet-20241022`（去一级命名空间）
 *   `OpenRouter/anthropic/claude-3-5-sonnet-20241022`（点号→横线）
 *   `OpenRouter/anthropic/claude-3.5-sonnet`（去日期后缀）
 *   …
 *   `claude-3-5-sonnet`（全部变换叠加后）
 */
export function modelNameCandidates(model: string): string[] {
  const start = model.trim();
  if (start === '') return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    if (value !== '' && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  };
  push(start);
  let frontier: string[] = [start];
  // 每轮对当前层的每个候选应用一次变换；去重后作为下一层。
  for (let depth = 0; depth < 6 && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const value of frontier) {
      for (const transform of TRANSFORMS) {
        const result = transform(value);
        if (result !== undefined && result !== '' && !seen.has(result)) {
          seen.add(result);
          out.push(result);
          next.push(result);
        }
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * 家族前缀匹配：`key` 是 `candidate` 的严格前缀且边界为分隔符
 * （`gpt-5.1` 命中 `gpt-5.1-codex`，但 `gpt-5` 不会命中 `gpt-5x`）。
 */
export function isFamilyPrefix(candidate: string, key: string): boolean {
  const c = normalizeModelKey(candidate);
  const k = normalizeModelKey(key);
  if (k.length < 3 || c.length <= k.length) return false;
  if (!c.startsWith(k)) return false;
  const boundary = c[k.length];
  return boundary === '-' || boundary === '.' || boundary === '_' || boundary === '@' || boundary === ':';
}

/**
 * 用归一候选队列在 `entries` 里查条目（先精确、再家族前缀）。
 * 所有查价/查目录的地方都走这里，保证规则只有一份。
 */
export function matchModelName<T>(
  model: string,
  entries: readonly T[],
  idOf: (entry: T) => string,
  opts: MatchModelNameOptions = {},
): ModelMatch<T> | undefined {
  const index = new Map<string, { entry: T; key: string }>();
  for (const entry of entries) {
    const key = idOf(entry);
    const normalized = normalizeModelKey(key);
    if (normalized !== '' && !index.has(normalized)) index.set(normalized, { entry, key });
  }
  if (index.size === 0) return undefined;

  const candidates = modelNameCandidates(model);
  for (const candidate of candidates) {
    const hit = index.get(normalizeModelKey(candidate));
    if (hit) return { entry: hit.entry, key: hit.key, candidate, exact: true };
  }
  if (opts.exactOnly) return undefined;
  for (const candidate of candidates) {
    let best: { entry: T; key: string; normalized: string } | undefined;
    for (const [normalized, row] of index) {
      if (isFamilyPrefix(candidate, normalized) && (best === undefined || normalized.length > best.normalized.length)) {
        best = { entry: row.entry, key: row.key, normalized };
      }
    }
    if (best) return { entry: best.entry, key: best.key, candidate, exact: false };
  }
  return undefined;
}

/** 用同一套归一规则，把任意条目数组适配成 CatalogPriceSource。 */
export function createCatalogPriceSource<T>(
  entries: readonly T[],
  opts: { idOf: (entry: T) => string; priceOf: (entry: T) => TokenPrice | undefined },
): CatalogPriceSource {
  const findMatch = (model: string, matchOpts?: MatchModelNameOptions): CatalogPriceMatch | undefined => {
    const hit = matchModelName(model, entries, opts.idOf, matchOpts);
    if (!hit) return undefined;
    const price = opts.priceOf(hit.entry);
    return price ? { price, key: hit.key, candidate: hit.candidate, exact: hit.exact } : undefined;
  };
  return {
    findMatch,
    findPrice(model: string): TokenPrice | undefined {
      return findMatch(model)?.price;
    },
  };
}

/**
 * 解析每 1M tokens 单价，回退链：
 *   pricing.json models[model]（含归一）> catalog > protocols[protocol] > default。
 *
 * 匹配分两阶段，**任何精确命中都优先于任何家族前缀命中**：
 *   1) 精确：model 表 → catalog
 *   2) 家族前缀：model 表 / catalog 取「命中键最长」者
 * （否则 `gpt-4o-mini-2024-07-18` 会被 model 表的 `gpt-4o` 前缀抢走，
 * 而 catalog 里明明有精确的 `gpt-4o-mini`。）
 *
 * `default` 兜底时 `estimated=true`；`protocol` 级通用价同样 `estimated=true`
 * （086：只要不是该模型的专属价目，就必须显式标估算）；
 * `strict=true` 时只认模型专属价目（model/catalog），未收录返回 `source:'unpriced'` + 零价。
 */
export function resolvePrice(
  table: PricingTable,
  model: string,
  protocol?: string,
  catalog?: CatalogPriceSource,
  options: ResolvePriceOptions = {},
): PriceResolution {
  const rows = Object.entries(table.models).filter(([key]) => key !== 'default');
  const modelId = ([key]: [string, TokenPrice]): string => key;
  const modelResolution = (match: ModelMatch<[string, TokenPrice]>): PriceResolution => ({
    price: match.entry[1],
    source: 'model',
    estimated: false,
    matchedKey: match.key,
    matchedCandidate: match.candidate,
  });
  const catalogResolution = (match: CatalogPriceMatch): PriceResolution => ({
    price: match.price,
    source: 'catalog',
    estimated: false,
    matchedKey: match.key,
    matchedCandidate: match.candidate,
  });

  // ---- 阶段 1：精确匹配（model 表 > catalog）----
  const modelExact = matchModelName(model, rows, modelId, { exactOnly: true });
  if (modelExact) return modelResolution(modelExact);

  const catalogMatch = catalog?.findMatch?.(model);
  if (catalogMatch?.exact) return catalogResolution(catalogMatch);
  if (!catalog?.findMatch) {
    // 兼容只实现 findPrice 的自定义目录源（无精确/前缀信息）
    const byPrice = catalog?.findPrice(model);
    if (byPrice) return { price: byPrice, source: 'catalog', estimated: false };
  }

  // ---- 阶段 2：家族前缀匹配（取命中键最长者）----
  const modelPrefix = matchModelName(model, rows, modelId);
  const catalogPrefix = catalogMatch && !catalogMatch.exact ? catalogMatch : undefined;
  const modelKeyLength = modelPrefix ? normalizeModelKey(modelPrefix.key).length : -1;
  const catalogKeyLength = catalogPrefix ? normalizeModelKey(catalogPrefix.key).length : -1;
  if (modelPrefix && modelKeyLength >= catalogKeyLength) return modelResolution(modelPrefix);
  if (catalogPrefix) return catalogResolution(catalogPrefix);
  if (modelPrefix) return modelResolution(modelPrefix);

  // strict：只认模型专属价目（model / catalog），协议级与 default 兜底都不用。
  if (options.strict) return { price: ZERO_TOKEN_PRICE, source: 'unpriced', estimated: false };

  if (protocol !== undefined && protocol !== '') {
    const protocolKey = protocol === 'anthropic' ? 'anthropic' : 'openai-compatible';
    const byProtocol = table.protocols[protocol] ?? table.protocols[protocolKey];
    if (byProtocol) {
      return { price: byProtocol, source: 'protocol', estimated: true, matchedKey: protocol };
    }
  }

  const fallback = table.models['default'] ?? DEFAULT_TOKEN_PRICE;
  return { price: fallback, source: 'default', estimated: true, matchedKey: 'default' };
}

/** 按一次调用的 token 数算成本（USD）。 */
export function costOf(price: TokenPrice, tokens: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }): number {
  const input = tokens.inputTokens ?? 0;
  const output = tokens.outputTokens ?? 0;
  const cache = tokens.cacheReadTokens ?? 0;
  return (input / 1_000_000) * price.input + (output / 1_000_000) * price.output + (cache / 1_000_000) * (price.cacheRead ?? 0);
}
