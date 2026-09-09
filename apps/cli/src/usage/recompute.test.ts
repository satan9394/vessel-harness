import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageStore, localDateKey } from './UsageStore.js';
import { PricingOverrideStore } from './pricingOverride.js';
import type { PricingTable } from '../providers/pricing.js';

/**
 * task 091 — `vessel usage recompute`：按当前价目重算历史成本。
 *
 * 断言口径：保留 token 原始值，只重算 cost / estimated / pricingSource / 分项；
 * 幂等（同价目第二次零变更、不落盘）；dry-run 不写盘；重算结果 = 用新价目重新记录；
 * legacy 条目重算并标注。
 */

const OLD: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
    'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  protocols: { 'openai-compatible': { input: 0.5, output: 1.5, cacheRead: 0.1 } },
};

/** 调价后的价目：deepseek-chat 降价、claude-sonnet-4-5 涨价。 */
const NEW: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'deepseek-chat': { input: 0.14, output: 0.28, cacheRead: 0.03 },
    'claude-sonnet-4-5': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  },
  protocols: { 'openai-compatible': { input: 0.5, output: 1.5, cacheRead: 0.1 } },
};

function at(y: number, mo: number, d: number, h = 12, mi = 0): Date {
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

describe('091 — usage recompute', () => {
  let dir: string;
  let clock: { now: () => Date; set: (d: Date) => void };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-recompute-'));
    let current = at(2026, 3, 10);
    clock = { now: () => current, set: (d: Date) => { current = d; } };
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const file = (): string => path.join(dir, 'usage.json');
  const text = (): string => fs.readFileSync(file(), 'utf8');

  it('按当前价目重算历史条目成本，token/calls 原样保留', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    old.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 });
    const before = old.byModel()[0]!;
    expect(before.costUsd).toBeCloseTo(1.44, 9); // 0.27 + 1.1 + 0.07

    const store = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now });
    const res = store.recompute();
    expect(res.dryRun).toBe(false);
    expect(res.written).toBe(true);
    expect(res.entries).toMatchObject({ scanned: 1, changed: 1 });
    expect(res.entries.beforeUsd).toBeCloseTo(1.44, 9);
    expect(res.entries.afterUsd).toBeCloseTo(0.45, 9); // 0.14 + 0.28 + 0.03
    const after = store.byModel()[0]!;
    expect(after.inputTokens).toBe(1_000_000);
    expect(after.outputTokens).toBe(1_000_000);
    expect(after.cacheReadTokens).toBe(1_000_000);
    expect(after.calls).toBe(1);
    expect(after.events).toBe(1);
    expect(after.costUsd).toBeCloseTo(0.45, 9);
    expect(after.costBreakdown.inputUsd).toBeCloseTo(0.14, 9);
    expect(after.costBreakdown.cacheReadUsd).toBeCloseTo(0.03, 9);
    expect(after.pricingSource).toBe('model');
    expect(after.recomputedAt).toBeTruthy();
  });

  it('幂等：同一价目连跑两次 → 第二次零变更且文件逐字节不变', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    old.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    old.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 1_000_000 });

    const first = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now }).recompute();
    expect(first.changed).toBeGreaterThan(0);
    const snapshot = text();

    const second = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now }).recompute();
    expect(second.changed).toBe(0);
    expect(second.written).toBe(false);
    expect(second.entries.changed).toBe(0);
    expect(second.daily.changed).toBe(0);
    expect(second.recent.changed).toBe(0);
    expect(text()).toBe(snapshot);
  });

  it('dry-run 只出差异摘要、不落盘', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    old.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const snapshot = text();

    const store = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now });
    const dry = store.recompute({ dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.written).toBe(false);
    expect(dry.entries.changed).toBe(1);
    expect(dry.entries.deltaUsd).toBeCloseTo(0.42 - 1.37, 9);
    expect(dry.changes[0]).toMatchObject({ scope: 'entry', key: 'deepseek::deepseek-chat', beforeSource: 'model', afterSource: 'model' });
    expect(text()).toBe(snapshot); // 未落盘
    expect(store.byModel()[0]!.costUsd).toBeCloseTo(1.37, 9); // 内存也未改

    const real = store.recompute();
    expect(real.written).toBe(true);
    expect(text()).not.toBe(snapshot);
  });

  it('重算结果与「用新价目重新记录」一致（成本/分项/来源）', () => {
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-recompute-b-'));
    try {
      const tokens = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 200_000, cacheCreationTokens: 300_000 };
      const a = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
      a.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', ...tokens });
      a.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 250_000, outputTokens: 0 });
      new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now }).recompute();
      const recomputed = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now }).byModel()[0]!;

      const b = new UsageStore({ rootDir: dirB, pricing: NEW, now: clock.now });
      b.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', ...tokens });
      b.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 250_000, outputTokens: 0 });
      const fresh = b.byModel()[0]!;

      expect(recomputed.inputTokens).toBe(fresh.inputTokens);
      expect(recomputed.outputTokens).toBe(fresh.outputTokens);
      expect(recomputed.cacheReadTokens).toBe(fresh.cacheReadTokens);
      expect(recomputed.cacheCreationTokens).toBe(fresh.cacheCreationTokens);
      expect(recomputed.costUsd).toBeCloseTo(fresh.costUsd, 9);
      expect(recomputed.estimated).toBe(fresh.estimated);
      expect(recomputed.pricingSource).toBe(fresh.pricingSource);
      expect(recomputed.costBreakdown.inputUsd).toBeCloseTo(fresh.costBreakdown.inputUsd, 9);
      expect(recomputed.costBreakdown.outputUsd).toBeCloseTo(fresh.costBreakdown.outputUsd, 9);
      expect(recomputed.costBreakdown.cacheReadUsd).toBeCloseTo(fresh.costBreakdown.cacheReadUsd, 9);
      expect(recomputed.costBreakdown.cacheWriteUsd).toBeCloseTo(fresh.costBreakdown.cacheWriteUsd, 9);
      expect(recomputed.cacheWriteDerivedCostUsd).toBeCloseTo(fresh.cacheWriteDerivedCostUsd, 9);
    } finally {
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });

  it('legacy 条目（无 pricingSource）按当前规则重算并标注 recomputedFromLegacy', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      file(),
      JSON.stringify({
        version: 2,
        entries: {
          'deepseek::deepseek-chat': {
            model: 'deepseek-chat',
            provider: 'deepseek',
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            calls: 2,
            costUsd: 9.99, // 085 之前的旧数字（来源未知）
            costBreakdown: { inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0 },
            cacheWriteDerivedCostUsd: 0,
            cacheWriteDerived: false,
            estimated: true,
            estimatedCostUsd: 9.99,
            lastTs: at(2026, 3, 1).toISOString(),
            events: 2,
          },
        },
        recent: [],
        daily: {},
      }, null, 2),
      'utf8',
    );
    const store = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now });
    expect(store.byModel()[0]!.pricingSource).toBe('legacy');
    const res = store.recompute();
    expect(res.legacyRecomputed).toBe(1);
    const entry = store.byModel()[0]!;
    expect(entry.pricingSource).toBe('model');
    expect(entry.recomputedFromLegacy).toBe(true);
    expect(entry.costUsd).toBeCloseTo(0.42, 9); // 0.14 + 0.28
    expect(entry.estimated).toBe(false);
    expect(entry.estimatedCostUsd).toBe(0);
    // 重开仍是标注状态（落盘了）
    const reopened = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now }).byModel()[0]!;
    expect(reopened.recomputedFromLegacy).toBe(true);
    expect(reopened.pricingSource).toBe('model');
  });

  it('窗口 --since/--until：只重算窗口内的条目/日分桶/明细（本地日含首含尾）', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    clock.set(at(2026, 3, 1));
    old.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    clock.set(at(2026, 3, 5));
    old.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    clock.set(at(2026, 3, 9));
    old.record({ provider: 'deepseek', model: 'deepseek-reasoner', inputTokens: 1_000_000, outputTokens: 1_000_000 });

    const store = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now });
    const res = store.recompute({ since: '2026-03-04', until: '2026-03-06' });
    expect(res.entries.scanned).toBe(1); // 只有 claude 条目 lastTs 在窗口内
    expect(res.entries.changed).toBe(1);
    expect(res.daily.scanned).toBe(1);
    expect(res.recent.scanned).toBe(1);
    const byModel = Object.fromEntries(store.byModel().map((e) => [e.model, e]));
    expect(byModel['claude-sonnet-4-5']!.costUsd).toBeCloseTo(24, 9); // 4 + 20（重算过）
    expect(byModel['deepseek-chat']!.costUsd).toBeCloseTo(1.37, 9); // 窗口外，保持旧价
    expect(byModel['deepseek-reasoner']!.costUsd).toBeCloseTo(2, 9); // 未收录 → protocol 兜底价，窗口外
  });

  it('非法日期抛 RangeError（与 vessel usage 同一校验）', () => {
    const store = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now });
    expect(() => store.recompute({ since: '2026-13-01' })).toThrow(RangeError);
    expect(() => store.recompute({ until: '2026-02-30' })).toThrow(RangeError);
    expect(() => store.recompute({ since: '20260301' })).toThrow(RangeError);
  });

  it('日分桶按模型子分项精确重算；无子分项的旧分桶跳过并计数', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    clock.set(at(2026, 3, 2, 10));
    old.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    clock.set(at(2026, 3, 2, 18));
    old.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    // 注入一个 089 时代的旧分桶（无 models 子分项）
    const raw = JSON.parse(text()) as Record<string, unknown>;
    (raw.daily as Record<string, unknown>)['2026-02-20'] = {
      inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
      costUsd: 0.27, calls: 1, estimatedCostUsd: 0, cacheWriteDerivedCostUsd: 0,
      firstTs: at(2026, 2, 20).toISOString(), lastTs: at(2026, 2, 20).toISOString(),
    };
    fs.writeFileSync(file(), JSON.stringify(raw, null, 2), 'utf8');

    const store = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now });
    const res = store.recompute();
    expect(res.daily.scanned).toBe(2);
    expect(res.daily.changed).toBe(1);
    expect(res.dailySkipped).toBe(1);
    const rows = Object.fromEntries(store.daily().map((r) => [r.date, r]));
    expect(rows['2026-03-02']!.costUsd).toBeCloseTo(0.14 + 0.28 + 4 + 20, 9);
    expect(rows['2026-02-20']!.costUsd).toBeCloseTo(0.27, 9); // 旧分桶不猜、保持原值
    // 子分项同步重算
    expect(rows['2026-03-02']!.models?.['deepseek::deepseek-chat']?.costUsd).toBeCloseTo(0.42, 9);
    expect(rows['2026-03-02']!.models?.['anthropic::claude-sonnet-4-5']?.costUsd).toBeCloseTo(24, 9);
  });

  it('最近明细同步重算（单次记录 token/ts 齐全）', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    old.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const store = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now });
    const res = store.recompute();
    expect(res.recent).toMatchObject({ scanned: 1, changed: 1 });
    const rec = store.recent(1)[0]!;
    expect(rec.costUsd).toBeCloseTo(0.42, 9);
    expect(rec.pricingSource).toBe('model');
    expect(rec.inputTokens).toBe(1_000_000);
  });

  it('覆盖价参与重算：加覆盖后重算历史条目 → 按覆盖价（source=override）', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    old.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const override = new PricingOverrideStore({ rootDir: dir });
    override.set('deepseek-chat', { input: 0.01, output: 0.02 });
    const store = new UsageStore({ rootDir: dir, pricing: OLD, override: override.source(), now: clock.now });
    const res = store.recompute();
    expect(res.entries.changed).toBe(1);
    const entry = store.byModel()[0]!;
    expect(entry.pricingSource).toBe('override');
    expect(entry.costUsd).toBeCloseTo(0.03, 9);
  });

  it('strict 口径重算：未收录条目变 unpriced + 0 成本，token 仍在（待补价回填）', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    old.record({ provider: 'siliconflow', model: 'some-new-model', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(old.byModel()[0]!.pricingSource).toBe('protocol');
    const strictStore = new UsageStore({ rootDir: dir, pricing: OLD, strict: true, now: clock.now });
    const res = strictStore.recompute();
    expect(res.entries.changed).toBe(1);
    const entry = strictStore.byModel()[0]!;
    expect(entry.pricingSource).toBe('unpriced');
    expect(entry.costUsd).toBe(0);
    expect(entry.inputTokens).toBe(1_000_000);
    expect(entry.estimated).toBe(false);
  });

  it('空 store 重算不报错、不写盘', () => {
    const store = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now });
    const res = store.recompute();
    expect(res).toMatchObject({ changed: 0, written: false, dailySkipped: 0, legacyRecomputed: 0 });
    expect(fs.existsSync(file())).toBe(false);
  });

  it('估算条目重算后 estimated 与 estimatedCostUsd 同步更新', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    // deepseek-reasoner 不在表里 → protocol 兜底（estimated=true）
    old.record({ provider: 'openai-compatible', model: 'deepseek-reasoner', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(old.byModel()[0]!.estimated).toBe(true);
    const table: PricingTable = { models: { ...NEW.models, 'deepseek-reasoner': { input: 0.55, output: 2.19 } }, protocols: NEW.protocols };
    const store = new UsageStore({ rootDir: dir, pricing: table, now: clock.now });
    store.recompute();
    const entry = store.byModel()[0]!;
    expect(entry.pricingSource).toBe('model');
    expect(entry.estimated).toBe(false);
    expect(entry.estimatedCostUsd).toBe(0);
    expect(entry.costUsd).toBeCloseTo(2.74, 9);
  });

  it('窗口内无记录时不改动任何数据', () => {
    const old = new UsageStore({ rootDir: dir, pricing: OLD, now: clock.now });
    old.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 });
    const snapshot = text();
    const store = new UsageStore({ rootDir: dir, pricing: NEW, now: clock.now });
    const res = store.recompute({ since: '2026-01-01', until: '2026-01-31' });
    expect(res.changed).toBe(0);
    expect(res.entries.scanned).toBe(0);
    expect(text()).toBe(snapshot);
  });

  it('本地日键与记录日期一致（窗口筛选依据）', () => {
    expect(localDateKey(at(2026, 3, 10, 23, 59))).toBe('2026-03-10');
  });
});
