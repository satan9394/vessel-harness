import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renameWithRetry } from '@vessel/shared';
import {
  costBreakdown,
  resolvePrice,
  DEFAULT_COST_MULTIPLIER,
  type CacheWritePriceSource,
  type CatalogPriceSource,
  type CostBreakdown,
  type OverridePriceSource,
  type PriceResolution,
  type PriceSource,
  type PricingTable,
  type TokenPrice,
  type UsageTokens,
} from '../providers/pricing.js';

/**
 * apps/cli/usage — UsageStore (V0.9, task 029 / 086 / 089 / 090): persistent usage statistics.
 *
 * Reference model: cc-switch usage tracking — 明细（recent ring）+ 按 model/provider
 * 的累计 + **按本地日的分桶**（task 089，学 cc-switch `usage_daily_rollups`
 * 「只纳入完整本地日」的口径，实现为本仓库自有代码），持久化到
 * `~/.vessel/usage.json`（原子 tmp+rename，同 ProviderStore）。
 *
 * 计价（task 086/087/090）：走 `@vessel/shared` 的 `resolvePrice` + `costBreakdown`
 * （与 UsageProjection / benchmarks 同一实现、同一回退链）。每条记录落
 * `estimated` / `pricingSource`：
 *   - source='protocol'/'default' → estimated=true（不是该模型的专属价目）
 *   - source='override'（092）→ 用户覆盖文件里的该模型专属价，estimated=false
 *   - 命中删除墓碑（092）→ `unpriced` + `deletedByOverride`，按 0 计价且不回退
 *   - strict 模式 → 只用 model/catalog/override，未收录模型标 `unpriced` + 0 成本
 *     （保留 token 计数待回填）
 *   - cache 写入（cache_creation）独立计价；价目缺 `cacheWrite` 时按
 *     `input × 1.25` 推导并标 `cacheWriteDerived`（见 docs/PRICING.md §7）
 *
 * 定价变更回填（task 091）：`recompute()` 按**当前**价目重算历史成本——
 * 保留 token 原始值，只重算 `costUsd` / `estimated` / `pricingSource` / 分项。
 * 幂等（同一价目连跑两次第二次零变更、不落盘）；`dryRun` 只出差异摘要。
 *
 * 成本倍率（task 094）：`multiplierOf(provider)` 给的 provider 级倍率**只乘总额**
 * （`costUsd = 分项合计 × 倍率`），分项单价与分项金额不变；条目上留
 * `costMultiplier` / `costMultiplierMixed` 痕迹，`byProvider()` / `totals()`
 * 同时给 `rawCostUsd`，于是「总额 = 分项合计 × 倍率」在 `vessel usage` 里可解释。
 *
 * 日口径（task 089）：分桶键是**本地日** `YYYY-MM-DD`（用本机时区，不是 UTC）。
 * 写入时按 `now()` 的本地日归档；查询时「完整本地日」= 已结束的本地日
 * （今天与未来日都不完整，单列 partial，不混进完整日合计）。
 * 091 起每个日分桶额外记录**按模型的子分项**（`models`），这样改价后日成本
 * 也能被精确重算（旧数据没有子分项 → 该日跳过，不猜）。
 */

/** 持久化的价格来源：查价来源 + `legacy`（085 之前写入、未记录来源的旧条目）。 */
export type UsagePricingSource = PriceSource | 'legacy' | 'mixed';

/** 一次调用/一条累计的成本分项（USD；task 090 起 cache 写入独立成项）。 */
export interface UsageCostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
}

export interface UsageEntry {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** cache 写入 token（Anthropic `cache_creation_input_tokens`；task 090） */
  cacheCreationTokens: number;
  calls: number;
  /** estimated cost in USD (per-entry = per batch of calls at this model) */
  costUsd: number;
  /** 成本分项累计（input/output/cacheRead/cacheWrite） */
  costBreakdown: UsageCostBreakdown;
  /** 其中「cache 写入价是推导来的」部分金额（缺 cacheWrite 字段时；task 090） */
  cacheWriteDerivedCostUsd: number;
  /** true = 该条目累计时曾用过推导的 cache 写入价 */
  cacheWriteDerived: boolean;
  /** true = 该条目含 default 兜底（估算）计价，成本不可当真实价目看 */
  estimated: boolean;
  /** 累计的「估算部分」金额（仅 estimated 命中累加） */
  estimatedCostUsd: number;
  /** 价格来源；一次条目内混合来源记 'mixed' */
  pricingSource: UsagePricingSource;
  /** last recorded timestamp (ISO) */
  lastTs: string;
  /** count of recording events merged into this entry */
  events: number;
  /** 最近一次 `recompute` 实际改价的 ISO 时间（091；无变更时不写，保证幂等） */
  recomputedAt?: string;
  /** true = 该条目曾是 085 之前的无来源记录，已被 `recompute` 按当前规则重算并标注（091） */
  recomputedFromLegacy?: boolean;
  /**
   * 该条目累计时用的 provider 成本倍率（094）。缺省 1 时不写字段。
   *
   * 只在该条目**历次记录的倍率一致**时存在；倍率变过（同一 provider 中途改倍率）
   * 则置 `costMultiplierMixed: true` 并省略本字段——不假装有个「唯一倍率」。
   */
  costMultiplier?: number;
  /** true = 该条目历次记录的倍率不一致（见上）。 */
  costMultiplierMixed?: boolean;
}

export interface UsageRecentEntry {
  ts: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  estimated: boolean;
  pricingSource: UsagePricingSource;
}

/**
 * 一个本地日分桶里的**单个模型**子分项（task 091）。
 *
 * 为什么要它：日分桶原本只有跨模型的总量，改价后无法按模型价重算（会猜）。
 * 091 起写入时同时记子分项，于是 `recompute` 能对「有子分项的日子」做精确重算；
 * 旧数据（无 `models`）该日跳过并计数，不伪造。
 */
export interface UsageDailyModelBucket {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  calls: number;
  estimatedCostUsd: number;
  cacheWriteDerivedCostUsd: number;
}

