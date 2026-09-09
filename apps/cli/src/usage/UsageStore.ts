import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  costOf,
  resolvePrice,
  type CatalogPriceSource,
  type PriceSource,
  type PricingTable,
} from '../providers/pricing.js';

/**
 * apps/cli/usage — UsageStore (V0.9, task 029 / 086): persistent usage statistics.
 *
 * Reference model: cc-switch usage tracking — accumulate tokens, calls and
 * estimated cost per model / per provider across sessions, persisted to
 * `~/.vessel/usage.json` (atomic tmp+rename, same as ProviderStore).
 *
 * 计价（task 086/087）：走 `@vessel/shared` 的 `resolvePrice`（与 UsageProjection
 * 同一实现、同一回退链）。每条记录落 `estimated` / `pricingSource`：
 *   - source='protocol'/'default' → estimated=true（不是该模型的专属价目）
 *   - strict 模式 → 只用 model/catalog，未收录模型标 `unpriced` + 0 成本
 *     （保留 token 计数待回填）
 */

/** 持久化的价格来源：查价来源 + `legacy`（085 之前写入、未记录来源的旧条目）。 */
export type UsagePricingSource = PriceSource | 'legacy' | 'mixed';

export interface UsageEntry {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  calls: number;
  /** estimated cost in USD (per-entry = per batch of calls at this model) */
  costUsd: number;
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
  costUsd: number;
  estimated: boolean;
  pricingSource: UsagePricingSource;
}

export interface UsageFile {
  version: 1;
  entries: Record<string, UsageEntry>; // key = `${provider}::${model}`
  recent: UsageRecentEntry[];
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
}

export interface UsageRecordResult {
  costUsd: number;
  source: PriceSource;
  estimated: boolean;
}

export function defaultUsageRoot(home = os.homedir()): string {
  return path.join(home, '.vessel');
}

/**
 * UsageStore — 落盘用量与成本。
 * 成本公式用 `@vessel/shared` 的 `costOf`（唯一实现，勿再复制）。
 */
export class UsageStore {
  readonly rootDir: string;
  private readonly file: string;
  private readonly pricing: PricingTable;
  private readonly catalog: CatalogPriceSource | undefined;
  private readonly strict: boolean;
  private readonly recentCap: number;
  private data: UsageFile;

  constructor(opts: UsageStoreOptions = {}) {
    this.rootDir = opts.rootDir ?? process.env.VESSEL_USAGE_ROOT ?? defaultUsageRoot();
    this.file = path.join(this.rootDir, 'usage.json');
    this.pricing = opts.pricing ?? { models: {}, protocols: {} };
    this.catalog = opts.catalog;
    this.strict = opts.strict ?? false;
    this.recentCap = opts.recentCap ?? 200;
    this.data = this.load();
  }

