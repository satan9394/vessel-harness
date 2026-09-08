import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolvePrice, type PricingTable } from '../providers/pricing.js';

/**
 * apps/cli/usage — UsageStore (V0.9, task 029): persistent usage statistics.
 *
 * Reference model: cc-switch usage tracking — accumulate tokens, calls and
 * estimated cost per model / per provider across sessions, persisted to
 * `~/.vessel/usage.json` (atomic tmp+rename, same as ProviderStore).
 *
 * Cost estimation uses pricing resolvePrice(model, protocol): model-specific
 * price wins, then protocol, then default — see configs/pricing.json.
 */

export interface UsageEntry {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  calls: number;
  /** estimated cost in USD (per-entry = per batch of calls at this model) */
  costUsd: number;
  /** last recorded timestamp (ISO) */
  lastTs: string;
  /** count of recording events merged into this entry */
  events: number;
}

export interface UsageFile {
  version: 1;
  entries: Record<string, UsageEntry>; // key = `${provider}::${model}`
  recent: { ts: string; provider: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number }[];
}

export interface UsageStoreOptions {
  rootDir?: string;
  /** pricing table used for cost estimation (tests inject a fixed one) */
  pricing?: PricingTable;
  /** cap for the recent-entries ring buffer */
  recentCap?: number;
}

export function defaultUsageRoot(home = os.homedir()): string {
  return path.join(home, '.vessel');
}

export class UsageStore {
  readonly rootDir: string;
  private readonly file: string;
  private readonly pricing: PricingTable;
  private readonly recentCap: number;
  private data: UsageFile;

  constructor(opts: UsageStoreOptions = {}) {
    this.rootDir = opts.rootDir ?? process.env.VESSEL_USAGE_ROOT ?? defaultUsageRoot();
    this.file = path.join(this.rootDir, 'usage.json');
    this.pricing = opts.pricing ?? { models: {}, protocols: {} };
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
      return { version: 1, entries: parsed.entries, recent: Array.isArray(parsed.recent) ? parsed.recent : [] };
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
   * at this model's price (USD per 1M tokens).
   */
  record(input: { provider: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number }): void {
    const { provider, model } = input;
    const price = resolvePrice(this.pricing, model, provider);
    const inT = input.inputTokens ?? 0;
    const outT = input.outputTokens ?? 0;
    const cacheT = input.cacheReadTokens ?? 0;
    const cost = (inT / 1_000_000) * price.input + (outT / 1_000_000) * price.output + (cacheT / 1_000_000) * (price.cacheRead ?? 0);

    const k = this.key(provider, model);
    const prev = this.data.entries[k];
    const now = new Date().toISOString();
    this.data.entries[k] = {
      model,
      provider,
      inputTokens: (prev?.inputTokens ?? 0) + inT,
      outputTokens: (prev?.outputTokens ?? 0) + outT,
      cacheReadTokens: (prev?.cacheReadTokens ?? 0) + cacheT,
      calls: (prev?.calls ?? 0) + 1,
      costUsd: (prev?.costUsd ?? 0) + cost,
      lastTs: now,
      events: (prev?.events ?? 0) + 1,
    };

    this.data.recent.push({ ts: now, provider, model, inputTokens: inT, outputTokens: outT, cacheReadTokens: cacheT, costUsd: cost });
    if (this.data.recent.length > this.recentCap) this.data.recent = this.data.recent.slice(-this.recentCap);

    this.save();
  }

  /** aggregate totals across all entries */
  totals(): { inputTokens: number; outputTokens: number; cacheReadTokens: number; calls: number; costUsd: number; models: number; providers: number } {
    let input = 0, output = 0, cache = 0, calls = 0, cost = 0;
    for (const e of Object.values(this.data.entries)) {
      input += e.inputTokens; output += e.outputTokens; cache += e.cacheReadTokens; calls += e.calls; cost += e.costUsd;
    }
    return {
      inputTokens: input, outputTokens: output, cacheReadTokens: cache, calls, costUsd: cost,
      models: Object.keys(this.data.entries).length,
      providers: new Set(Object.values(this.data.entries).map((e) => e.provider)).size,
    };
  }

  byProvider(): { provider: string; inputTokens: number; outputTokens: number; calls: number; costUsd: number }[] {
    const map = new Map<string, { provider: string; inputTokens: number; outputTokens: number; calls: number; costUsd: number }>();
    for (const e of Object.values(this.data.entries)) {
      const cur = map.get(e.provider) ?? { provider: e.provider, inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 };
      cur.inputTokens += e.inputTokens; cur.outputTokens += e.outputTokens; cur.calls += e.calls; cur.costUsd += e.costUsd;
      map.set(e.provider, cur);
    }
    return [...map.values()].sort((a, b) => b.costUsd - a.costUsd);
  }

  byModel(): UsageEntry[] {
    return Object.values(this.data.entries).sort((a, b) => b.costUsd - a.costUsd);
  }

  recent(n?: number): UsageFile['recent'] {
    const cap = n ?? 10;
    return this.data.recent.slice(-cap);
  }

  entries(): Record<string, UsageEntry> {
    return this.data.entries;
  }
}
