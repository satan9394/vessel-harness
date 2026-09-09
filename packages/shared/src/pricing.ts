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
  /**
   * cache **写入**单价（Anthropic `cache_creation_input_tokens`），每 1M tokens。
   *
   * task 090：Anthropic 的 cache write 价通常比 cache read 贵一个量级
   * （如 Sonnet 4.5：read $0.30 / write $3.75），只按 read 计价会低估成本。
   * 缺省时按 `resolveCacheWritePrice` 推导（见下）。
   */
  cacheWrite?: number;
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
 *  - `override` 命中用户覆盖文件 `~/.vessel/pricing.override.json`（092；真实价目，用户显式设置）
 *  - `model`    命中 pricing.json 的模型级价（真实价目）
 *  - `catalog`  命中 model-catalog.json（models.dev 快照）价（真实价目）
 *  - `protocol` 命中协议级价（真实配置，但非模型级精确价）
 *  - `default`  落到通用兜底价 —— 这是**估算**（estimated=true）
 *  - `unpriced` `--strict` 下未收录（或命中删除墓碑）→ 按 0 计价（不估算、不猜）
 */
export type PriceSource = 'override' | 'model' | 'catalog' | 'protocol' | 'default' | 'unpriced';

/**
 * 一次查价的完整结果：价格 + 来源 + 是否估算（086 显式化）。
 *
 * `estimated` 的含义是「这个价不是该模型的专属价目」：
 *   - `override` 命中 → 用户显式设置的该模型价 → estimated=false
 *   - `model` / `catalog` 命中 → 该模型的价，estimated=false
 *   - `protocol` 命中 → 只是该线协议的通用价（同协议所有未收录模型同价）→ estimated=true
 *   - `default` 命中 → 通用兜底价 → estimated=true
 *   - `unpriced`（strict 未收录 / 命中删除墓碑）→ 没有价，按 0 记 → estimated=false
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
  /**
   * true = 命中用户**删除墓碑**（092）：该模型被显式删除，按 0 计价且不再回退内置/目录。
   * 此时 `source='unpriced'`（没有价），`matchedKey` 是墓碑键。
   */
  deletedByOverride?: boolean;
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
  /**
   * 显式指定候选队列（缺省 = `modelNameCandidates(model)`）。
   *
   * 092 用它给候选加 provider 作用域前缀（`provider::model`），从而复用同一套
   * 归一 + 精确/前缀匹配规则，不必在覆盖层再写第二套匹配实现。
   */
  candidates?: readonly string[];
}

/** 通用兜底价（configs/pricing.json 的 models.default 缺省值）。 */
export const DEFAULT_TOKEN_PRICE: TokenPrice = Object.freeze({ input: 0.5, output: 1.5, cacheRead: 0.1 });

/** `--strict` 未收录模型时的零价（标 0，而不是猜一个默认价）。 */
export const ZERO_TOKEN_PRICE: TokenPrice = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * cache 写入单价缺失时的推导倍率（task 090）。
 *
 * Anthropic 的 5 分钟缓存写入价 = 基础 input 价 × 1.25（read 价 = input × 0.1）。
 * 只有当价目行**完全没有** `cacheWrite` 字段时才启用；一旦价目里显式写了
 * （哪怕写 0，表示该家不单独收写入费），就按显式值算，不做推导。
 */
export const CACHE_WRITE_INPUT_MULTIPLIER = 1.25;

/**
 * cache 写入单价的来源（task 090，与 085 的 source/estimated 同一套「不猜价」纪律）：
 *  - `explicit` 价目行显式给了 `cacheWrite`（真实价目）
 *  - `derived`  价目行没给，但行内带 cache 语义（有 `cacheRead`）→ 按 `input × 1.25` 推导
 *  - `absent`   价目行连 cache 语义都没有（无 `cacheRead`）→ 视为不单独收 cache 费，记 0
 */
export type CacheWritePriceSource = 'explicit' | 'derived' | 'absent';

/**
 * 解析「每 1M tokens 的 cache 写入单价」。
 *
 * 回退链（只在缺字段时生效，绝不动显式值）：
 *   `cacheWrite` 显式 > `input × 1.25`（行内有 `cacheRead` 时）> 0
 *
 * 为什么用 `input × 1.25` 而不是 `cacheRead × 倍率`：cache 写入是「把新前缀写进
 * 缓存」，与基础 input 价挂钩（Anthropic 5m TTL 即 1.25×），而 read 价各家折扣
 * 差异极大（0.1× ~ 0.5× input），拿它推导会让写入价随折扣乱跳。
 * 且该回退**只对确实上报了 cache 写入 token 的调用生效**（实践中即 Anthropic 系
 * 缓存），不会给不写缓存的供应商凭空加钱。
 */
