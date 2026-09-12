import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageStore } from './UsageStore.js';
import { PricingOverrideStore, sameTokenPrice } from './pricingOverride.js';
import { createOverridePriceSource, type PricingTable, type TokenPrice } from '../providers/pricing.js';

// 注入「留档改名失败」用 `vi.mock('node:fs')` 而非 `vi.spyOn(fs, 'renameSync')`：node:fs 的
// ESM 命名空间导出 non-configurable，vitest 2.x 下 spyOn 会报 "Cannot redefine property"
// （同 packages/application/src/project/ProjectRegistry.recovery.test.ts 与
// apps/cli/src/usage/UsageStore.recovery.test.ts 的注释与写法）。这里默认**原样委托**真实实现，
// 只有 `denyRename` 谓词命中（留档目标名含 `.corrupted-`）时才抛 EPERM —— 原子写的
// `renameWithRetry(tmp, pricing.override.json)` 目标名不含 `.corrupted-`，不受影响。
//
// 刻意用**普通函数**而非 `vi.fn()`：`vi.restoreAllMocks()` 会遍历全局 mock 集合并重置其实现，
// 用 `vi.fn` 会被连带打掉；普通函数不在该集合内。
const fsHooks = vi.hoisted(() => ({ denyRename: null as null | ((dest: unknown) => boolean) }));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    renameSync: (oldPath: fs.PathLike, newPath: fs.PathLike): void => {
      if (fsHooks.denyRename?.(newPath)) {
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
      }
      actual.renameSync(oldPath, newPath);
    },
  };
});

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

/**
 * 本卡修复（092 补丁）——**「读不到」不得静默变成「没有覆盖」**。
 *
 * 旧实现：文件不可读 / JSON 损坏 → 静默 `emptyFile()`（0 条 warn）。后果是花钱的两件事同时
 * 无提示发生：① 用户自定义单价失效；② **删除墓碑一并丢失 → 被显式删掉的模型按原价重新计费**。
 * 新实现：`readWithStatus()` 三态（`missing` / `unreadable` / `corrupt`，都区别于 `ok`），
 * 异常与损坏路径**一定**打一条含「路径 + 原因 + 后果 + 恢复指引」的 warn；`read()` 形状与
 * 「不抛错」契约不变。
 */
