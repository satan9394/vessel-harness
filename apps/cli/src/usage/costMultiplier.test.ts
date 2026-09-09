import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UsageStore } from './UsageStore.js';
import { PricingOverrideStore } from './pricingOverride.js';
import {
  assertCostMultiplier,
  createCatalogPriceSource,
  costBreakdown,
  DEFAULT_COST_MULTIPLIER,
  type CatalogPriceSource,
  type OverridePriceSource,
  type PricingTable,
} from '../providers/pricing.js';

/**
 * task 094 — provider 成本倍率：**只乘总额**（分项单价不变）。
 *
 * 倍率用于中转/代理加价：`总额 = 分项合计 × 倍率`，input/output/cacheRead/cacheWrite
 * 的每 1M tokens 价一律不动，`vessel usage` 用 `rawCostUsd` 把这层关系显式写出来。
 */

const TABLE: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'proxy-model': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
  },
  protocols: {},
};

/** 1M input + 1M output @ $1/$2 → 分项合计 $3。 */
const TOKENS = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

describe('094 — 成本倍率只乘总额（UsageStore）', () => {
  let dir: string;
  let store: UsageStore;

  const makeStore = (opts: {
    multiplierOf?: (provider: string) => number;
    override?: OverridePriceSource;
    catalog?: CatalogPriceSource;
  } = {}): UsageStore =>
    new UsageStore({ rootDir: dir, pricing: TABLE, ...opts });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mult-'));
    store = makeStore({ multiplierOf: (p) => (p === 'proxy' ? 2 : DEFAULT_COST_MULTIPLIER) });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('倍率生效：分项单价不变，只有总额 ×2，条目落 costMultiplier', () => {
    const r = store.record({ provider: 'proxy', model: 'proxy-model', ...TOKENS });
    expect(r.breakdown.inputUsd).toBeCloseTo(1, 12);
    expect(r.breakdown.outputUsd).toBeCloseTo(2, 12);
    expect(r.breakdown.rawTotalUsd).toBeCloseTo(3, 12);
    expect(r.breakdown.costMultiplier).toBe(2);
    expect(r.breakdown.totalUsd).toBeCloseTo(6, 12);
    expect(r.costUsd).toBeCloseTo(6, 12);

    const entry = store.entries()['proxy::proxy-model']!;
    expect(entry.costUsd).toBeCloseTo(6, 12);
    expect(entry.costBreakdown.inputUsd).toBeCloseTo(1, 12); // 分项没被乘
    expect(entry.costBreakdown.outputUsd).toBeCloseTo(2, 12);
    expect(entry.costMultiplier).toBe(2);
    expect(entry.costMultiplierMixed).toBeUndefined();

    // 日分桶同样只乘总额
    const day = store.daily()[0]!;
    expect(day.costUsd).toBeCloseTo(6, 12);

    // 未设倍率的 provider 不受影响（同一份价目、同一 token）
    store.record({ provider: 'plain', model: 'proxy-model', ...TOKENS });
    expect(store.entries()['plain::proxy-model']!.costUsd).toBeCloseTo(3, 12);
    expect(store.entries()['plain::proxy-model']!.costMultiplier).toBeUndefined();

    // 总额 = 分项合计 × 倍率（可解释）
    const t = store.totals();
    expect(t.costUsd).toBeCloseTo(9, 12);
    expect(t.rawCostUsd).toBeCloseTo(6, 12);
    expect(t.multipliedEntries).toBe(1);
  });

  it('默认倍率 1：不设 multiplierOf 时总额 = 分项合计，条目无倍率字段', () => {
    const plain = makeStore();
    const r = plain.record({ provider: 'plain', model: 'proxy-model', ...TOKENS });
    expect(r.costUsd).toBeCloseTo(3, 12);
    expect(r.breakdown.costMultiplier).toBe(DEFAULT_COST_MULTIPLIER);
    expect(r.breakdown.totalUsd).toBeCloseTo(r.breakdown.rawTotalUsd, 12);
    const entry = plain.entries()['plain::proxy-model']!;
    expect(entry.costMultiplier).toBeUndefined();
    expect(entry.costMultiplierMixed).toBeUndefined();
    expect(plain.totals().multipliedEntries).toBe(0);
  });

  it('非法倍率 fail loud（<0 / NaN / 非数字），且不落盘半成品', () => {
    const negative = makeStore({ multiplierOf: () => -1 });
    expect(() => negative.record({ provider: 'proxy', model: 'proxy-model', ...TOKENS })).toThrow(RangeError);
    expect(fs.existsSync(path.join(dir, 'usage.json'))).toBe(false);

    const nan = makeStore({ multiplierOf: () => Number.NaN });
    expect(() => nan.record({ provider: 'proxy', model: 'proxy-model', ...TOKENS })).toThrow(/必须是非负有限数字/);

    const notNumber = makeStore({ multiplierOf: () => '2' as unknown as number });
    expect(() => notNumber.record({ provider: 'proxy', model: 'proxy-model', ...TOKENS })).toThrow(RangeError);

    // 共享层同样 fail loud（唯一实现，别处不会各写一套）
    expect(() => costBreakdown(TABLE.models['proxy-model']!, TOKENS, { costMultiplier: -0.5 })).toThrow(RangeError);
    expect(() => costBreakdown(TABLE.models['proxy-model']!, TOKENS, { costMultiplier: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => assertCostMultiplier('1.5')).toThrow(RangeError);
    expect(assertCostMultiplier(0)).toBe(0); // 0 合法（免计费），负数才非法
  });

  it('与 override / catalog 共存：倍率乘在最终价之上，来源不变', () => {
    const override = new PricingOverrideStore({ rootDir: dir });
    override.set('proxy-model', { input: 10, output: 20 }); // 覆盖价
    const withOverride = makeStore({ multiplierOf: () => 3, override: override.source() });
    const r1 = withOverride.record({ provider: 'proxy', model: 'proxy-model', ...TOKENS });
    expect(r1.source).toBe('override');
    expect(r1.breakdown.rawTotalUsd).toBeCloseTo(30, 12); // 10 + 20
    expect(r1.costUsd).toBeCloseTo(90, 12); // ×3

    // catalog 价 + 倍率
    const catalog = createCatalogPriceSource([{ model: 'cat-model', priceIn: 2, priceOut: 4 }], {
      idOf: (m) => m.model,
      priceOf: (m) => (m.priceIn == null ? undefined : { input: m.priceIn, output: m.priceOut ?? 0 }),
    });
    const withCatalog = makeStore({ multiplierOf: () => 1.5, catalog });
    const r2 = withCatalog.record({ provider: 'proxy', model: 'cat-model', ...TOKENS });
    expect(r2.source).toBe('catalog');
    expect(r2.breakdown.rawTotalUsd).toBeCloseTo(6, 12);
    expect(r2.costUsd).toBeCloseTo(9, 12);

    // 内置价 + 倍率（同一入口，回退链不变）
    const r3 = withCatalog.record({ provider: 'proxy', model: 'proxy-model', ...TOKENS });
    expect(r3.source).toBe('model');
    expect(r3.costUsd).toBeCloseTo(4.5, 12); // (1+2) × 1.5
  });

  it('recompute 幂等；倍率变化后重算按新倍率收敛（并清掉 mixed 痕迹）', () => {
    store.record({ provider: 'proxy', model: 'proxy-model', ...TOKENS });
    const first = store.recompute();
    expect(first.changed).toBe(0);
    expect(first.written).toBe(false); // 同倍率幂等

    // 独立目录：同一 provider 中途改倍率 1 → 2 → 标 mixed（不假装唯一）
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mult-mixed-'));
    try {
      const m1 = new UsageStore({ rootDir: dir2, pricing: TABLE, multiplierOf: () => 1 });
      m1.record({ provider: 'proxy', model: 'proxy-model', ...TOKENS }); // $3（无倍率）
      const m2 = new UsageStore({ rootDir: dir2, pricing: TABLE, multiplierOf: () => 2 });
      m2.record({ provider: 'proxy', model: 'proxy-model', ...TOKENS }); // +$6
      const mixed = m2.entries()['proxy::proxy-model']!;
      expect(mixed.costMultiplier).toBeUndefined();
      expect(mixed.costMultiplierMixed).toBe(true);
      expect(mixed.costUsd).toBeCloseTo(3 + 6, 12);

      // 重算 = 用当前倍率重新记录 → 统一为 2，mixed 痕迹清掉
      const rec = m2.recompute();
      expect(rec.changed).toBeGreaterThan(0);
      const after = m2.entries()['proxy::proxy-model']!;
      expect(after.costMultiplier).toBe(2);
      expect(after.costMultiplierMixed).toBeUndefined();
      expect(after.costUsd).toBeCloseTo(12, 12); // 2M in + 2M out = $6 分项合计 × 2
      expect(after.costBreakdown.inputUsd).toBeCloseTo(2, 12); // 分项未乘
      expect(after.inputTokens).toBe(2_000_000); // token 原样

      // byProvider 报告分项合计与倍率，用于解释「总额 = 分项合计 × 倍率」
      const row = m2.byProvider().find((p) => p.provider === 'proxy')!;
      expect(row.costMultiplier).toBe(2);
      expect(row.costMultiplierMixed).toBe(false);
      expect(row.costUsd).toBeCloseTo(row.rawCostUsd * 2, 12);
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});