export function resolveCacheWritePrice(price: TokenPrice): { unitPrice: number; source: CacheWritePriceSource } {
  if (price.cacheWrite !== undefined) return { unitPrice: price.cacheWrite, source: 'explicit' };
  if (price.cacheRead !== undefined) return { unitPrice: price.input * CACHE_WRITE_INPUT_MULTIPLIER, source: 'derived' };
  return { unitPrice: 0, source: 'absent' };
}

/** 一次调用的成本分项（USD）——与 cc-switch `CostBreakdown` 同构，但不抄实现。 */
export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  totalUsd: number;
  /** cache 写入单价的来源（explicit / derived / absent），审计用。 */
  cacheWritePriceSource: CacheWritePriceSource;
  /** true = 该次计算的 cache 写入价是推导出来的（非价目显式值）。 */
  cacheWriteDerived: boolean;
}

/** 一次调用上报的 token 数（cache 写入为 task 090 新增）。 */
export interface UsageTokens {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * 四项分算成本（task 090）：input / output / cacheRead / cacheWrite 各自
 * `tokens × 单价 / 1_000_000`，`totalUsd` 是四项之和。
 *
 * 注意：`cacheCreationTokens` 是**独立**的一项，不从 inputTokens 里扣减——
 * 上报侧（`input_token_semantics`）尚未归一，扣减会让口径更乱；等有归一语义
 * 再在数据层处理（见 docs/PRICING.md §9）。
 */
export function costBreakdown(price: TokenPrice, tokens: UsageTokens): CostBreakdown {
  const input = tokens.inputTokens ?? 0;
  const output = tokens.outputTokens ?? 0;
  const cacheRead = tokens.cacheReadTokens ?? 0;
  const cacheWrite = tokens.cacheCreationTokens ?? 0;
  const write = resolveCacheWritePrice(price);
  const inputUsd = (input / 1_000_000) * price.input;
  const outputUsd = (output / 1_000_000) * price.output;
  const cacheReadUsd = (cacheRead / 1_000_000) * (price.cacheRead ?? 0);
  const cacheWriteUsd = (cacheWrite / 1_000_000) * write.unitPrice;
  return {
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheWriteUsd,
    totalUsd: inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd,
    cacheWritePriceSource: write.source,
    cacheWriteDerived: write.source === 'derived',
  };
}

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
  /**
   * 用户覆盖价源（092）。**优先级最高**：命中即用，不再看内置表 / 目录 / 协议 / 兜底。
   *
   * 覆盖是「用户对该模型的专属价」，因此 `strict` 下同样生效（strict 只禁用
   * protocol 通用价与 default 兜底价）。
   */
  override?: OverridePriceSource;
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