/**
 * 一个**本地日**的分桶（task 089）。
 * 键是 `YYYY-MM-DD`（本机时区），只累计当天记录，不做历史回填/伪造。
 */
export interface UsageDailyBucket {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  calls: number;
  /** 当日金额中的估算部分（default/protocol 兜底） */
  estimatedCostUsd: number;
  /** 当日金额中 cache 写入用推导价的部分 */
  cacheWriteDerivedCostUsd: number;
  /** 当日首/末一条记录时间（ISO） */
  firstTs: string;
  lastTs: string;
  /** 按模型的当日子分项（091 起记录；旧数据无此字段 → 该日无法精确重算） */
  models?: Record<string, UsageDailyModelBucket>;
}

/** 查询返回的一行：分桶 + 本地日键 + 「是否完整本地日」。 */
export interface UsageDailyRow extends UsageDailyBucket {
  /** 本地日 `YYYY-MM-DD` */
  date: string;
  /** true = 该本地日已完整结束（今天与未来日 = false） */
  complete: boolean;
}

/** 窗口合计（用于完整日 / 未完整日两组分别汇总）。 */
export interface UsageDailyTotals {
  days: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  calls: number;
  estimatedCostUsd: number;
  cacheWriteDerivedCostUsd: number;
}

export interface UsageDailySummary {
  /** 窗口内的全部本地日行（升序） */
  rows: UsageDailyRow[];
  /** 只含**完整本地日**的合计（cc-switch 口径：不完整的当天不混入） */
  complete: UsageDailyTotals;
  /** 未完整本地日（今天/未来）的合计，单独列出 */
  partial: UsageDailyTotals;
  /** 窗口内是否存在未完整本地日 */
  hasPartial: boolean;
}

export interface UsageDailyQuery {
  /** 起始本地日 `YYYY-MM-DD`（含） */
  since?: string;
  /** 结束本地日 `YYYY-MM-DD`（含） */
  until?: string;
}

export interface UsageFile {
  /** 2 = 带 daily 分桶（089）；1 = 旧格式（无 daily，读入后按 legacy 累计处理） */
  version: 2;
  entries: Record<string, UsageEntry>; // key = `${provider}::${model}`
  recent: UsageRecentEntry[];
  /** 本地日分桶 `YYYY-MM-DD` → 当日累计 */
  daily: Record<string, UsageDailyBucket>;
}

export interface UsageStoreOptions {
  rootDir?: string;
  /** pricing table used for cost estimation (tests inject a fixed one) */
  pricing?: PricingTable;
  /** catalog price source (model-catalog.json) — second link of the fallback chain */
  catalog?: CatalogPriceSource;
  /** 用户覆盖价源（092，`~/.vessel/pricing.override.json`）——优先级最高 */
  override?: OverridePriceSource;
  /**
   * provider 成本倍率解析（094）：provider id → 倍率（缺省 1）。
   *
   * **只乘总额**（`costUsd = 分项合计 × 倍率`），分项单价与分项金额不变。
   * 返回非法值（负数/NaN/非数字）抛错（fail loud，见 `costBreakdown`）。
   */
  multiplierOf?: (provider: string) => number;
  /** strict mode: 只用模型专属价目（model/catalog/override），未收录模型按 0 计价（标 `unpriced`） */
  strict?: boolean;
  /** cap for the recent-entries ring buffer */
  recentCap?: number;
  /** 时钟（测试注入以模拟跨日/日边界；默认 `new Date()`，本地时区） */
  now?: () => Date;
}

export interface UsageRecordResult {
  costUsd: number;
  source: PriceSource;
  estimated: boolean;
  /** 本次记录的成本分项（含 cache 写入） */
  breakdown: CostBreakdown;
  /** cache 写入单价来源：explicit（价目显式）/ derived（input×1.25 推导）/ absent（不单独收） */
  cacheWritePriceSource: CacheWritePriceSource;
  /** 本次记录归档到的本地日 */
  date: string;
}

/** `recompute` 的选项（091）。 */
export interface UsageRecomputeOptions {
  /** true = 只算差异、不落盘 */
  dryRun?: boolean;
  /** 起始本地日 `YYYY-MM-DD`（含） */
  since?: string;
  /** 结束本地日 `YYYY-MM-DD`（含） */
  until?: string;
}

/** 一条被重算影响的记录（条目 / 日分桶 / 明细）。 */
export interface UsageRecomputeChange {
  scope: 'entry' | 'daily' | 'recent';
  /** 条目键 `provider::model` / 本地日 / 明细时间戳 */
  key: string;
  beforeUsd: number;
  afterUsd: number;
  deltaUsd: number;
  /** 仅条目有来源；日分桶 / 明细按模型聚合，无单一来源 */
  beforeSource?: UsagePricingSource;
  afterSource?: UsagePricingSource;
  /** true = 该条原本是无来源的 legacy 记录，本次按当前规则重算并标注 */
  legacyRecomputed?: boolean;
}

/** 一个范围的汇总（扫描数 / 受影响数 / 金额前后）。 */
export interface UsageRecomputeScopeSummary {
  scanned: number;
  changed: number;
  beforeUsd: number;
  afterUsd: number;
  deltaUsd: number;
}

export interface UsageRecomputeResult {
  dryRun: boolean;
  since?: string;
  until?: string;
  /** 累计条目（权威成本口径；窗口按条目 lastTs 的本地日筛选） */
  entries: UsageRecomputeScopeSummary;
  /** 本地日分桶（窗口按日期键筛选） */
  daily: UsageRecomputeScopeSummary;
  /** 最近明细环形缓冲（窗口按 ts 的本地日筛选） */
  recent: UsageRecomputeScopeSummary;
  /** 无按模型子分项、无法精确重算而被跳过的日分桶数（089 之前的旧数据） */
  dailySkipped: number;
  /** 从 legacy（无来源）重算并标注的条目数 */
  legacyRecomputed: number;
  /** 三范围合计的受影响记录数 */
  changed: number;
  /** 是否真的落盘（dry-run 或零变更 → false） */
  written: boolean;
  /** 变更明细（按扫描顺序；CLI 自行截断展示） */
  changes: UsageRecomputeChange[];
}

