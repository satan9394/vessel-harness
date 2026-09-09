import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageStore, isLocalDateKey, localDateKey } from './UsageStore.js';
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

/** 本地时区构造时刻（跨日/日边界用例不依赖机器时区）。 */
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0): Date => new Date(y, m - 1, d, h, min, s);

describe('usage — 089 时间维度（本地日分桶 / 窗口 / 迁移）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-usage-day-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const storeAt = (clock: () => Date, pricing: PricingTable = PRICING): UsageStore =>
    new UsageStore({ rootDir: dir, pricing, now: clock });

  it('跨日聚合：同一模型落在不同本地日桶，累计总量并存', () => {
    let now = at(2026, 3, 1, 23, 30);
    const store = storeAt(() => now);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 });
    now = at(2026, 3, 2, 0, 30);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 2_000_000, outputTokens: 0 });

    const rows = store.daily();
    expect(rows.map((r) => r.date)).toEqual(['2026-03-01', '2026-03-02']);
    expect(rows[0]).toMatchObject({ inputTokens: 1_000_000, calls: 1 });
    expect(rows[1]).toMatchObject({ inputTokens: 2_000_000, calls: 1 });
    expect(rows[0]!.costUsd).toBeCloseTo(0.27, 6);
    expect(rows[1]!.costUsd).toBeCloseTo(0.54, 6);
    // 与累计总量并存（分桶不替代累计）
    expect(store.totals().inputTokens).toBe(3_000_000);
    expect(store.totals().calls).toBe(2);
    // 单条条目仍是一条（按 provider::model 聚合）
    expect(store.byModel()).toHaveLength(1);
    expect(store.byModel()[0]!.events).toBe(2);
  });

  it('日边界按本地时区切分（23:59:59 与次日 00:00:00 不同桶）', () => {
    let now = at(2026, 3, 1, 23, 59, 59);
    const store = storeAt(() => now);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1, outputTokens: 0 });
    now = at(2026, 3, 2, 0, 0, 0);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 2, outputTokens: 0 });
    expect(store.daily().map((r) => r.date)).toEqual(['2026-03-01', '2026-03-02']);
    expect(store.daily()[0]!.lastTs).toBe(at(2026, 3, 1, 23, 59, 59).toISOString());

    // 口径是**本地日**而不是 UTC 日：用本地时刻构造的日期必须归到本地日
    const edge = at(2026, 3, 1, 0, 30);
    expect(localDateKey(edge)).toBe('2026-03-01');
    const offsetMin = edge.getTimezoneOffset();
    // JS 语义：getTimezoneOffset() = UTC − 本地（分钟）。>0 = 本地在 UTC 西侧。
    if (offsetMin > 0) {
      // 西侧时区（如 UTC-5）：本地 23:30 的 UTC 日已跨到次日
      const late = at(2026, 3, 1, 23, 30);
      expect(localDateKey(late)).toBe('2026-03-01');
      expect(late.toISOString().slice(0, 10)).not.toBe('2026-03-01');
    } else if (offsetMin < 0) {
      // 东侧时区（如 UTC+8）：本地 00:30 的 UTC 日还在前一天
      expect(edge.toISOString().slice(0, 10)).not.toBe('2026-03-01');
    }
  });

  it('窗口过滤含首含尾；completeOnly 只留完整本地日', () => {
    let now = at(2026, 3, 1, 10, 0);
    const store = storeAt(() => now);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 });
    now = at(2026, 3, 2, 10, 0);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 2_000_000, outputTokens: 0 });
    now = at(2026, 3, 3, 10, 0); // 今天（未完整）
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 3_000_000, outputTokens: 0 });

    expect(store.daily({ since: '2026-03-02', until: '2026-03-03' }).map((r) => r.date)).toEqual(['2026-03-02', '2026-03-03']);
    expect(store.daily({ since: '2026-03-02', until: '2026-03-03', completeOnly: true }).map((r) => r.date)).toEqual(['2026-03-02']);
    expect(store.daily({ since: '2026-03-02' }).map((r) => r.date)).toEqual(['2026-03-02', '2026-03-03']);
    expect(store.daily({ until: '2026-03-01' }).map((r) => r.date)).toEqual(['2026-03-01']);
    expect(store.daily({ since: '2026-02-01', until: '2026-02-28' })).toEqual([]);
  });

  it('dailySummary 把完整本地日与未完整本地日分开合计（半天数据不混入）', () => {
    let now = at(2026, 3, 1, 10, 0);
    const store = storeAt(() => now);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 });
    now = at(2026, 3, 2, 10, 0);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 2_000_000, outputTokens: 0 });
    now = at(2026, 3, 3, 10, 0);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 3_000_000, outputTokens: 0 });

    const s = store.dailySummary({ since: '2026-03-01', until: '2026-03-03' });
    expect(s.rows).toHaveLength(3);
    expect(s.complete.days).toBe(2);
    expect(s.partial.days).toBe(1);
    expect(s.hasPartial).toBe(true);
    expect(s.complete.inputTokens).toBe(3_000_000);
    expect(s.complete.costUsd).toBeCloseTo(0.81, 6);
    expect(s.partial.inputTokens).toBe(3_000_000);
    expect(s.partial.costUsd).toBeCloseTo(0.81, 6);

    const onlyComplete = store.dailySummary({ since: '2026-03-01', until: '2026-03-02' });
    expect(onlyComplete.hasPartial).toBe(false);
    expect(onlyComplete.complete.days).toBe(2);
    expect(onlyComplete.partial.days).toBe(0);
  });

  it('非法日期被拒绝（RangeError / isLocalDateKey）', () => {
    const store = storeAt(() => at(2026, 3, 3, 10, 0));
    expect(() => store.daily({ since: '2026-13-01' })).toThrow(RangeError);
    expect(() => store.daily({ until: '2026-02-30' })).toThrow(RangeError);
    expect(() => store.daily({ since: '20260301' })).toThrow(RangeError);
    expect(isLocalDateKey('2026-02-28')).toBe(true);
    expect(isLocalDateKey('2026-02-30')).toBe(false);
    expect(isLocalDateKey('2026-2-8')).toBe(false);
  });

  it('旧文件（无 daily 字段）读入为 legacy 累计：不伪造历史分桶，新记录只落新日', () => {
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({
        version: 1,
        entries: {
          'deepseek::deepseek-chat': {
            model: 'deepseek-chat', provider: 'deepseek',
            inputTokens: 10, outputTokens: 5, cacheReadTokens: 0,
            calls: 1, costUsd: 0.001, lastTs: '2026-01-01T00:00:00.000Z', events: 1,
          },
        },
        recent: [],
      }),
      'utf8',
    );
    const clock = () => at(2026, 3, 10, 12, 0);
    const store = storeAt(clock);
    expect(store.totals().inputTokens).toBe(10);
    expect(store.migratedFromLegacy()).toBe(true);
    expect(store.hasDailyData()).toBe(false);
    expect(store.daily()).toEqual([]);
    expect(store.dailySummary().complete.days).toBe(0);
    // 旧条目没有分项：分项为 0，展示层单列（金额仍计入总额）
    expect(store.totals().entriesWithoutBreakdown).toBe(1);
    expect(store.totals().costBreakdown.inputUsd).toBe(0);
    expect(store.totals().costUsd).toBeCloseTo(0.001, 6);

    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 5, outputTokens: 0 });
    expect(store.daily().map((r) => r.date)).toEqual(['2026-03-10']); // 不伪造 2026-01-01 的桶
    expect(store.totals().inputTokens).toBe(15); // 累计继续累加
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8')) as {
      version: number;
      daily: Record<string, { calls: number }>;
    };
    expect(written.version).toBe(2);
    expect(Object.keys(written.daily)).toEqual(['2026-03-10']);
    expect(written.daily['2026-03-10']!.calls).toBe(1);
  });

  it('原子写保持：无 .tmp 残留，文件含 version 2 + daily 分桶，重开可读', () => {
    const clock = () => at(2026, 3, 10, 12, 0);
    const store = storeAt(clock);
    store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 });
    expect(fs.existsSync(path.join(dir, 'usage.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'usage.json.tmp'))).toBe(false);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8')) as {
      version: number;
      daily: Record<string, { inputTokens: number; calls: number; firstTs: string }>;
    };
    expect(written.version).toBe(2);
    expect(written.daily['2026-03-10']).toMatchObject({ inputTokens: 1_000_000, calls: 1 });
    expect(written.daily['2026-03-10']!.firstTs).toBe(at(2026, 3, 10, 12, 0).toISOString());

    const reopened = storeAt(clock);
    expect(reopened.daily()[0]).toMatchObject({ date: '2026-03-10', inputTokens: 1_000_000, calls: 1 });
    expect(reopened.migratedFromLegacy()).toBe(false);
    expect(reopened.hasDailyData()).toBe(true);
  });
});