  private load(): UsageFile {
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return { version: 1, entries: {}, recent: [] };
    }
    try {
      const parsed = JSON.parse(text) as UsageFile;
      if (!parsed.entries || typeof parsed.entries !== 'object') return { version: 1, entries: {}, recent: [] };
      const entries: Record<string, UsageEntry> = {};
      for (const [key, raw] of Object.entries(parsed.entries)) {
        // 085 之前的旧条目没有 estimated/pricingSource：标 'legacy'（来源未知），
        // 不臆造来源，也不谎称是真实价目。
        entries[key] = {
          ...raw,
          estimated: raw.estimated ?? false,
          estimatedCostUsd: raw.estimatedCostUsd ?? 0,
          pricingSource: raw.pricingSource ?? 'legacy',
        };
      }
      const recent: UsageRecentEntry[] = Array.isArray(parsed.recent)
        ? parsed.recent.map((r) => ({ ...r, estimated: r.estimated ?? false, pricingSource: r.pricingSource ?? 'legacy' }))
        : [];
      return { version: 1, entries, recent };
    } catch {
      return { version: 1, entries: {}, recent: [] };
    }
  }

  private save(): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file); // atomic
  }

  private key(provider: string, model: string): string {
    return `${provider}::${model}`;
  }

  /**
   * Record one usage event (from after_model). Cost estimated via resolvePrice
   * (normalized model name → model/catalog/protocol price, else default/0).
   */
  record(input: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
  }): UsageRecordResult {
    const { provider, model } = input;
    const resolved = resolvePrice(this.pricing, model, provider, this.catalog, { strict: this.strict });
    const inT = input.inputTokens ?? 0;
    const outT = input.outputTokens ?? 0;
    const cacheT = input.cacheReadTokens ?? 0;
    const cost = costOf(resolved.price, { inputTokens: inT, outputTokens: outT, cacheReadTokens: cacheT });

    const k = this.key(provider, model);
    const prev = this.data.entries[k];
    const now = new Date().toISOString();
    const pricingSource: UsagePricingSource = prev
      ? prev.pricingSource === resolved.source
        ? resolved.source
        : 'mixed'
      : resolved.source;
    this.data.entries[k] = {
      model,
      provider,
      inputTokens: (prev?.inputTokens ?? 0) + inT,
      outputTokens: (prev?.outputTokens ?? 0) + outT,
      cacheReadTokens: (prev?.cacheReadTokens ?? 0) + cacheT,
      calls: (prev?.calls ?? 0) + 1,
      costUsd: (prev?.costUsd ?? 0) + cost,
      estimated: (prev?.estimated ?? false) || resolved.estimated,
      estimatedCostUsd: (prev?.estimatedCostUsd ?? 0) + (resolved.estimated ? cost : 0),
      pricingSource,
      lastTs: now,
      events: (prev?.events ?? 0) + 1,
    };

    this.data.recent.push({
      ts: now,
      provider,
      model,
      inputTokens: inT,
      outputTokens: outT,
      cacheReadTokens: cacheT,
      costUsd: cost,
      estimated: resolved.estimated,
      pricingSource: resolved.source,
    });
    if (this.data.recent.length > this.recentCap) this.data.recent = this.data.recent.slice(-this.recentCap);

    this.save();
    return { costUsd: cost, source: resolved.source, estimated: resolved.estimated };
  }

  /** aggregate totals across all entries */
  totals(): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    calls: number;
    costUsd: number;
    models: number;
    providers: number;
    estimatedEntries: number;
    estimatedCostUsd: number;
    unpricedEntries: number;
    legacyEntries: number;
  } {
    let input = 0, output = 0, cache = 0, calls = 0, cost = 0;
    let estimatedEntries = 0, estimatedCostUsd = 0, unpricedEntries = 0, legacyEntries = 0;
    for (const e of Object.values(this.data.entries)) {
      input += e.inputTokens; output += e.outputTokens; cache += e.cacheReadTokens; calls += e.calls; cost += e.costUsd;
      if (e.estimated) { estimatedEntries += 1; estimatedCostUsd += e.estimatedCostUsd; }
      if (e.pricingSource === 'unpriced') unpricedEntries += 1;
      if (e.pricingSource === 'legacy') legacyEntries += 1;
    }
    return {
      inputTokens: input, outputTokens: output, cacheReadTokens: cache, calls, costUsd: cost,
      models: Object.keys(this.data.entries).length,
      providers: new Set(Object.values(this.data.entries).map((e) => e.provider)).size,
      estimatedEntries, estimatedCostUsd, unpricedEntries, legacyEntries,
    };
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
      const cost = costOf(resolved.price, e);
      costUsd += cost;
      if (resolved.source === 'unpriced') {
        unpricedEntries += 1;
        unpricedCostUsd += e.costUsd;
      }
    }
    return { costUsd, unpricedEntries, unpricedCostUsd, deltaUsd: this.totals().costUsd - costUsd };
  }

  byProvider(): { provider: string; inputTokens: number; outputTokens: number; calls: number; costUsd: number; estimated: boolean }[] {
    const map = new Map<string, { provider: string; inputTokens: number; outputTokens: number; calls: number; costUsd: number; estimated: boolean }>();
    for (const e of Object.values(this.data.entries)) {
      const cur = map.get(e.provider) ?? { provider: e.provider, inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0, estimated: false };
      cur.inputTokens += e.inputTokens; cur.outputTokens += e.outputTokens; cur.calls += e.calls; cur.costUsd += e.costUsd;
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
