import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageStore } from './UsageStore.js';
import { PricingOverrideStore, sameTokenPrice } from './pricingOverride.js';
import { createOverridePriceSource, type PricingTable, type TokenPrice } from '../providers/pricing.js';

/**
 * task 092 — 用户价目覆盖（`~/.vessel/pricing.override.json`）+ 值守卫式修复。
 *
 * 覆盖文件与内置 `configs/pricing.json` 分离：内置更新不冲用户覆盖；
 * 删除墓碑让「显式删除内置条目」成为一等操作；值守卫修复只改「现值仍等于旧值」的行。
 */

const BUILTIN: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
    'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  },
  protocols: { 'openai-compatible': { input: 0.5, output: 1.5, cacheRead: 0.1 } },
};

/** 模拟「下一个版本改了内置价」——用于验证内置更新不冲用户覆盖。 */
const BUILTIN_UPDATED: PricingTable = {
  models: {
    ...BUILTIN.models,
    'deepseek-chat': { input: 0.99, output: 9.9, cacheRead: 0.9 },
    'claude-sonnet-4-5': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  },
  protocols: BUILTIN.protocols,
};

const SONNET: TokenPrice = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

describe('092 — 用户价目覆盖文件', () => {
  let dir: string;
  let store: PricingOverrideStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-override-'));
    store = new PricingOverrideStore({ rootDir: dir });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('set 落盘 pricing.override.json，重开可读（原子写、无 .tmp 残留）', () => {
    store.set('deepseek-chat', { input: 0.1, output: 0.2, cacheRead: 0.01 });
    expect(store.file).toBe(path.join(dir, 'pricing.override.json'));
    expect(fs.existsSync(store.file)).toBe(true);
    expect(fs.existsSync(`${store.file}.tmp`)).toBe(false);
    const reopened = new PricingOverrideStore({ rootDir: dir });
    expect(reopened.get('deepseek-chat')).toEqual({ input: 0.1, output: 0.2, cacheRead: 0.01 });
    expect(reopened.tombstones()).toEqual([]);
  });

  it('覆盖生效：resolvePrice 走 override（estimated=false），优先级高于内置', () => {
    store.set('claude-sonnet-4-5', { input: 1, output: 2, cacheRead: 0.1 });
    const source = store.source();
    const hit = source.findMatch?.('claude-sonnet-4-5', 'anthropic');
    expect(hit).toMatchObject({ key: 'claude-sonnet-4-5', exact: true, scoped: false });
    expect(hit?.price.input).toBe(1);
    // provider::model 作用域键
    store.set('anthropic::claude-sonnet-4-5', { input: 2, output: 4 });
    expect(store.source().findMatch?.('claude-sonnet-4-5', 'anthropic')?.price.input).toBe(2);
    expect(store.source().findMatch?.('claude-sonnet-4-5', 'other')?.price.input).toBe(1);
  });

  it('删除墓碑：显式删除内置条目后按 0 计价且不回退；restore 可撤销', () => {
    store.set('deepseek-chat', { input: 0.1, output: 0.2 });
    store.tombstone('deepseek-chat');
    const file = store.read();
    expect(file.deleted).toEqual(['deepseek-chat']);
    expect(file.models['deepseek-chat']).toBeUndefined(); // 覆盖与墓碑互斥
    const source = store.source();
    expect(source.findDeleted?.('deepseek-chat')).toBe('deepseek-chat');
    expect(store.restore('deepseek-chat')).toBe(true);
    expect(store.source().findDeleted?.('deepseek-chat')).toBeUndefined();
    expect(store.restore('deepseek-chat')).toBe(false); // 已无墓碑 → 无改动
  });

  it('值守卫式修复：仅当现值 = 旧值才改（用户手改过的行不动、缺失键不新建）', () => {
    store.set('claude-sonnet-4-5', SONNET);
    store.set('deepseek-chat', { input: 0.5, output: 5 }); // 用户手改过的价（≠ 旧内置值）
    const outcomes = store.repair([
      { key: 'claude-sonnet-4-5', from: SONNET, to: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 } },
      { key: 'deepseek-chat', from: { input: 0.27, output: 1.1, cacheRead: 0.07 }, to: { input: 0.99, output: 9.9 } },
      { key: 'gpt-4o', from: { input: 2.5, output: 10 }, to: { input: 3, output: 12 } },
    ]);
    expect(outcomes.map((o) => [o.key, o.status])).toEqual([
      ['claude-sonnet-4-5', 'applied'],
      ['deepseek-chat', 'skipped-user-modified'],
      ['gpt-4o', 'skipped-absent'],
    ]);
    expect(store.get('claude-sonnet-4-5')).toEqual({ input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 });
    expect(store.get('deepseek-chat')).toEqual({ input: 0.5, output: 5 }); // 手改值被保住
    expect(store.get('gpt-4o')).toBeUndefined(); // 修复不新建条目
  });

  it('值守卫修复无一条生效时不写文件（内容逐字节不变）', () => {
    store.set('claude-sonnet-4-5', { input: 1, output: 2 });
    const before = fs.readFileSync(store.file, 'utf8');
    const outcomes = store.repair([{ key: 'claude-sonnet-4-5', from: SONNET, to: { input: 9, output: 9 } }]);
    expect(outcomes[0]?.status).toBe('skipped-user-modified');
    expect(fs.readFileSync(store.file, 'utf8')).toBe(before);
  });

  it('文件缺失 / JSON 损坏 / 非法行 → 空覆盖，不抛错、不猜价', () => {
    expect(new PricingOverrideStore({ rootDir: path.join(dir, 'nope') }).read()).toEqual({ version: 1, models: {}, deleted: [] });
    fs.writeFileSync(store.file, '{not json', 'utf8');
    expect(store.read().models).toEqual({});
    fs.writeFileSync(
      store.file,
      JSON.stringify({
        version: 1,
        models: {
          ok: { input: 1, output: 2 },
          bad: { input: 'x', output: 2 },
          negative: { input: -1, output: 1 },
          '': { input: 1, output: 1 },
        },
        deleted: ['gone', 42, ''],
      }),
      'utf8',
    );
    expect(Object.keys(store.read().models)).toEqual(['ok']);
    expect(store.read().deleted).toEqual(['gone']);
  });

  it('set 非法单价抛 RangeError 且不落盘', () => {
    expect(() => store.set('x', { input: -1, output: 1 })).toThrow(RangeError);
    expect(() => store.set('x', { input: 1, output: Number.NaN })).toThrow(RangeError);
    expect(() => store.set('', { input: 1, output: 1 })).toThrow(RangeError);
    expect(fs.existsSync(store.file)).toBe(false);
  });

  it('sameTokenPrice：undefined 与缺失等价（值守卫比较用）', () => {
    expect(sameTokenPrice({ input: 1, output: 2 }, { input: 1, output: 2 })).toBe(true);
    expect(sameTokenPrice({ input: 1, output: 2, cacheRead: 0.1 }, { input: 1, output: 2 })).toBe(false);
    expect(sameTokenPrice(undefined, undefined)).toBe(true);
    expect(sameTokenPrice({ input: 1, output: 2 }, undefined)).toBe(false);
  });
});