  const candidates = opts.candidates ?? modelNameCandidates(model);
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
 * 用户价目覆盖的数据形状（092）——`~/.vessel/pricing.override.json` 的解析结果。
 *
 * 关键设计（学 cc-switch「覆盖文件与内置表分离」的思路，实现为本仓库自有代码）：
 * 该文件**只存用户覆盖 + 删除墓碑**，内置 `configs/pricing.json` 仍由版本维护；
 * 于是「内置更新」与「用户手改」互不覆盖，两边都可 diff / 可回滚。
 */
export interface PricingOverrideData {
  /**
   * 覆盖单价。键支持两种格式（同一模型同时存在时 **`provider::model` 胜**）：
   *   - `model`           —— 对所有 provider 生效
   *   - `provider::model` —— 只对该 provider 生效（与 usage.json 的条目键同格式）
   * 键同样走模型名归一（大小写/命名空间/日期/effort 后缀/点号）。
   */
  models?: Record<string, TokenPrice>;
  /**
   * 删除墓碑：显式删除的内置条目键（两种键格式同上）。
   * 命中即按 0 计价（`source='unpriced'` + `deletedByOverride`），**不回退**目录/协议/兜底。
   * 只做精确匹配（归一后精确），不会因墓碑 `gpt-4o` 而误杀 `gpt-4o-mini`。
   */
  deleted?: readonly string[];
}

/** 一次覆盖命中的结果（与 `CatalogPriceMatch` 同构，多一个 provider 作用域标记）。 */
export interface OverridePriceMatch {
  price: TokenPrice;
  key: string;
  candidate: string;
  exact: boolean;
  /** true = 命中的是 `provider::model` 作用域键。 */
  scoped: boolean;
}

/** 覆盖价源（喂给 `resolvePrice(..., { override })`）。 */
export interface OverridePriceSource {
  /** 命中覆盖单价（未命中返回 undefined）。 */
  findMatch?(model: string, provider?: string): OverridePriceMatch | undefined;
  /** 命中删除墓碑时返回墓碑键（未命中返回 undefined）。 */
  findDeleted?(model: string, provider?: string): string | undefined;
}

/**
 * 覆盖查价用的候选队列：每个归一候选都先试 `provider::候选`、再试 `候选`。
 *
 * 顺序即优先级——**provider 作用域键排在前面**，所以同一模型同时有
 * `deepseek::deepseek-chat` 与 `deepseek-chat` 两个覆盖键时，前者胜。
 */
export function overrideModelCandidates(model: string, provider?: string): string[] {
  const base = modelNameCandidates(model);
  if (provider === undefined || provider === '') return base;
  const out: string[] = [];
  for (const candidate of base) {
    out.push(`${provider}::${candidate}`);
    out.push(candidate);
  }
  return out;
}

function finitePrice(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 把覆盖文件数据适配成 `OverridePriceSource`（纯函数、零 I/O；读盘由调用方负责）。
 *
 * 非法行（缺 input/output、非数字、负价）**直接忽略**——不猜价，也不让一条坏行
 * 污染整张覆盖表（与「查不到就明说是估算」同一纪律）。
 */
export function createOverridePriceSource(data: PricingOverrideData): OverridePriceSource {
  const entries: [string, TokenPrice][] = [];
  for (const [key, raw] of Object.entries(data.models ?? {})) {
    if (key.trim() === '' || raw === null || typeof raw !== 'object') continue;
    const input = finitePrice(raw.input);
    const output = finitePrice(raw.output);
    if (input === undefined || output === undefined || input < 0 || output < 0) continue;
    const price: TokenPrice = { input, output };
    const cacheRead = finitePrice(raw.cacheRead);
    const cacheWrite = finitePrice(raw.cacheWrite);
    if (cacheRead !== undefined && cacheRead >= 0) price.cacheRead = cacheRead;
    if (cacheWrite !== undefined && cacheWrite >= 0) price.cacheWrite = cacheWrite;
    entries.push([key, price]);
  }
  const deleted = (data.deleted ?? []).filter((key): key is string => typeof key === 'string' && key.trim() !== '');
  return {
    findMatch(model: string, provider?: string): OverridePriceMatch | undefined {
      const candidates = overrideModelCandidates(model, provider);
      const hit = matchModelName(model, entries, ([key]) => key, { candidates });
      if (!hit) return undefined;
      return {
        price: hit.entry[1],
        key: hit.key,
        candidate: hit.candidate,
        exact: hit.exact,
        scoped: hit.key.includes('::'),
      };
    },
    findDeleted(model: string, provider?: string): string | undefined {
      const candidates = overrideModelCandidates(model, provider);
      // 墓碑只做精确匹配：删除的是「这一个键」，不该靠家族前缀连坐。
      return matchModelName(model, deleted, (key) => key, { candidates, exactOnly: true })?.key;
    },
  };
}

/**
 * 解析每 1M tokens 单价，回退链：
 *   **override（092）** > pricing.json models[model]（含归一）> catalog > protocols[protocol] > default。
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
 *
 * 第三参 `protocol` 同时充当「provider 名」——它既用于 protocol 级回退，也用于
 * 覆盖键 `provider::model` 的作用域匹配（CLI 传的就是 provider id）。
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

  // ---- 阶段 0：用户覆盖（092，优先级最高）----
  // 覆盖命中即终结：既不看内置表，也不看目录/协议/兜底——用户显式设的价就是最终价。
  const overrideMatch = options.override?.findMatch?.(model, protocol);
  if (overrideMatch) {
    return {
      price: overrideMatch.price,
      source: 'override',
      estimated: false,
      matchedKey: overrideMatch.key,
      matchedCandidate: overrideMatch.candidate,
    };
  }
  // 删除墓碑：显式删除的内置条目 → 按 0 计价，且**不回退**（否则「删了还在算钱」）。
  const tombstone = options.override?.findDeleted?.(model, protocol);
  if (tombstone !== undefined) {
    return {
      price: ZERO_TOKEN_PRICE,
      source: 'unpriced',
      estimated: false,
      matchedKey: tombstone,
      deletedByOverride: true,
    };
  }

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

/**
 * 按一次调用的 token 数算成本（USD）——四项之和，实现即 `costBreakdown().totalUsd`。
 * 需要分项（input/output/cacheRead/cacheWrite）时用 `costBreakdown`。
 */
export function costOf(price: TokenPrice, tokens: UsageTokens): number {
  return costBreakdown(price, tokens).totalUsd;
}
