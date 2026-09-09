import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  costBreakdown,
  resolvePrice,
  type CacheWritePriceSource,
  type CatalogPriceSource,
  type CostBreakdown,
  type PriceSource,
  type PricingTable,
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
 *   - strict 模式 → 只用 model/catalog，未收录模型标 `unpriced` + 0 成本
 *     （保留 token 计数待回填）
 *   - cache 写入（cache_creation）独立计价；价目缺 `cacheWrite` 时按
 *     `input × 1.25` 推导并标 `cacheWriteDerived`（见 docs/PRICING.md §7）
 *
 * 日口径（task 089）：分桶键是**本地日** `YYYY-MM-DD`（用本机时区，不是 UTC）。
 * 写入时按 `now()` 的本地日归档；查询时「完整本地日」= 已结束的本地日
 * （今天与未来日都不完整，单列 partial，不混进完整日合计）。
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
  /** strict mode: 只用模型专属价目（model/catalog），未收录模型按 0 计价（标 `unpriced`） */
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

/**
 * UsageStore — 落盘用量与成本。
 * 成本公式用 `@vessel/shared` 的 `costBreakdown`（唯一实现，勿再复制）。
 */
export class UsageStore {
  readonly rootDir: string;
  private readonly file: string;
  private readonly pricing: PricingTable;
  private readonly catalog: CatalogPriceSource | undefined;
  private readonly strict: boolean;
  private readonly recentCap: number;
  private readonly clock: () => Date;
  private data: UsageFile;
  /** 读入的旧文件没有 daily 字段（089 之前的累计）：历史只保留累计，不伪造分桶 */
  private readonly legacyFile: boolean;

  constructor(opts: UsageStoreOptions = {}) {
    this.rootDir = opts.rootDir ?? process.env.VESSEL_USAGE_ROOT ?? defaultUsageRoot();
    this.file = path.join(this.rootDir, 'usage.json');
    this.pricing = opts.pricing ?? { models: {}, protocols: {} };
    this.catalog = opts.catalog;
    this.strict = opts.strict ?? false;
    this.recentCap = opts.recentCap ?? 200;
    this.clock = opts.now ?? (() => new Date());
    const loaded = this.load();
    this.data = loaded.file;
    this.legacyFile = loaded.legacy;
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
          daily[date] = {
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
    // rename 偶发 EPERM/EBUSY——有界重试（3 次，5/15ms 退避），仍失败则抛出，
    // 不吞错、不改语义（要么完整旧文件，要么完整新文件）。
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        fs.renameSync(tmp, this.file);
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
    const resolved = resolvePrice(this.pricing, model, provider, this.catalog, { strict: this.strict });
    const inT = input.inputTokens ?? 0;
    const outT = input.outputTokens ?? 0;
    const cacheT = input.cacheReadTokens ?? 0;
    const cacheWT = input.cacheCreationTokens ?? 0;
    const cost = costBreakdown(resolved.price, {
      inputTokens: inT,
      outputTokens: outT,
      cacheReadTokens: cacheT,
      cacheCreationTokens: cacheWT,
    });

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
    };

    // 本地日分桶（task 089）：与累计总量并存，逐日累计，不做回填。
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
  } {
    let input = 0, output = 0, cache = 0, cacheWrite = 0, calls = 0, cost = 0;
    let estimatedEntries = 0, estimatedCostUsd = 0, unpricedEntries = 0, legacyEntries = 0;
    let derivedCost = 0, withoutBreakdown = 0;
    const breakdown = emptyBreakdown();
    for (const e of Object.values(this.data.entries)) {
      input += e.inputTokens; output += e.outputTokens; cache += e.cacheReadTokens;
      cacheWrite += e.cacheCreationTokens ?? 0; calls += e.calls; cost += e.costUsd;
      derivedCost += e.cacheWriteDerivedCostUsd ?? 0;
      const b = e.costBreakdown ?? emptyBreakdown();
      addBreakdown(breakdown, b);
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
      const resolved = resolvePrice(this.pricing, e.model, e.provider, this.catalog, { strict: true });
      const cost = costBreakdown(resolved.price, e);
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
  }[] {
    const map = new Map<string, {
      provider: string; inputTokens: number; outputTokens: number; cacheReadTokens: number;
      cacheCreationTokens: number; calls: number; costUsd: number; estimated: boolean;
    }>();
    for (const e of Object.values(this.data.entries)) {
      const cur = map.get(e.provider) ?? {
        provider: e.provider, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
        cacheCreationTokens: 0, calls: 0, costUsd: 0, estimated: false,
      };
      cur.inputTokens += e.inputTokens; cur.outputTokens += e.outputTokens;
      cur.cacheReadTokens += e.cacheReadTokens; cur.cacheCreationTokens += e.cacheCreationTokens ?? 0;
      cur.calls += e.calls; cur.costUsd += e.costUsd;
      cur.estimated = cur.estimated || e.estimated;
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