/** 金额比较容差：重算是「累计 token 一次算」而写入是「逐次累加」，浮点尾差必须忽略。 */
const MONEY_EPSILON = 1e-9;

function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) <= MONEY_EPSILON;
}

/** 本地日键 `YYYY-MM-DD`（本机时区；不是 UTC——089 口径与 cc-switch 一致）。 */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 校验 `YYYY-MM-DD` 且是真实存在的日期（拒绝 `2026-02-30`）。 */
export function isLocalDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map((s) => Number(s));
  if (y === undefined || m === undefined || d === undefined) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

function emptyBreakdown(): UsageCostBreakdown {
  return { inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0 };
}

function addBreakdown(into: UsageCostBreakdown, add: UsageCostBreakdown): void {
  into.inputUsd += add.inputUsd;
  into.outputUsd += add.outputUsd;
  into.cacheReadUsd += add.cacheReadUsd;
  into.cacheWriteUsd += add.cacheWriteUsd;
}

function emptyBucket(): UsageDailyBucket {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    calls: 0,
    estimatedCostUsd: 0,
    cacheWriteDerivedCostUsd: 0,
    firstTs: '',
    lastTs: '',
  };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function defaultUsageRoot(home = os.homedir()): string {
  return path.join(home, '.vessel');
}

/** 生效的 usage 根目录（`VESSEL_USAGE_ROOT` 覆盖；覆盖价目文件与 usage.json 同根）。 */
export function resolveUsageRoot(): string {
  return process.env.VESSEL_USAGE_ROOT ?? defaultUsageRoot();
}

/** 从 ISO 时间戳取本地日键（非法/缺失 → undefined）。 */
function localDateOfTs(ts: string | undefined): string | undefined {
  if (typeof ts !== 'string' || ts === '') return undefined;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return undefined;
  return localDateKey(d);
}

/** `provider::model` 键 → { provider, model }（无分隔符时 provider 为空串）。 */
function splitEntryKey(key: string): { provider: string; model: string } {
  const at = key.indexOf('::');
  if (at < 0) return { provider: '', model: key };
  return { provider: key.slice(0, at), model: key.slice(at + 2) };
}

/**
 * UsageStore — 落盘用量与成本。
 * 成本公式用 `@vessel/shared` 的 `costBreakdown`（唯一实现，勿再复制）。
 */
export class UsageStore {
  readonly rootDir: string;
  private readonly file: string;
  private readonly pricing: PricingTable;
  private readonly catalog: CatalogPriceSource | undefined;
  private readonly override: OverridePriceSource | undefined;
  private readonly strict: boolean;
  private readonly recentCap: number;
  private readonly clock: () => Date;
  private readonly multiplierOf: (provider: string) => number;
  private data: UsageFile;
  /** 读入的旧文件没有 daily 字段（089 之前的累计）：历史只保留累计，不伪造分桶 */
  private readonly legacyFile: boolean;

  constructor(opts: UsageStoreOptions = {}) {
    this.rootDir = opts.rootDir ?? resolveUsageRoot();
    this.file = path.join(this.rootDir, 'usage.json');
    this.pricing = opts.pricing ?? { models: {}, protocols: {} };
    this.catalog = opts.catalog;
    this.override = opts.override;
    this.strict = opts.strict ?? false;
    this.recentCap = opts.recentCap ?? 200;
    this.clock = opts.now ?? (() => new Date());
    this.multiplierOf = opts.multiplierOf ?? (() => DEFAULT_COST_MULTIPLIER);
    const loaded = this.load();
    this.data = loaded.file;
    this.legacyFile = loaded.legacy;
  }

  /** 唯一的查价入口：回退链 override > model > catalog > protocol > default（086/092）。 */
  private resolve(model: string, provider: string, strict = this.strict): PriceResolution {
    return resolvePrice(this.pricing, model, provider, this.catalog, { strict, override: this.override });
  }

  /**
   * 唯一的计价入口（090/094）：分项单价算四项，provider 倍率**只乘总额**。
   *
   * 倍率来自 `multiplierOf(provider)`（094；缺省 1）；非法值在 `costBreakdown`
   * 内抛 `RangeError`（fail loud，不静默按 1 处理）。
   */
  private cost(price: TokenPrice, tokens: UsageTokens, provider: string): CostBreakdown {
    return costBreakdown(price, tokens, { costMultiplier: this.multiplierOf(provider) });
  }

  /** 分项合计（未乘倍率）——用于解释「总额 = 分项合计 × 倍率」（094）。 */
  private static rawTotal(b: UsageCostBreakdown | CostBreakdown | undefined): number {
    if (!b) return 0;
    return b.inputUsd + b.outputUsd + b.cacheReadUsd + b.cacheWriteUsd;
  }