describe('092 补丁 — 覆盖文件损坏/不可读必须可见（不得静默降级为无覆盖）', () => {
  let dir: string;
  let store: PricingOverrideStore;
  let warns: string[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-override-broken-'));
    store = new PricingOverrideStore({ rootDir: dir });
    warns = [];
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warns.push(a.map((x) => String(x)).join(' '));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('判别性主例：合法墓碑在损坏后不得被静默丢弃——status=corrupt 且 warn 含路径/原因/后果/恢复', () => {
    store.set('deepseek-chat', { input: 0.1, output: 0.2 });
    store.tombstone('deepseek-chat');
    expect(store.tombstones()).toEqual(['deepseek-chat']); // 健康：墓碑在
    expect(warns).toHaveLength(0); // 负对照：健康文件零噪音

    fs.writeFileSync(store.file, '{ broken', 'utf8'); // 磁盘上只剩半截 JSON
    expect(() => store.tombstones()).not.toThrow(); // 不抛错：命令照常可跑
    const read = store.readWithStatus();
    expect(read.status).toBe('corrupt');
    expect(read.deleted).toEqual([]); // 数据确实拿不回来（本卡刻意不引入缓存）
    expect(read.models).toEqual({});
    expect(read.error).toContain('JSON 解析失败');

    // ↓↓↓ 本卡的核心判别点：删掉告警（改回静默 emptyFile()）→ 这一组断言全红 ↓↓↓
    expect(warns.length).toBeGreaterThanOrEqual(1);
    const text = warns.join('\n');
    expect(text).toContain(store.file); // 路径（可直接去备份）
    expect(text).toContain('JSON 解析失败'); // 原因
    expect(text).toContain('删除墓碑一并丢失'); // 后果①（墓碑）
    expect(text).toContain('重新计费'); // 后果②（钱）
    expect(text).toContain('.bak'); // 恢复指引

    // `read()` 的对外形状逐字不变（既有 `toEqual` 断言依赖）
    expect(store.read()).toEqual({ version: 1, models: {}, deleted: [] });
  });

  it('不可读（非 ENOENT：路径被目录占住）→ status=unreadable 且同样告警', () => {
    const dirStore = new PricingOverrideStore({ rootDir: path.join(dir, 'as-dir') });
    // 用目录占住覆盖文件路径：readFileSync 必然失败，且 errno 不是 ENOENT（Node 在 Windows/macOS/Linux 上给 EISDIR）
    fs.mkdirSync(dirStore.file, { recursive: true });

    const read = dirStore.readWithStatus();
    expect(read.status).toBe('unreadable');
    expect(read.models).toEqual({});
    expect(read.deleted).toEqual([]);
    expect(read.error).toBeDefined();
    expect(read.error ?? '').not.toContain('ENOENT'); // 关键：**不是**「文件不存在」，不能当首次运行处理
    expect(warns).toHaveLength(1);
    expect(warns.join('\n')).toContain(dirStore.file);
    expect(warns.join('\n')).toContain('读不到');
    expect(warns.join('\n')).toContain('.bak');
    expect(() => dirStore.source()).not.toThrow(); // 仍不抛错
  });

  it('负对照：文件不存在（ENOENT）→ missing、空覆盖、0 条 warn（首次运行不该吵）', () => {
    const fresh = new PricingOverrideStore({ rootDir: path.join(dir, 'nope') });
    const read = fresh.readWithStatus();
    expect(read.status).toBe('missing');
    expect(read.error).toBeUndefined();
    expect(fresh.read()).toEqual({ version: 1, models: {}, deleted: [] });
    expect(fresh.tombstones()).toEqual([]);
    expect(fresh.entries()).toEqual([]);
    expect(warns).toHaveLength(0);
  });

  it('负对照：合法文件（含墓碑）→ ok、0 条 warn', () => {
    store.set('deepseek-chat', { input: 0.1, output: 0.2 });
    store.tombstone('gone-model');
    expect(store.readWithStatus().status).toBe('ok');
    expect(store.readWithStatus().deleted).toEqual(['gone-model']);
    expect(store.tombstones()).toEqual(['gone-model']);
    expect(warns).toHaveLength(0);
  });

  it('结构非法：顶层非对象 / models 非对象 / deleted 非数组 → 一律 corrupt + 告警', () => {
    const cases: { text: string; needle: string }[] = [
      { text: '[]', needle: '顶层不是 JSON 对象' },
      { text: '"x"', needle: '顶层不是 JSON 对象' },
      { text: 'null', needle: '顶层不是 JSON 对象' },
      { text: JSON.stringify({ version: 1, models: 'nope' }), needle: '字段 models 结构非法' },
      { text: JSON.stringify({ version: 1, models: [] }), needle: '字段 models 结构非法' },
      { text: JSON.stringify({ version: 1, models: null }), needle: '字段 models 结构非法' },
      { text: JSON.stringify({ version: 1, deleted: 'x' }), needle: '字段 deleted 结构非法' },
      { text: JSON.stringify({ version: 1, deleted: 42 }), needle: '字段 deleted 结构非法' },
    ];
    for (const c of cases) {
      fs.writeFileSync(store.file, c.text, 'utf8');
      // 每种结构各用一个新实例：告警去重是**按实例**的（否则同名原因会被去重吞掉，测不出「每条都要说」）
      const s = new PricingOverrideStore({ rootDir: dir });
      const before = warns.length;
      const read = s.readWithStatus();
      expect(read.status, c.text).toBe('corrupt');
      expect(read.error ?? '', c.text).toContain(c.needle);
      expect(read.models).toEqual({});
      expect(read.deleted).toEqual([]);
      expect(warns.length, c.text).toBeGreaterThan(before);
      expect(warns.join('\n')).toContain(store.file);
    }
  });

  it('边界（刻意沿用 modelCatalog 的 empty 语义）：缺 models/deleted 的顶层对象按空覆盖、不算损坏、不告警', () => {
    fs.writeFileSync(store.file, JSON.stringify({ version: 1 }), 'utf8');
    const read = store.readWithStatus();
    expect(read.status).toBe('ok');
    expect(store.read()).toEqual({ version: 1, models: {}, deleted: [] });
    expect(warns).toHaveLength(0);
  });

  it('同一次损坏重复读只打一条 warn（不刷屏）；健康读之后再次损坏会重新告警', () => {
    fs.writeFileSync(store.file, '{ broken', 'utf8');
    store.read();
    store.readWithStatus();
    store.tombstones();
    store.entries();
    store.get('x');
    store.source();
    expect(warns).toHaveLength(1); // 6 次读 → 1 条（同实例同签名去重）

    store.set('deepseek-chat', { input: 0.1, output: 0.2 }); // 写盘路径不变：仍能写（覆盖掉损坏内容）
    store.read(); // 健康读 → 复位告警签名
    expect(warns).toHaveLength(1);

    fs.writeFileSync(store.file, '{ broken', 'utf8');
    store.read();
    expect(warns).toHaveLength(2);
  });

  it('损坏后的真实代价（warn 必须可见的那笔钱）：墓碑丢失 → 被删模型按内置价重新计费', () => {
    store.tombstone('deepseek-chat');
    const healthy = new UsageStore({ rootDir: dir, pricing: BUILTIN, override: store.source() });
    expect(
      healthy.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toMatchObject({ source: 'unpriced', costUsd: 0 }); // 墓碑生效：按 0 计价、不回退
    expect(warns).toHaveLength(0); // 负对照：健康墓碑零噪音

    fs.writeFileSync(store.file, '{ broken', 'utf8');
    const broken = new UsageStore({ rootDir: dir, pricing: BUILTIN, override: store.source() });
    const res = broken.record({ provider: 'deepseek', model: 'deepseek-chat', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(res.costUsd).toBeCloseTo(1.37, 9); // 0.27 + 1.1 ← 重新计费（数据上救不回来）
    expect(warns.length).toBeGreaterThanOrEqual(1); // 但**不再静默**：这正是本卡要买回来的东西
    expect(warns.join('\n')).toContain(store.file);
  });
});

/**
 * 092 补丁 2（本卡）——**损坏的覆盖文件在写盘前必须留档**。
 *
 * 残留缺陷：上一张卡只修了「读」没修「写」——`readWithStatus()` 会告警，但 `set/delete/restore/repair`
 * 仍会用「空覆盖 + 新条目」重写磁盘，把损坏文件里**可能仍可手工抢救**的内容（半截 JSON 的合法前缀、
 * 用户手改过的行）确定性覆盖掉，且不留任何副本。这与 `ProjectRegistry` 的缺陷同源，修法同款：
 * 唯一的写入口 `write()` 在原子写**之前**先把原文件改名留档为 `<file>.corrupted-<epochMs>[-N]`
 * （同 UsageStore / ProjectRegistry / CredentialStore 命名，只改名不删除）；留档失败则**抑制本次写入**
 * （原文保持不变）并 warn，**不抛错**（命令仍可运行）。`missing` / `ok` 一律不留档。
 *
 * 隔离纪律：全部落在 `mkdtempSync(os.tmpdir(), 'vessel-override-write-')`，绝不触碰真实 `~/.vessel`；
 * 列举一律只读目录，删除只发生在 afterEach 对自己创建的临时目录。
 */
describe('092 补丁 2 — 覆盖写之前先留档（损坏内容不得被确定性覆盖）', () => {
  let dir: string;
  let store: PricingOverrideStore;
  let warns: string[];

  /** 与 ProjectRegistry / UsageStore 用例同款坏内容：JSON 截断（也覆盖「尾部被截断」这类损坏）。 */
  const CORRUPT = '{ broken';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-override-write-'));
    store = new PricingOverrideStore({ rootDir: dir });
    warns = [];
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warns.push(a.map((x) => String(x)).join(' '));
    });
  });
  afterEach(() => {
    fsHooks.denyRename = null;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 留档文件列举（`pricing.override.json.corrupted-<ts>[-N]`）。 */
  const archives = (): string[] => fs.readdirSync(dir).filter((n) => n.includes('.corrupted-')).sort();

  it('① 判别性主例：损坏 → set 覆盖写之前已留档（留档逐字等于坏内容），随后新写入生效', () => {
    fs.writeFileSync(store.file, CORRUPT, 'utf8');

    store.set('deepseek-chat', { input: 0.1, output: 0.2 });

    // ↓↓↓ 删掉写前留档（write() 里的 archiveBrokenBeforeWrite）→ 下面这两组断言直接红 ↓↓↓
    const baks = archives();
    expect(baks).toHaveLength(1);
    expect(baks[0]!.startsWith('pricing.override.json.corrupted-')).toBe(true); // 命名形态（同 UsageStore）
    // 判别核心：留档是**真副本**（逐字相等），不是空占位——可抢救的内容仍在
    expect(fs.readFileSync(path.join(dir, baks[0]!), 'utf8')).toBe(CORRUPT);

    // 覆盖确实发生了（所以这份留档是坏内容唯一的残存，证明时序是「先留档、再覆盖」）
    expect(fs.readFileSync(store.file, 'utf8')).not.toBe(CORRUPT);
    expect(new PricingOverrideStore({ rootDir: dir }).get('deepseek-chat')).toEqual({ input: 0.1, output: 0.2 });
  });

  it('② 留档失败（注入 renameSync EPERM）→ 不抛错 + warn「已抑制本次写入」+ 原文件逐字未变', () => {
    fs.writeFileSync(store.file, CORRUPT, 'utf8');
    fsHooks.denyRename = (dest) => String(dest).includes('.corrupted-');

    expect(() => store.set('deepseek-chat', { input: 0.1, output: 0.2 })).not.toThrow(); // 命令仍可运行

    // ↓↓↓ 删掉「留档失败 → 抑制写入」（catch 里的 return false）→ 下面三条直接红（坏内容被冲掉）↓↓↓
    expect(fs.readFileSync(store.file, 'utf8')).toBe(CORRUPT); // 原文件逐字未变
    expect(archives()).toEqual([]); // 确实没留下留档（改名失败）
    expect(fs.existsSync(`${store.file}.tmp`)).toBe(false); // 连半个 tmp 都没落（抑制发生在任何写之前）

    const text = warns.join('\n');
    expect(text).toContain('已抑制本次写入');
    expect(text).toContain('原文件保持不变');
    expect(text).toContain('请尽快手工备份');
    expect(text).toContain(store.file); // 点名原路径，便于人工抢救
  });

  it('③ 负对照：文件不存在（ENOENT，首次运行）→ 正常写入、无留档、一声不吭', () => {
    store.set('deepseek-chat', { input: 0.1, output: 0.2 });

    expect(fs.readFileSync(store.file, 'utf8')).toContain('deepseek-chat');
    expect(archives()).toEqual([]); // 首次运行不留档（否则每次首写都堆垃圾文件）
    expect(warns).toEqual([]); // 也无「抑制」告警
  });

  it('④ 负对照：合法文件（ok）→ 连续写不留档、不告警（健康态零副作用）', () => {
    store.set('deepseek-chat', { input: 0.1, output: 0.2 });
    store.set('claude-sonnet-4-5', { input: 3, output: 15 }); // 第二次写：文件已是 ok
    store.tombstone('deepseek-chat'); // 第三次写
    expect(store.restore('deepseek-chat')).toBe(true); // 第四次写（有墓碑 → 会落盘）

    const file = JSON.parse(fs.readFileSync(store.file, 'utf8')) as { models: Record<string, TokenPrice>; deleted: string[] };
    expect(Object.keys(file.models)).toEqual(['claude-sonnet-4-5']);
    expect(file.deleted).toEqual([]);
    expect(archives()).toEqual([]); // ok 不留档
    expect(warns).toEqual([]);
  });

  it('⑤ 同一前置步骤覆盖全部落盘点：损坏 → tombstone 也先留档（不是只改了 set）', () => {
    fs.writeFileSync(store.file, CORRUPT, 'utf8');

    store.tombstone('deepseek-chat'); // 另一个落盘点，同样经 write() 汇聚

    const baks = archives();
    expect(baks).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, baks[0]!), 'utf8')).toBe(CORRUPT);
    const current = JSON.parse(fs.readFileSync(store.file, 'utf8')) as { deleted: string[] };
    expect(current.deleted).toEqual(['deepseek-chat']);
  });

  it('⑥ 同毫秒二次损坏不覆盖前一份留档（<file>.corrupted-<ts>-N 唯一化）', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000); // 固定时钟：逼出同毫秒
    try {
      fs.writeFileSync(store.file, '{ bad1', 'utf8');
      store.set('a', { input: 1, output: 1 }); // 第 1 次留档：<file>.corrupted-1700000000000
      fs.writeFileSync(store.file, '{ bad2', 'utf8');
      store.set('b', { input: 2, output: 2 }); // 第 2 次（同一毫秒）→ 必须退化为 ...-1700000000000-1
    } finally {
      nowSpy.mockRestore();
    }

    const baks = archives();
    expect(baks).toHaveLength(2); // 二次损坏不得覆盖前一份
    expect(baks[0]!.startsWith('pricing.override.json.corrupted-')).toBe(true);
    expect(baks[1]!.startsWith('pricing.override.json.corrupted-1700000000000-')).toBe(true); // 唯一化后缀
    expect(baks.map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))).toEqual(['{ bad1', '{ bad2']);
  });

  it('⑦ unreadable（路径被目录占住）走同一前置：留档后照常写入且不抛错', () => {
    const dirStore = new PricingOverrideStore({ rootDir: path.join(dir, 'as-dir') });
    // 用目录占住覆盖文件路径：readFileSync 必然失败，且 errno 不是 ENOENT（非「首次运行」）
    fs.mkdirSync(dirStore.file, { recursive: true });

    expect(() => dirStore.set('deepseek-chat', { input: 0.1, output: 0.2 })).not.toThrow();

    const inner = fs.readdirSync(path.join(dir, 'as-dir')).filter((n) => n.includes('.corrupted-'));
    expect(inner).toHaveLength(1); // 原「读不到的东西」先留档，没有被当场覆盖
    expect(dirStore.readWithStatus().status).toBe('ok'); // 写后回到健康态
    expect(dirStore.get('deepseek-chat')).toEqual({ input: 0.1, output: 0.2 });
  });
});
