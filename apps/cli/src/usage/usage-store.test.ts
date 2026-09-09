import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageStore } from './UsageStore.js';
import { catalogPriceSource } from '../providers/modelCatalog.js';
import type { PricingTable } from '../providers/pricing.js';

const PRICING: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
    'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3 },
  },
  protocols: { 'openai-compatible': { input: 0.5, output: 1.5, cacheRead: 0.1 } },
};

const CATALOG = catalogPriceSource({
  version: 1,
  source: 'test',
  models: [{ model: 'gemini-2.5-pro', provider: 'google', priceIn: 1.25, priceOut: 10, priceCache: 0.12 }],
});

/** 没有 protocol 行的表 → 未收录模型只能落到 default 兜底。 */
const DEFAULT_ONLY: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
  },
  protocols: {},
};

describe('usage — UsageStore (V0.9, task 029)', () => {
  let dir: string;
  let store: UsageStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-usage-'));
    store = new UsageStore({ rootDir: dir, pricing: PRICING });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accumulates tokens/calls/cost per provider::model across records', () => {
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 });
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const t = store.totals();
    expect(t.inputTokens).toBe(2_000_000);
    expect(t.outputTokens).toBe(2_000_000);
    expect(t.calls).toBe(2);
    // cost: 1M input @0.27 + 1M output @1.1 + 1M cache @0.07 = 1.44 per record; x2 but second has no cache
    // record1: 0.27+1.1+0.07=1.44; record2: 0.27+1.1=1.37; total 2.81
    expect(t.costUsd).toBeCloseTo(2.81, 5);
    const byModel = store.byModel();
    expect(byModel).toHaveLength(1);
    expect(byModel[0]!.model).toBe('deepseek-chat');
    expect(byModel[0]!.calls).toBe(2);
  });

  it('tracks multiple providers and models separately', () => {
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 100, outputTokens: 50 });
    store.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 200, outputTokens: 100 });
    expect(store.byProvider().map((p) => p.provider).sort()).toEqual(['anthropic', 'deepseek']);
    expect(store.byModel()).toHaveLength(2);
    expect(store.totals().providers).toBe(2);
    expect(store.totals().models).toBe(2);
  });

  it('persists across instances (reopen reads the same file)', () => {
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 500, outputTokens: 250 });
    const store2 = new UsageStore({ rootDir: dir, pricing: PRICING });
    const t2 = store2.totals();
    expect(t2.inputTokens).toBe(500);
    expect(t2.calls).toBe(1);
    expect(fs.existsSync(path.join(dir, 'usage.json'))).toBe(true);
    // no .tmp leftover (atomic write)
    expect(fs.existsSync(path.join(dir, 'usage.json.tmp'))).toBe(false);
  });

  it('recent ring keeps last N events in order', () => {
    for (let i = 0; i < 5; i++) {
      store.record({ provider: 'deepseek', model: 'm', inputTokens: i, outputTokens: 0 });
    }
    const rec = store.recent(3);
    expect(rec).toHaveLength(3);
    expect(rec[2]!.inputTokens).toBe(4); // last event first in slice? recent returns tail
    expect(rec[0]!.inputTokens).toBe(2);
  });

  it('missing/corrupt file starts empty without throwing', () => {
    const empty = new UsageStore({ rootDir: dir, pricing: PRICING });
    expect(empty.totals().calls).toBe(0);
    fs.writeFileSync(path.join(dir, 'usage.json'), '{bad json', 'utf8');
    const corrupt = new UsageStore({ rootDir: dir, pricing: PRICING });
    expect(corrupt.totals().calls).toBe(0);
  });

  it('marks default-fallback entries as estimated + pricingSource=default (task 086)', () => {
    const dflt = new UsageStore({ rootDir: dir, pricing: DEFAULT_ONLY });
    const res = dflt.record({ provider: 'unknown-provider', model: 'zzz-unknown', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(res).toMatchObject({ source: 'default', estimated: true });
    const entry = dflt.byModel()[0]!;
    expect(entry.estimated).toBe(true);
    expect(entry.pricingSource).toBe('default');
    expect(entry.estimatedCostUsd).toBeCloseTo(2, 6); // 0.5 + 1.5
    const t = dflt.totals();
    expect(t.estimatedEntries).toBe(1);
    expect(t.estimatedCostUsd).toBeCloseTo(2, 6);
    // 持久化：重开仍是估算条目
    const reopened = new UsageStore({ rootDir: dir, pricing: DEFAULT_ONLY });
    expect(reopened.byModel()[0]!.estimated).toBe(true);
    expect(reopened.byModel()[0]!.pricingSource).toBe('default');
  });

  it('model 级命中不算估算；protocol 级通用价算估算（task 086）', () => {
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 });
    store.record({ provider: 'openai-compatible', model: 'unknown-x', inputTokens: 1_000_000, outputTokens: 0 }); // protocol
    const byModel = store.byModel();
    const sourceOf = (m: string) => byModel.find((e) => e.model === m)!.pricingSource;
    const estOf = (m: string) => byModel.find((e) => e.model === m)!.estimated;
    expect(sourceOf('deepseek-chat')).toBe('model');
    expect(estOf('deepseek-chat')).toBe(false);
    expect(sourceOf('unknown-x')).toBe('protocol');
    expect(estOf('unknown-x')).toBe(true); // 协议级通用价 ≠ 该模型专属价目
    expect(store.totals().estimatedEntries).toBe(1);
  });

  it('uses the injected catalog source (task 087 chain)', () => {
    const s = new UsageStore({ rootDir: dir, pricing: PRICING, catalog: CATALOG });
    const res = s.record({ provider: 'openai-compatible', model: 'google/gemini-2.5-pro-001', inputTokens: 1_000_000, outputTokens: 0 });
    expect(res.source).toBe('catalog');
    expect(res.costUsd).toBeCloseTo(1.25, 6);
  });

  it('normalizes model names before pricing (task 085)', () => {
    const res = store.record({
      provider: 'anthropic',
      model: 'openrouter/anthropic/claude-3.5-sonnet-20241022',
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    expect(res.source).toBe('model');
    expect(res.costUsd).toBeCloseTo(3, 6);
  });

  it('strict mode prices unknown models at 0 and marks unpriced (task 086)', () => {
    const strict = new UsageStore({ rootDir: dir, pricing: DEFAULT_ONLY, strict: true });
    const res = strict.record({ provider: 'unknown-provider', model: 'zzz-unknown', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(res).toMatchObject({ source: 'unpriced', estimated: false, costUsd: 0 });
    const entry = strict.byModel()[0]!;
    expect(entry.costUsd).toBe(0);
    expect(entry.pricingSource).toBe('unpriced');
    // token 计数保留（可日后回填，不丢统计口径）
    expect(entry.inputTokens).toBe(1_000_000);
    expect(strict.totals().unpricedEntries).toBe(1);
    // strict 下已收录模型照常计价
    const ok = strict.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 });
    expect(ok.source).toBe('model');
    expect(ok.costUsd).toBeCloseTo(0.27, 6);
  });

  it('strictAudit recomputes history without the default fallback (task 086)', () => {
    const dflt = new UsageStore({ rootDir: dir, pricing: DEFAULT_ONLY });
    dflt.record({ provider: 'unknown-provider', model: 'zzz-unknown', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    dflt.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 });
    const audit = dflt.strictAudit();
    expect(audit.unpricedEntries).toBe(1);
    expect(audit.costUsd).toBeCloseTo(0.27, 6); // 兜底条目在 strict 下变 0
    expect(audit.unpricedCostUsd).toBeCloseTo(2, 6);
    expect(audit.deltaUsd).toBeCloseTo(2, 6);
  });

  it('pricingSourceDistribution aggregates entries per source', () => {
    const dflt = new UsageStore({ rootDir: dir, pricing: DEFAULT_ONLY });
    dflt.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 });
    dflt.record({ provider: 'unknown-provider', model: 'zzz', inputTokens: 1_000_000, outputTokens: 0 });
    const dist = dflt.pricingSourceDistribution();
    expect(dist.map((d) => d.source).sort()).toEqual(['default', 'model']);
    expect(dist.find((d) => d.source === 'model')!.entries).toBe(1);
  });

  it('legacy entries (no estimated/pricingSource) load as source=legacy', () => {
    const legacyFile = path.join(dir, 'usage.json');
    fs.writeFileSync(
      legacyFile,
      JSON.stringify({
        version: 1,
        entries: {
          'deepseek::deepseek-chat': {
            model: 'deepseek-chat', provider: 'deepseek',
            inputTokens: 10, outputTokens: 5, cacheReadTokens: 0,
            calls: 1, costUsd: 0.001, lastTs: '2026-01-01T00:00:00.000Z', events: 1,
          },
        },
        recent: [{ ts: '2026-01-01T00:00:00.000Z', provider: 'deepseek', model: 'deepseek-chat', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, costUsd: 0.001 }],
      }),
      'utf8',
    );
    const reopened = new UsageStore({ rootDir: dir, pricing: PRICING });
    const entry = reopened.byModel()[0]!;
    expect(entry.pricingSource).toBe('legacy');
    expect(entry.estimated).toBe(false);
    expect(reopened.totals().legacyEntries).toBe(1);
    expect(reopened.recent(1)[0]!.pricingSource).toBe('legacy');
  });
});