  private load(): { file: UsageFile; legacy: boolean } {
    const empty: UsageFile = { version: 2, entries: {}, recent: [], daily: {} };
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return { file: empty, legacy: false };
    }
    try {
      const parsed = JSON.parse(text) as Partial<UsageFile>;
      if (!parsed.entries || typeof parsed.entries !== 'object') return { file: empty, legacy: false };
      const entries: Record<string, UsageEntry> = {};
      for (const [key, raw] of Object.entries(parsed.entries)) {
        // 085 之前的旧条目没有 estimated/pricingSource：标 'legacy'（来源未知），
        // 不臆造来源，也不谎称是真实价目。089 之前的旧条目没有 cacheCreationTokens /
        // costBreakdown：补 0（分项不可重建，展示层单列「历史条目无分项」）。
        entries[key] = {
          ...raw,
          cacheCreationTokens: num(raw.cacheCreationTokens),
          costBreakdown: raw.costBreakdown ?? emptyBreakdown(),
          cacheWriteDerivedCostUsd: num(raw.cacheWriteDerivedCostUsd),
          cacheWriteDerived: raw.cacheWriteDerived ?? false,
          estimated: raw.estimated ?? false,
          estimatedCostUsd: num(raw.estimatedCostUsd),
          pricingSource: raw.pricingSource ?? 'legacy',
        };
        // 094：倍率字段读盘容错——非法值丢弃（当作未记录），mixed 只认 true。
        const entry = entries[key]!;
        if (typeof entry.costMultiplier !== 'number' || !Number.isFinite(entry.costMultiplier) || entry.costMultiplier < 0) {
          delete entry.costMultiplier;
        }
        if (entry.costMultiplierMixed !== true) delete entry.costMultiplierMixed;
      }
      const recent: UsageRecentEntry[] = Array.isArray(parsed.recent)
        ? parsed.recent.map((r) => ({
            ...r,
            cacheCreationTokens: num(r.cacheCreationTokens),
            estimated: r.estimated ?? false,
            pricingSource: r.pricingSource ?? 'legacy',
          }))
        : [];
      // 旧文件（version 1 / 无 daily 字段）：**不伪造历史分桶**，daily 从空开始，
      // 历史只以 entries 的累计形式保留（见 docs/PRICING.md §8）。
      const daily: Record<string, UsageDailyBucket> = {};
      const rawDaily = parsed.daily as Record<string, UsageDailyBucket> | undefined;
      if (rawDaily && typeof rawDaily === 'object') {
        for (const [date, bucket] of Object.entries(rawDaily)) {
          if (!isLocalDateKey(date) || !bucket || typeof bucket !== 'object') continue;
          const models: Record<string, UsageDailyModelBucket> = {};
          const rawModels = (bucket as Partial<UsageDailyBucket>).models;
          if (rawModels && typeof rawModels === 'object') {
            for (const [mKey, mBucket] of Object.entries(rawModels)) {
              if (!mBucket || typeof mBucket !== 'object' || mKey.trim() === '') continue;
              models[mKey] = {
                inputTokens: num(mBucket.inputTokens),
                outputTokens: num(mBucket.outputTokens),
                cacheReadTokens: num(mBucket.cacheReadTokens),
                cacheCreationTokens: num(mBucket.cacheCreationTokens),
                costUsd: num(mBucket.costUsd),
                calls: num(mBucket.calls),
                estimatedCostUsd: num(mBucket.estimatedCostUsd),
                cacheWriteDerivedCostUsd: num(mBucket.cacheWriteDerivedCostUsd),
              };
            }
          }
          const parsedBucket: UsageDailyBucket = {
            inputTokens: num(bucket.inputTokens),
            outputTokens: num(bucket.outputTokens),
            cacheReadTokens: num(bucket.cacheReadTokens),
            cacheCreationTokens: num(bucket.cacheCreationTokens),
            costUsd: num(bucket.costUsd),
            calls: num(bucket.calls),
            estimatedCostUsd: num(bucket.estimatedCostUsd),
            cacheWriteDerivedCostUsd: num(bucket.cacheWriteDerivedCostUsd),
            firstTs: typeof bucket.firstTs === 'string' ? bucket.firstTs : '',
            lastTs: typeof bucket.lastTs === 'string' ? bucket.lastTs : '',
          };
          if (Object.keys(models).length > 0) parsedBucket.models = models;
          daily[date] = parsedBucket;
        }
      }
      const hasDailyField = rawDaily !== undefined && rawDaily !== null;
      const legacy = !hasDailyField && Object.keys(entries).length > 0;
      return { file: { version: 2, entries, recent, daily }, legacy };
    } catch {
      return { file: empty, legacy: false };
    }
  }

  private save(): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    // 原子写：tmp + rename。Windows 上杀软/索引器可能短暂锁住 tmp 或目标文件，
    // rename 偶发 EPERM/EBUSY——共享有界重试（task 113：3 次，5/15ms 退避，
    // 仅 EPERM/EBUSY/EACCES 重试），仍失败则抛出，不吞错、不改语义
    // （要么完整旧文件，要么完整新文件）。
    renameWithRetry(tmp, this.file);
  }

  private key(provider: string, model: string): string {
    return `${provider}::${model}`;
  }

  /**
   * Record one usage event (from after_model). Cost estimated via resolvePrice
   * (normalized model name → model/catalog/protocol price, else default/0) and
   * split into input/output/cacheRead/cacheWrite via `costBreakdown`.
   */
  record(input: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    /** cache 写入 token（Anthropic cache_creation）；task 090 */
    cacheCreationTokens?: number;
    /** 归档本地日（缺省用 now() 的本地日；测试可注入固定日） */
    date?: string;
  }): UsageRecordResult {
    const { provider, model } = input;
    const resolved = this.resolve(model, provider);
    const inT = input.inputTokens ?? 0;
    const outT = input.outputTokens ?? 0;
    const cacheT = input.cacheReadTokens ?? 0;
    const cacheWT = input.cacheCreationTokens ?? 0;
    const cost = this.cost(resolved.price, {
      inputTokens: inT,
      outputTokens: outT,
      cacheReadTokens: cacheT,
      cacheCreationTokens: cacheWT,
    }, provider);
    const multiplier = cost.costMultiplier;

    const k = this.key(provider, model);
    const prev = this.data.entries[k];
    const now = this.clock();
    const ts = now.toISOString();
    const date = input.date ?? localDateKey(now);
    const pricingSource: UsagePricingSource = prev
      ? prev.pricingSource === resolved.source
        ? resolved.source
        : 'mixed'
      : resolved.source;
    const prevBreakdown = prev?.costBreakdown ?? emptyBreakdown();
    const entryBreakdown: UsageCostBreakdown = { ...prevBreakdown };
    addBreakdown(entryBreakdown, cost);
    const derivedCost = cost.cacheWriteDerived ? cost.cacheWriteUsd : 0;
    // 094：条目级倍率留痕——历次倍率一致才记数值，变过则标 mixed（不假装唯一）。
    const prevMultiplier = prev === undefined ? undefined : prev.costMultiplier ?? DEFAULT_COST_MULTIPLIER;
    let entryMultiplier: number | undefined;
    let entryMixed = prev?.costMultiplierMixed ?? false;
    if (prev === undefined) {
      entryMultiplier = multiplier !== DEFAULT_COST_MULTIPLIER ? multiplier : undefined;
      entryMixed = false;
    } else if (entryMixed) {
      entryMultiplier = undefined;
    } else if (prevMultiplier === multiplier) {
      entryMultiplier = multiplier !== DEFAULT_COST_MULTIPLIER ? multiplier : undefined;
    } else {
      entryMultiplier = undefined;
      entryMixed = true;
    }
    this.data.entries[k] = {
      model,
      provider,
      inputTokens: (prev?.inputTokens ?? 0) + inT,
      outputTokens: (prev?.outputTokens ?? 0) + outT,
      cacheReadTokens: (prev?.cacheReadTokens ?? 0) + cacheT,
      cacheCreationTokens: (prev?.cacheCreationTokens ?? 0) + cacheWT,
      calls: (prev?.calls ?? 0) + 1,
      costUsd: (prev?.costUsd ?? 0) + cost.totalUsd,
      costBreakdown: entryBreakdown,
      cacheWriteDerivedCostUsd: (prev?.cacheWriteDerivedCostUsd ?? 0) + derivedCost,
      cacheWriteDerived: (prev?.cacheWriteDerived ?? false) || cost.cacheWriteDerived,
      estimated: (prev?.estimated ?? false) || resolved.estimated,
      estimatedCostUsd: (prev?.estimatedCostUsd ?? 0) + (resolved.estimated ? cost.totalUsd : 0),
      pricingSource,
      lastTs: ts,
      events: (prev?.events ?? 0) + 1,
      ...(entryMultiplier !== undefined ? { costMultiplier: entryMultiplier } : {}),
      ...(entryMixed ? { costMultiplierMixed: true } : {}),
    };

    // 本地日分桶（task 089）：与累计总量并存，逐日累计，不做回填。
    // 091 起同时累计**按模型子分项**，使日成本在改价后可被精确重算。
    const bucket = this.data.daily[date] ?? emptyBucket();
    bucket.inputTokens += inT;
    bucket.outputTokens += outT;
    bucket.cacheReadTokens += cacheT;
    bucket.cacheCreationTokens += cacheWT;
    bucket.costUsd += cost.totalUsd;
    bucket.calls += 1;
    bucket.estimatedCostUsd += resolved.estimated ? cost.totalUsd : 0;
    bucket.cacheWriteDerivedCostUsd += derivedCost;
    if (!bucket.firstTs) bucket.firstTs = ts;
    bucket.lastTs = ts;
    const bucketModels = bucket.models ?? {};
    const modelBucket = bucketModels[k] ?? {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
      costUsd: 0, calls: 0, estimatedCostUsd: 0, cacheWriteDerivedCostUsd: 0,
    };
    modelBucket.inputTokens += inT;
    modelBucket.outputTokens += outT;
    modelBucket.cacheReadTokens += cacheT;
    modelBucket.cacheCreationTokens += cacheWT;
    modelBucket.costUsd += cost.totalUsd;
    modelBucket.calls += 1;
    modelBucket.estimatedCostUsd += resolved.estimated ? cost.totalUsd : 0;
    modelBucket.cacheWriteDerivedCostUsd += derivedCost;
    bucketModels[k] = modelBucket;
    bucket.models = bucketModels;
    this.data.daily[date] = bucket;

    this.data.recent.push({
      ts,
      provider,
      model,
      inputTokens: inT,
      outputTokens: outT,
      cacheReadTokens: cacheT,
      cacheCreationTokens: cacheWT,
      costUsd: cost.totalUsd,
      estimated: resolved.estimated,
      pricingSource: resolved.source,
    });
    if (this.data.recent.length > this.recentCap) this.data.recent = this.data.recent.slice(-this.recentCap);

    this.save();
    return {
      costUsd: cost.totalUsd,
      source: resolved.source,
      estimated: resolved.estimated,
      breakdown: cost,
      cacheWritePriceSource: cost.cacheWritePriceSource,
      date,
    };
  }

  /**
   * 按**当前**价目重算历史成本（task 091）——改价后历史不再钉死。
   *
   * 口径：
   *   - **保留 token 原始值**（input/output/cacheRead/cacheWrite 一律不动），
   *     只重算 `costUsd` / `costBreakdown` / `estimated` / `estimatedCostUsd` /
   *     `pricingSource` / `cacheWriteDerived*`。
   *   - 重算即「用当前价目重新记录同样的 token」：`costBreakdown(price, 累计 token)`。
   *   - 重算后来源统一为本次命中的来源（原先的 `mixed` 会收敛——这正是重算的目的）。
   *   - 旧条目（无 `pricingSource`，读入时标 `legacy`）按当前规则重算，并标
   *     `recomputedFromLegacy: true` 留痕。
   *   - **幂等**：同一价目下第二次调用零变更（金额比较带 1e-9 容差），不写盘。
   *   - `dryRun: true` 只算差异、不落盘。
   *   - `since`/`until`（本地日，含首含尾）：条目按 `lastTs` 的本地日筛选、
   *     日分桶按日期键、明细按 `ts`。
   *
   * 日分桶：只有带按模型子分项（091 起写入）的日子才能精确重算；旧日分桶跳过并计入
   * `dailySkipped`（不猜、不按比例摊）。
   */
  recompute(options: UsageRecomputeOptions = {}): UsageRecomputeResult {
    const dryRun = options.dryRun ?? false;
    const { since, until } = options;
    if (since !== undefined && !isLocalDateKey(since)) throw new RangeError(`invalid since date: ${since}`);
    if (until !== undefined && !isLocalDateKey(until)) throw new RangeError(`invalid until date: ${until}`);
    const windowed = since !== undefined || until !== undefined;
    const inWindow = (date: string | undefined): boolean => {
      if (!windowed) return true;
      if (date === undefined) return false;
      if (since !== undefined && date < since) return false;
      if (until !== undefined && date > until) return false;
      return true;
    };

    const changes: UsageRecomputeChange[] = [];
    const nowIso = this.clock().toISOString();
    let legacyRecomputed = 0;
    let dailySkipped = 0;

    const zeroScope = (): UsageRecomputeScopeSummary => ({ scanned: 0, changed: 0, beforeUsd: 0, afterUsd: 0, deltaUsd: 0 });

    // ---- 1) 累计条目（权威成本口径）----
    const entries = zeroScope();
    for (const [key, entry] of Object.entries(this.data.entries)) {
      if (windowed && !inWindow(localDateOfTs(entry.lastTs))) continue;
      entries.scanned += 1;
      entries.beforeUsd += entry.costUsd;
      const resolved = this.resolve(entry.model, entry.provider);
      const cost = this.cost(resolved.price, entry, entry.provider);
      entries.afterUsd += cost.totalUsd;
      const nextBreakdown: UsageCostBreakdown = {
        inputUsd: cost.inputUsd,
        outputUsd: cost.outputUsd,
        cacheReadUsd: cost.cacheReadUsd,
        cacheWriteUsd: cost.cacheWriteUsd,
      };
      const nextEstimatedCost = resolved.estimated ? cost.totalUsd : 0;
      const nextDerivedCost = cost.cacheWriteDerived ? cost.cacheWriteUsd : 0;
      const nextMultiplier = cost.costMultiplier !== DEFAULT_COST_MULTIPLIER ? cost.costMultiplier : undefined;
      const prevBreakdown = entry.costBreakdown ?? emptyBreakdown();
      const changed =
        !sameMoney(entry.costUsd, cost.totalUsd) ||
        !sameMoney(entry.estimatedCostUsd, nextEstimatedCost) ||
        !sameMoney(entry.cacheWriteDerivedCostUsd ?? 0, nextDerivedCost) ||
        entry.estimated !== resolved.estimated ||
        (entry.cacheWriteDerived ?? false) !== cost.cacheWriteDerived ||
        entry.pricingSource !== resolved.source ||
        entry.costMultiplier !== nextMultiplier ||
        (entry.costMultiplierMixed ?? false) ||
        !sameMoney(prevBreakdown.inputUsd, nextBreakdown.inputUsd) ||
        !sameMoney(prevBreakdown.outputUsd, nextBreakdown.outputUsd) ||
        !sameMoney(prevBreakdown.cacheReadUsd, nextBreakdown.cacheReadUsd) ||
        !sameMoney(prevBreakdown.cacheWriteUsd, nextBreakdown.cacheWriteUsd);
      if (!changed) continue;
      const wasLegacy = entry.pricingSource === 'legacy';
      if (wasLegacy) legacyRecomputed += 1;
      entries.changed += 1;
      changes.push({
        scope: 'entry',
        key,
        beforeUsd: entry.costUsd,
        afterUsd: cost.totalUsd,
        deltaUsd: cost.totalUsd - entry.costUsd,
        beforeSource: entry.pricingSource,
        afterSource: resolved.source,
        legacyRecomputed: wasLegacy,
      });
      if (!dryRun) {
        const next: UsageEntry = {
          ...entry,
          costUsd: cost.totalUsd,
          costBreakdown: nextBreakdown,
          estimated: resolved.estimated,
          estimatedCostUsd: nextEstimatedCost,
          cacheWriteDerivedCostUsd: nextDerivedCost,
          cacheWriteDerived: cost.cacheWriteDerived,
          pricingSource: resolved.source,
          recomputedAt: nowIso,
        };
        // 重算 = 用当前价目与当前倍率重新记录：倍率收敛为唯一值，mixed 痕迹清掉。
        if (nextMultiplier !== undefined) next.costMultiplier = nextMultiplier;
        else delete next.costMultiplier;
        delete next.costMultiplierMixed;
        if (wasLegacy) next.recomputedFromLegacy = true;
        this.data.entries[key] = next;
      }
    }
    entries.deltaUsd = entries.afterUsd - entries.beforeUsd;

    // ---- 2) 本地日分桶（按模型子分项精确重算）----
    const daily = zeroScope();
    for (const [date, bucket] of Object.entries(this.data.daily)) {
      if (!inWindow(date)) continue;
      daily.scanned += 1;
      daily.beforeUsd += bucket.costUsd;
      const modelKeys = Object.keys(bucket.models ?? {});
      if (modelKeys.length === 0) {
        dailySkipped += 1;
        daily.afterUsd += bucket.costUsd; // 无法重算 → 保持原值
        continue;
      }
      const nextModels: Record<string, UsageDailyModelBucket> = {};
      let costUsd = 0;
      let estimatedCostUsd = 0;
      let derivedCostUsd = 0;
      for (const mKey of modelKeys) {
        const sub = bucket.models?.[mKey];
        if (!sub) continue;
        const { provider, model } = splitEntryKey(mKey);
        const resolved = this.resolve(model, provider);
        const cost = this.cost(resolved.price, sub, provider);
        const nextSub: UsageDailyModelBucket = {
          inputTokens: sub.inputTokens,
          outputTokens: sub.outputTokens,
          cacheReadTokens: sub.cacheReadTokens,
          cacheCreationTokens: sub.cacheCreationTokens,
          costUsd: cost.totalUsd,
          calls: sub.calls,
          estimatedCostUsd: resolved.estimated ? cost.totalUsd : 0,
          cacheWriteDerivedCostUsd: cost.cacheWriteDerived ? cost.cacheWriteUsd : 0,
        };
        nextModels[mKey] = nextSub;
        costUsd += nextSub.costUsd;
        estimatedCostUsd += nextSub.estimatedCostUsd;
        derivedCostUsd += nextSub.cacheWriteDerivedCostUsd;
      }
      daily.afterUsd += costUsd;
      const changed =
        !sameMoney(bucket.costUsd, costUsd) ||
        !sameMoney(bucket.estimatedCostUsd, estimatedCostUsd) ||
        !sameMoney(bucket.cacheWriteDerivedCostUsd, derivedCostUsd);
      if (!changed) continue;
      daily.changed += 1;
      changes.push({ scope: 'daily', key: date, beforeUsd: bucket.costUsd, afterUsd: costUsd, deltaUsd: costUsd - bucket.costUsd });
      if (!dryRun) {
        this.data.daily[date] = {
          ...bucket,
          costUsd,
          estimatedCostUsd,
          cacheWriteDerivedCostUsd: derivedCostUsd,
          models: nextModels,
        };
      }
    }
    daily.deltaUsd = daily.afterUsd - daily.beforeUsd;

    // ---- 3) 最近明细（单次调用记录，token 与 ts 齐全 → 精确重算）----
    const recent = zeroScope();
    for (let i = 0; i < this.data.recent.length; i += 1) {
      const rec = this.data.recent[i];
      if (!rec) continue;
      if (windowed && !inWindow(localDateOfTs(rec.ts))) continue;
      recent.scanned += 1;
      recent.beforeUsd += rec.costUsd;
      const resolved = this.resolve(rec.model, rec.provider);
      const cost = this.cost(resolved.price, rec, rec.provider);
      recent.afterUsd += cost.totalUsd;
      const changed = !sameMoney(rec.costUsd, cost.totalUsd) || rec.estimated !== resolved.estimated || rec.pricingSource !== resolved.source;
      if (!changed) continue;
      recent.changed += 1;
      changes.push({
        scope: 'recent',
        key: rec.ts,
        beforeUsd: rec.costUsd,
        afterUsd: cost.totalUsd,
        deltaUsd: cost.totalUsd - rec.costUsd,
        beforeSource: rec.pricingSource,
        afterSource: resolved.source,
      });
      if (!dryRun) {
        this.data.recent[i] = {
          ...rec,
          costUsd: cost.totalUsd,
          estimated: resolved.estimated,
          pricingSource: resolved.source,
        };
      }
    }
    recent.deltaUsd = recent.afterUsd - recent.beforeUsd;

    const changed = entries.changed + daily.changed + recent.changed;
    const written = !dryRun && changed > 0;
    if (written) this.save();
    return { dryRun, since, until, entries, daily, recent, dailySkipped, legacyRecomputed, changed, written, changes };
  }

  /** aggregate totals across all entries */
  totals(): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    calls: number;
    costUsd: number;
    costBreakdown: UsageCostBreakdown;
    cacheWriteDerivedCostUsd: number;
    /** 无分项的旧条目数（089 之前写入；分项不可重建） */
    entriesWithoutBreakdown: number;
    models: number;
    providers: number;
    estimatedEntries: number;
    estimatedCostUsd: number;
    unpricedEntries: number;
    legacyEntries: number;
    /** 分项合计（未乘 provider 倍率；094：`costUsd ≈ rawCostUsd × 倍率`）。 */
    rawCostUsd: number;
    /** 含非 1 倍率的条目数（094）。 */
    multipliedEntries: number;
    /** 历次倍率不一致的条目数（094；这类条目没有唯一倍率）。 */
    mixedMultiplierEntries: number;
  } {
    let input = 0, output = 0, cache = 0, cacheWrite = 0, calls = 0, cost = 0;
    let estimatedEntries = 0, estimatedCostUsd = 0, unpricedEntries = 0, legacyEntries = 0;
    let derivedCost = 0, withoutBreakdown = 0;
    let rawCost = 0, multipliedEntries = 0, mixedMultiplierEntries = 0;
    const breakdown = emptyBreakdown();
    for (const e of Object.values(this.data.entries)) {
      input += e.inputTokens; output += e.outputTokens; cache += e.cacheReadTokens;
      cacheWrite += e.cacheCreationTokens ?? 0; calls += e.calls; cost += e.costUsd;
      derivedCost += e.cacheWriteDerivedCostUsd ?? 0;
      const b = e.costBreakdown ?? emptyBreakdown();
      addBreakdown(breakdown, b);
      rawCost += UsageStore.rawTotal(b);
      if (e.costMultiplier !== undefined && e.costMultiplier !== DEFAULT_COST_MULTIPLIER) multipliedEntries += 1;
      if (e.costMultiplierMixed) mixedMultiplierEntries += 1;
      const bTotal = b.inputUsd + b.outputUsd + b.cacheReadUsd + b.cacheWriteUsd;
      if (bTotal === 0 && e.costUsd !== 0) withoutBreakdown += 1;
      if (e.estimated) { estimatedEntries += 1; estimatedCostUsd += e.estimatedCostUsd; }
      if (e.pricingSource === 'unpriced') unpricedEntries += 1;
      if (e.pricingSource === 'legacy') legacyEntries += 1;
    }
    return {
      inputTokens: input, outputTokens: output, cacheReadTokens: cache,
      cacheCreationTokens: cacheWrite, calls, costUsd: cost,
      costBreakdown: breakdown, cacheWriteDerivedCostUsd: derivedCost,
      entriesWithoutBreakdown: withoutBreakdown,
      models: Object.keys(this.data.entries).length,
      providers: new Set(Object.values(this.data.entries).map((e) => e.provider)).size,
      estimatedEntries, estimatedCostUsd, unpricedEntries, legacyEntries,
      rawCostUsd: rawCost, multipliedEntries, mixedMultiplierEntries,
    };
  }

  /** 是否有本地日分桶数据（089 之前的旧文件 = false）。 */
  hasDailyData(): boolean {
    return Object.keys(this.data.daily).length > 0;
  }

  /** 读入的文件是否为 089 之前的格式（有累计、无 daily 分桶）。 */
  migratedFromLegacy(): boolean {
    return this.legacyFile;
  }

  /** 全部本地日分桶（升序，带 `complete` 标记）。 */
  daily(): UsageDailyRow[];
  /** 窗口内（since/until 含首含尾）的本地日分桶（升序）。 */
  daily(query: UsageDailyQuery & { completeOnly?: boolean }): UsageDailyRow[];
  daily(query: UsageDailyQuery & { completeOnly?: boolean } = {}): UsageDailyRow[] {
    const since = query.since;
    const until = query.until;
    if (since !== undefined && !isLocalDateKey(since)) throw new RangeError(`invalid since date: ${since}`);
    if (until !== undefined && !isLocalDateKey(until)) throw new RangeError(`invalid until date: ${until}`);
    const today = localDateKey(this.clock());
    const rows: UsageDailyRow[] = [];
    for (const [date, bucket] of Object.entries(this.data.daily)) {
      if (!isLocalDateKey(date)) continue;
      if (since !== undefined && date < since) continue;
      if (until !== undefined && date > until) continue;
      const complete = date < today; // 今天与未来日都不完整（本地时区）
      if (query.completeOnly && !complete) continue;
      rows.push({ ...bucket, date, complete });
    }
    return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /**
   * 窗口汇总（task 089）：**完整本地日**与未完整本地日（今天/未来）分开合计，
   * 与 cc-switch「rollup 行只纳入完整本地日」同口径——半天数据不混进完整日合计。
   */
  dailySummary(query: UsageDailyQuery = {}): UsageDailySummary {
    const rows = this.daily(query);
    const zero = (): UsageDailyTotals => ({
      days: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheCreationTokens: 0, costUsd: 0, calls: 0, estimatedCostUsd: 0,
      cacheWriteDerivedCostUsd: 0,
    });
    const complete = zero();
    const partial = zero();
    for (const row of rows) {
      const into = row.complete ? complete : partial;
      into.days += 1;
      into.inputTokens += row.inputTokens;
      into.outputTokens += row.outputTokens;
      into.cacheReadTokens += row.cacheReadTokens;
      into.cacheCreationTokens += row.cacheCreationTokens;
      into.costUsd += row.costUsd;
      into.calls += row.calls;
      into.estimatedCostUsd += row.estimatedCostUsd;
      into.cacheWriteDerivedCostUsd += row.cacheWriteDerivedCostUsd;
    }
    return { rows, complete, partial, hasPartial: partial.days > 0 };
  }

  /** 价格来源分布（条目 / 调用 / 金额），按金额降序。 */
  pricingSourceDistribution(): { source: UsagePricingSource; entries: number; calls: number; costUsd: number }[] {
    const map = new Map<UsagePricingSource, { source: UsagePricingSource; entries: number; calls: number; costUsd: number }>();
    for (const e of Object.values(this.data.entries)) {
      const cur = map.get(e.pricingSource) ?? { source: e.pricingSource, entries: 0, calls: 0, costUsd: 0 };
      cur.entries += 1; cur.calls += e.calls; cur.costUsd += e.costUsd;
      map.set(e.pricingSource, cur);
    }
    return [...map.values()].sort((a, b) => b.costUsd - a.costUsd);
  }

  /**
   * `--strict` 审计：按「只用模型专属价目」的口径重算全部历史条目，
   * 给出 strict 成本与未收录（会变成 0 成本）的条目数/金额差。
   */
  strictAudit(): { costUsd: number; unpricedEntries: number; unpricedCostUsd: number; deltaUsd: number } {
    let costUsd = 0;
    let unpricedEntries = 0;
    let unpricedCostUsd = 0;
    for (const e of Object.values(this.data.entries)) {
      const resolved = this.resolve(e.model, e.provider, true);
      const cost = this.cost(resolved.price, e, e.provider);
      costUsd += cost.totalUsd;
      if (resolved.source === 'unpriced') {
        unpricedEntries += 1;
        unpricedCostUsd += e.costUsd;
      }
    }
    return { costUsd, unpricedEntries, unpricedCostUsd, deltaUsd: this.totals().costUsd - costUsd };
  }

  byProvider(): {
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    calls: number;
    costUsd: number;
    estimated: boolean;
    /** 分项合计（未乘倍率；094：`costUsd = rawCostUsd × costMultiplier`）。 */
    rawCostUsd: number;
    /** 该 provider 的统一成本倍率（094）；无倍率 = undefined，不一致 = undefined + mixed。 */
    costMultiplier?: number;
    /** true = 该 provider 的条目历次倍率不一致（无唯一倍率）。 */
    costMultiplierMixed: boolean;
  }[] {
    const map = new Map<string, {
      provider: string; inputTokens: number; outputTokens: number; cacheReadTokens: number;
      cacheCreationTokens: number; calls: number; costUsd: number; estimated: boolean;
      rawCostUsd: number; costMultiplier?: number; costMultiplierMixed: boolean;
    }>();
    for (const e of Object.values(this.data.entries)) {
      const cur = map.get(e.provider) ?? {
        provider: e.provider, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        cacheCreationTokens: 0, calls: 0, costUsd: 0, estimated: false,
        rawCostUsd: 0, costMultiplier: undefined, costMultiplierMixed: false,
      };
      cur.inputTokens += e.inputTokens; cur.outputTokens += e.outputTokens;
      cur.cacheReadTokens += e.cacheReadTokens; cur.cacheCreationTokens += e.cacheCreationTokens ?? 0;
      cur.calls += e.calls; cur.costUsd += e.costUsd;
      cur.rawCostUsd += UsageStore.rawTotal(e.costBreakdown);
      cur.estimated = cur.estimated || e.estimated;
      // 094：provider 级倍率只在「该 provider 所有条目一致」时才敢报一个数。
      if (e.costMultiplierMixed) {
        cur.costMultiplier = undefined;
        cur.costMultiplierMixed = true;
      } else if (!cur.costMultiplierMixed) {
        const m = e.costMultiplier ?? DEFAULT_COST_MULTIPLIER;
        if (cur.costMultiplier === undefined) cur.costMultiplier = m;
        else if (cur.costMultiplier !== m) {
          cur.costMultiplier = undefined;
          cur.costMultiplierMixed = true;
        }
      }
      map.set(e.provider, cur);
    }
    return [...map.values()].sort((a, b) => b.costUsd - a.costUsd);
  }

  byModel(): UsageEntry[] {
    return Object.values(this.data.entries).sort((a, b) => b.costUsd - a.costUsd);
  }

  recent(n?: number): UsageRecentEntry[] {
    const cap = n ?? 10;
    return this.data.recent.slice(-cap);
  }

  entries(): Record<string, UsageEntry> {
    return this.data.entries;
  }
}