describe('092 — 覆盖接入 UsageStore（记录与内置更新）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-override-usage-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('记录时覆盖价生效：source=override、成本按覆盖价、estimated=false', () => {
    const override = new PricingOverrideStore({ rootDir: dir });
    override.set('claude-sonnet-4-5', { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 });
    const store = new UsageStore({ rootDir: dir, pricing: BUILTIN, override: override.source() });
    const res = store.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(res.source).toBe('override');
    expect(res.estimated).toBe(false);
    expect(res.costUsd).toBeCloseTo(3, 9); // 1 + 2（覆盖价），而不是内置 3 + 15
    expect(store.byModel()[0]?.pricingSource).toBe('override');
  });

  it('删除墓碑接入记录：成本 0、source=unpriced、token 原样保留（待日后补价回填）', () => {
    const override = new PricingOverrideStore({ rootDir: dir });
    override.tombstone('deepseek-chat');
    const store = new UsageStore({ rootDir: dir, pricing: BUILTIN, override: override.source() });
    const res = store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(res).toMatchObject({ source: 'unpriced', estimated: false, costUsd: 0 });
    const entry = store.byModel()[0]!;
    expect(entry.inputTokens).toBe(1_000_000);
    expect(entry.outputTokens).toBe(1_000_000);
    expect(entry.calls).toBe(1);
  });

  it('内置价目更新不冲用户覆盖：同一覆盖文件 + 新版内置表 → 仍用覆盖价', () => {
    const override = new PricingOverrideStore({ rootDir: dir });
    override.set('deepseek-chat', { input: 0.1, output: 0.2 });
    const before = new UsageStore({ rootDir: dir, pricing: BUILTIN, override: override.source() });
    const r1 = before.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    // 模拟升级到新内置价目（deepseek-chat 内置价翻了近 4 倍）
    const after = new UsageStore({ rootDir: dir, pricing: BUILTIN_UPDATED, override: override.source() });
    const r2 = after.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(r1.source).toBe('override');
    expect(r2.source).toBe('override');
    expect(r2.costUsd).toBeCloseTo(0.3, 9); // 覆盖价 0.1 + 0.2，不受内置更新影响
    // 未被覆盖的模型按新版内置价走
    const sonnet = after.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(sonnet.source).toBe('model');
    expect(sonnet.costUsd).toBeCloseTo(24, 9); // 新版 4 + 20
  });

  it('strict 模式下覆盖仍生效（覆盖是用户对该模型的专属价）', () => {
    const override = new PricingOverrideStore({ rootDir: dir });
    override.set('claude-sonnet-4-5', { input: 1, output: 1 });
    const store = new UsageStore({ rootDir: dir, pricing: BUILTIN, override: override.source(), strict: true });
    expect(store.record({ provider: 'anthropic', model: 'claude-sonnet-4-5', inputTokens: 1_000_000, outputTokens: 0 }).source).toBe('override');
    // 未收录模型在 strict 下仍是 unpriced（覆盖不影响其他模型）
    expect(store.record({ provider: 'x', model: 'zzz-unknown', inputTokens: 1_000_000, outputTokens: 0 }).source).toBe('unpriced');
  });

  it('createOverridePriceSource 直接构造（无文件）也能驱动查价', () => {
    const source = createOverridePriceSource({ models: { 'deepseek-chat': { input: 0.01, output: 0.02 } }, deleted: ['mock'] });
    const store = new UsageStore({ rootDir: dir, pricing: BUILTIN, override: source });
    expect(store.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 0 }).costUsd).toBeCloseTo(0.01, 9);
  });
});