describe('usage — 090 cache_creation 计价', () => {
  let dir: string;
  const CACHE_PRICING: PricingTable = {
    models: {
      default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
      'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    protocols: {},
  };
  /** 同价目但**缺 cacheWrite** → 走 input×1.25 推导。 */
  const DERIVED_PRICING: PricingTable = {
    models: {
      default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
      'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3 },
    },
    protocols: {},
  };
  /** 完全没有 cache 语义的价目行 → cache 写入按 0（不凭空加钱）。 */
  const NO_CACHE_PRICING: PricingTable = {
    models: { 'plain-model': { input: 1, output: 2 } },
    protocols: {},
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-usage-cache-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const storeWith = (pricing: PricingTable): UsageStore =>
    new UsageStore({ rootDir: dir, pricing, now: () => at(2026, 3, 10, 12, 0) });

  it('显式 cacheWrite：分项含 cache 写入，成本不再低估', () => {
    const store = storeWith(CACHE_PRICING);
    const withWrite = store.record({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    });
    expect(withWrite.source).toBe('model');
    expect(withWrite.cacheWritePriceSource).toBe('explicit');
    expect(withWrite.breakdown.inputUsd).toBeCloseTo(3, 6);
    expect(withWrite.breakdown.outputUsd).toBeCloseTo(15, 6);
    expect(withWrite.breakdown.cacheReadUsd).toBeCloseTo(0.3, 6);
    expect(withWrite.breakdown.cacheWriteUsd).toBeCloseTo(3.75, 6);
    expect(withWrite.costUsd).toBeCloseTo(22.05, 6);

    const withoutWrite = store.record({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    expect(withoutWrite.costUsd).toBeCloseTo(18.3, 6);
    expect(withWrite.costUsd).toBeGreaterThan(withoutWrite.costUsd); // 旧口径低估

    const entry = store.byModel()[0]!;
    expect(entry.cacheCreationTokens).toBe(1_000_000);
    expect(entry.costBreakdown.cacheWriteUsd).toBeCloseTo(3.75, 6);
    expect(entry.cacheWriteDerived).toBe(false);
    expect(entry.cacheWriteDerivedCostUsd).toBe(0);
    const t = store.totals();
    expect(t.cacheCreationTokens).toBe(1_000_000);
    expect(t.costBreakdown.cacheWriteUsd).toBeCloseTo(3.75, 6);
    expect(t.costUsd).toBeCloseTo(22.05 + 18.3, 6);
    expect(store.recent(1)[0]!.cacheCreationTokens).toBe(0); // 最后一条没有 cache 写入
  });

  it('缺 cacheWrite 字段 → input×1.25 推导并标记 cacheWriteDerived', () => {
    const store = storeWith(DERIVED_PRICING);
    const res = store.record({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
    });
    expect(res.cacheWritePriceSource).toBe('derived');
    expect(res.breakdown.cacheWriteUsd).toBeCloseTo(3.75, 6);
    expect(res.costUsd).toBeCloseTo(3.75, 6);
    const entry = store.byModel()[0]!;
    expect(entry.cacheWriteDerived).toBe(true);
    expect(entry.cacheWriteDerivedCostUsd).toBeCloseTo(3.75, 6);
    expect(store.totals().cacheWriteDerivedCostUsd).toBeCloseTo(3.75, 6);
    // 分桶同样记录推导金额
    const row = store.daily()[0]!;
    expect(row.cacheCreationTokens).toBe(1_000_000);
    expect(row.cacheWriteDerivedCostUsd).toBeCloseTo(3.75, 6);
    // 持久化保留推导标记（重开后可解释金额来源）
    const reopened = storeWith(DERIVED_PRICING);
    expect(reopened.byModel()[0]!.cacheWriteDerived).toBe(true);
    expect(reopened.totals().cacheWriteDerivedCostUsd).toBeCloseTo(3.75, 6);
  });

  it('价目行无 cache 语义 → absent，cache 写入按 0 计价', () => {
    const store = storeWith(NO_CACHE_PRICING);
    const res = store.record({
      provider: 'x',
      model: 'plain-model',
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
    });
    expect(res.cacheWritePriceSource).toBe('absent');
    expect(res.breakdown.cacheWriteUsd).toBe(0);
    expect(res.costUsd).toBe(0);
    expect(store.totals().cacheWriteDerivedCostUsd).toBe(0);
  });

  it('未上报 cache 写入 token 时成本与 089 口径一致（向后兼容）', () => {
    const store = storeWith(CACHE_PRICING);
    const a = store.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 1_000_000, outputTokens: 500_000 });
    const b = store.record({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheCreationTokens: 0,
    });
    expect(b.costUsd).toBeCloseTo(a.costUsd, 10);
    expect(store.totals().cacheCreationTokens).toBe(0);
  });
});
