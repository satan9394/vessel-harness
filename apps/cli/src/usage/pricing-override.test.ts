import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageStore } from './UsageStore.js';
import { PricingOverrideStore, sameTokenPrice } from './pricingOverride.js';
import { createOverridePriceSource, type PricingTable, type TokenPrice } from '../providers/pricing.js';
// CLI 层验收（C 的文案 / 退出码）。为什么放在本文件：`vessel pricing override` 的四个落盘点只经
// `cmdPricingOverride`，而它不导出——只能经 `main()` 驱动（与 cli.test.ts 同款）。`main()` 在该子命令
// 上不碰 provider/session/网络，`VESSEL_USAGE_ROOT` 在本 describe 里显式钉到临时目录（AGENTS.md §8）。
import { main } from '../cli.js';

// 注入「留档改名失败」用 `vi.mock('node:fs')` 而非 `vi.spyOn(fs, 'renameSync')`：node:fs 的
// ESM 命名空间导出 non-configurable，vitest 2.x 下 spyOn 会报 "Cannot redefine property"
// （同 packages/application/src/project/ProjectRegistry.recovery.test.ts 与
// apps/cli/src/usage/UsageStore.recovery.test.ts 的注释与写法）。这里默认**原样委托**真实实现，
// 只有 `denyRename` 谓词命中（留档目标名含 `.corrupted-`）时才抛 EPERM —— 原子写的
// `renameWithRetry(tmp, pricing.override.json)` 目标名不含 `.corrupted-`，不受影响。
//
// 另加一个 `denyWrite` 谓词（B2/C 补测）：只拦**目标名命中**的 `writeFileSync`（本文件用它模拟
// 写盘失败 ENOSPC / EPERM），其余路径 / 其余 API 一律透明委托——既有用例与同名文件里的 CLI 用例
// 照常走真实 fs。
//
// 刻意用**普通函数**而非 `vi.fn()`：`vi.restoreAllMocks()` 会遍历全局 mock 集合并重置其实现，
// 用 `vi.fn` 会被连带打掉；普通函数不在该集合内。
const fsHooks = vi.hoisted(() => ({
  denyRename: null as null | ((dest: unknown) => boolean),
  denyWrite: null as null | ((file: unknown) => boolean),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const realWriteFileSync = actual.writeFileSync;
  return {
    ...actual,
    renameSync: (oldPath: fs.PathLike, newPath: fs.PathLike): void => {
      if (fsHooks.denyRename?.(newPath)) {
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
      }
      actual.renameSync(oldPath, newPath);
    },
    writeFileSync: ((...args: unknown[]) => {
      if (fsHooks.denyWrite?.(args[0])) {
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
      }
      return (realWriteFileSync as (...a: unknown[]) => unknown)(...args);
    }) as unknown as typeof realWriteFileSync,
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
    const restored = store.restore('deepseek-chat');
    // 取值路径调整（C 修复的唯一必要改动）：旧的单个 `boolean` 返回值 = 现在的 `found`；
    // 断言强度不放宽，并新增 `persisted`（健康路径必须真落盘）。
    expect(restored.found).toBe(true);
    expect(restored.persisted).toBe(true);
    expect(store.source().findDeleted?.('deepseek-chat')).toBeUndefined();
    const again = store.restore('deepseek-chat');
    expect(again.found).toBe(false); // 已无墓碑 → 无改动
    expect(again.persisted).toBe(false); // 无改动 ⇒ 压根不写盘
  });

  it('值守卫式修复：仅当现值 = 旧值才改（用户手改过的行不动、缺失键不新建）', () => {
    store.set('claude-sonnet-4-5', SONNET);
    store.set('deepseek-chat', { input: 0.5, output: 5 }); // 用户手改过的价（≠ 旧内置值）
    const outcomes = store.repair([
      { key: 'claude-sonnet-4-5', from: SONNET, to: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 } },
      { key: 'deepseek-chat', from: { input: 0.27, output: 1.1, cacheRead: 0.07 }, to: { input: 0.99, output: 9.9 } },
      { key: 'gpt-4o', from: { input: 2.5, output: 10 }, to: { input: 3, output: 12 } },
    ]).outcomes; // 取值路径调整（C 修复）：repair 现返回 { outcomes, persisted, changed }
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
    const outcomes = store.repair([{ key: 'claude-sonnet-4-5', from: SONNET, to: { input: 9, output: 9 } }]).outcomes;
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
    // B2 补测带来的计数变化：留档成功现在会**立刻**补一条「已留档为 …」warn（总数 +1，读告警去重不变）。
    // 原断言 `expect(warns).toHaveLength(1)` 在此**收紧**为「读告警仍只 1 条 + 总数 2 条」。
    expect(warns.filter((w) => w.includes('本次忽略整份覆盖'))).toHaveLength(1);
    expect(warns).toHaveLength(2);

    fs.writeFileSync(store.file, '{ broken', 'utf8');
    store.read();
    expect(warns.filter((w) => w.includes('本次忽略整份覆盖'))).toHaveLength(2); // 再次损坏 → 重新告警
    expect(warns).toHaveLength(3); // 2 条读告警 + 1 条留档告警
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
    fsHooks.denyWrite = null;
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

    // ↓↓↓ 删掉「留档失败 → 抑制写入」（catch 里的 `return { proceed: false }`）→ 下面三条直接红（坏内容被冲掉）↓↓↓
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
    const restored = store.restore('deepseek-chat'); // 第四次写（有墓碑 → 会落盘）
    expect(restored.found).toBe(true); // 取值路径调整：旧返回值 = 现在的 found
    expect(restored.persisted).toBe(true);

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

/**
 * 092 补丁 3（B2）——**「留档成功 → 写失败」不得是静默窗口**。
 *
 * 缺陷：留档（`renameSync` 到 `.corrupted-<ts>`）成功之后，原路径上就没有文件了。此刻
 * mkdir / 写 tmp / rename 任一步失败，用户面对的是「原路径不存在 + 一声不吭」——下一次
 * `readWithStatus()` 只会给出**设计上静默**的 `missing` 分支，于是留档路径与「文件损坏」两件事
 * 都不可见（与本文件头「损坏必须可见」的自述直接矛盾）。
 *
 * 修法（两条都做）：①留档成功**立刻** warn（含留档路径 + 原路径 + 「即将写入新内容」）；
 * ②写失败时**先回滚**（把留档改回原名，磁盘状态与写入前逐字一致），回滚不了就兜底告警给出
 * 留档路径。判据：**任何路径下都不允许出现「原路径不存在 + 无告警」**。
 *
 * 注入方式照抄本仓既有 `*.recovery.test.ts` 约定：`vi.mock('node:fs')` 只拦**目标名命中**的
 * 调用（`denyWrite` 命中 `.tmp` / `denyRename` 命中指定目标），其余一律透明委托。
 */
describe('092 补丁 3（B2）— 留档成功 + 随后写失败：原路径不存在时必须有告警（不得静默）', () => {
  let dir: string;
  let store: PricingOverrideStore;
  let warns: string[];

  /** 与「补丁 2」同款坏内容：JSON 截断。 */
  const CORRUPT = '{ broken';
  /** 只拦覆盖文件的 tmp 写入（模拟 ENOSPC / 磁盘满）；其余 fs 调用透明委托。 */
  const denyTmp = (p: unknown): boolean => String(p).endsWith('pricing.override.json.tmp');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-override-b2-'));
    store = new PricingOverrideStore({ rootDir: dir });
    warns = [];
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warns.push(a.map((x) => String(x)).join(' '));
    });
  });
  afterEach(() => {
    fsHooks.denyRename = null;
    fsHooks.denyWrite = null;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 留档文件列举（`pricing.override.json.corrupted-<ts>[-N]`）。 */
  const archives = (): string[] => fs.readdirSync(dir).filter((n) => n.includes('.corrupted-')).sort();

  it('① 判别性主例：损坏 → 留档成功但写盘失败 → 回滚后原文件逐字未变，且两条告警都在', () => {
    fs.writeFileSync(store.file, CORRUPT, 'utf8');
    fsHooks.denyWrite = denyTmp;

    const result = store.set('deepseek-chat', { input: 0.1, output: 0.2 });

    // ↓↓↓ 删掉 write() 的 catch + warnWriteFailed（退回「写失败就抛/就静默」）→ 本组断言直接红 ↓↓↓
    expect(result.persisted).toBe(false); // 落盘结果如实回传（C 的接口）
    expect(result.changed).toBe(true);
    expect(result.reason ?? '').toContain('ENOSPC');

    // ①-a 写失败被回滚：原路径仍在，内容与写入前逐字一致（损坏依旧可见，不是静默 missing）
    expect(fs.existsSync(store.file)).toBe(true);
    expect(fs.readFileSync(store.file, 'utf8')).toBe(CORRUPT);
    expect(store.readWithStatus().status).toBe('corrupt');
    expect(archives()).toEqual([]); // 留档已改回原名，不留半拉子文件
    expect(fs.existsSync(`${store.file}.tmp`)).toBe(false); // 也没有 tmp 残留

    // ①-b 两条告警都在：先「已留档为 <备份路径>」（B2 首选），再「写入失败 + 去向」
    const text = warns.join('\n');
    expect(text).toContain('已留档为');
    expect(text).toMatch(/pricing\.override\.json\.corrupted-\d+/); // 留档路径（可手工恢复）
    expect(text).toContain('写入失败');
    expect(text).toContain('ENOSPC');
    expect(text).toContain('已回滚');
    expect(text).toContain(store.file);
  });

  it('② 回滚也失败（注入 renameSync EPERM）→ 原路径确实不存在，但告警给出留档路径且留档内容完好', () => {
    fs.writeFileSync(store.file, CORRUPT, 'utf8');
    fsHooks.denyWrite = denyTmp;
    // 只拦「改回原名」这一步（目标 = 覆盖文件本身）；留档改名（目标含 `.corrupted-`）不受影响
    fsHooks.denyRename = (dest) => String(dest).endsWith('pricing.override.json');

    const result = store.set('deepseek-chat', { input: 0.1, output: 0.2 });

    expect(result.persisted).toBe(false);
    // 这就是缺陷的原始形态：原路径已经不存在……
    expect(fs.existsSync(store.file)).toBe(false);
    // ……但**绝不静默**：留档路径写在告警里，且留档文件本身完好（内容可手工取回）
    const baks = archives();
    expect(baks).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, baks[0]!), 'utf8')).toBe(CORRUPT);
    const text = warns.join('\n');
    expect(text).toContain('已留档为');
    expect(text).toContain(path.join(dir, baks[0]!)); // 告警里的路径 = 磁盘上真实存在的留档
    expect(text).toContain('写入失败');
    expect(text).toContain('回滚失败');
    expect(text).toContain(store.file);
  });

  it('③ 负对照：合法文件 + 写失败 → 不误报留档；原文件逐字未变且明说「写入失败」', () => {
    store.set('deepseek-chat', { input: 0.1, output: 0.2 }); // 先落一份健康文件（真实 fs）
    const before = fs.readFileSync(store.file, 'utf8');
    fsHooks.denyWrite = denyTmp;

    const result = store.set('claude-sonnet-4-5', { input: 3, output: 15 });

    expect(result.persisted).toBe(false);
    expect(fs.readFileSync(store.file, 'utf8')).toBe(before); // 原文件逐字未变
    expect(archives()).toEqual([]); // ok 起步不留档
    const text = warns.join('\n');
    expect(text).toContain('写入失败');
    expect(text).toContain('原文件未被改写');
    expect(text).not.toContain('已留档为'); // 没留档就不许说有（防「一律报留档」的反向谎报）
  });
});

/**
 * 092 补丁 3（C）——**落盘结果必须回传**（store 层双向验收）。
 *
 * 旧签名：`write()` 返回 `void`，四个 mutator 的返回值都不携带「是否真落盘」。于是「内容变了但
 * 没落盘」在类型上不可见；`restore()` 更危险——它的 `true` 只表示「内存里有墓碑」，抑制写入时
 * 仍为 `true` ⇒ CLI 退出码 0，脚本据此误判已落盘。
 */
describe('092 补丁 3（C）— 落盘结果回传：未落盘不得报成功 / 落盘必须报成功', () => {
  let dir: string;
  let store: PricingOverrideStore;
  let warns: string[];

  const denyTmp = (p: unknown): boolean => String(p).endsWith('pricing.override.json.tmp');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-override-c-'));
    store = new PricingOverrideStore({ rootDir: dir });
    warns = [];
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warns.push(a.map((x) => String(x)).join(' '));
    });
  });
  afterEach(() => {
    fsHooks.denyRename = null;
    fsHooks.denyWrite = null;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('判别性主例：restore 拆开 found / persisted —— 有墓碑但写盘失败 → persisted=false（旧签名给 true ⇒ CLI exit 0）', () => {
    store.set('deepseek-chat', { input: 0.1, output: 0.2 });
    store.tombstone('deepseek-chat');
    expect(store.tombstones()).toEqual(['deepseek-chat']);
    fsHooks.denyWrite = denyTmp;

    const result = store.restore('deepseek-chat');

    // ↓↓↓ 删掉 restore 的 persisted 拆分（退回单个 boolean）→ 首条断言失去判别力、CLI 会 exit 0 ↓↓↓
    expect(result.found).toBe(true); // 旧返回值的全部含义（内存里有墓碑）
    expect(result.persisted).toBe(false); // 新增：**没落盘**
    expect(result.reason ?? '').toContain('ENOSPC');
    // 磁盘上墓碑仍在（= CLI 文案里那句「原文件保持不变」的判据）
    expect((JSON.parse(fs.readFileSync(store.file, 'utf8')) as { deleted: string[] }).deleted).toEqual(['deepseek-chat']);
    expect(warns.join('\n')).toContain('写入失败');
  });

  it('set / tombstone / repair 同样透传：写失败 → changed=true 且 persisted=false，磁盘值不变', () => {
    fsHooks.denyWrite = denyTmp;
    expect(store.set('deepseek-chat', { input: 0.1, output: 0.2 })).toMatchObject({ changed: true, persisted: false });
    expect(store.tombstone('deepseek-chat')).toMatchObject({ changed: true, persisted: false });
    fsHooks.denyWrite = null;

    store.set('claude-sonnet-4-5', SONNET);
    fsHooks.denyWrite = denyTmp;
    const rep = store.repair([{ key: 'claude-sonnet-4-5', from: SONNET, to: { input: 4, output: 20 } }]);
    expect(rep.changed).toBe(true);
    expect(rep.persisted).toBe(false);
    expect(rep.outcomes[0]?.status).toBe('applied'); // 内存里判定为「已改」……
    expect(store.get('claude-sonnet-4-5')).toEqual(SONNET); // ……磁盘上仍是旧值（没落盘）
  });

  it('repair 无一条 applied → changed=false（压根不写盘、不算失败、零告警）', () => {
    store.set('claude-sonnet-4-5', { input: 1, output: 2 });
    warns.length = 0;

    const rep = store.repair([{ key: 'claude-sonnet-4-5', from: SONNET, to: { input: 9, output: 9 } }]);

    expect(rep).toMatchObject({ changed: false, persisted: false });
    expect(rep.reason).toBeUndefined();
    expect(warns).toEqual([]); // 幂等无变更不是失败：不许因此告警
  });

  it('落盘必须报成功（反向防「一律报失败」）：四个 mutator 在健康路径上一律 persisted=true 且零告警', () => {
    const setRes = store.set('claude-sonnet-4-5', SONNET);
    expect(setRes).toMatchObject({ changed: true, persisted: true });
    expect(setRes.reason).toBeUndefined();

    const tomb = store.tombstone('claude-sonnet-4-5');
    expect(tomb).toMatchObject({ changed: true, persisted: true });

    const restored = store.restore('claude-sonnet-4-5');
    expect(restored).toMatchObject({ found: true, persisted: true });
    expect(restored.reason).toBeUndefined();

    store.set('claude-sonnet-4-5', SONNET);
    const rep = store.repair([{ key: 'claude-sonnet-4-5', from: SONNET, to: { input: 4, output: 20 } }]);
    expect(rep).toMatchObject({ changed: true, persisted: true });
    expect(store.get('claude-sonnet-4-5')).toEqual({ input: 4, output: 20 });

    expect(warns).toEqual([]); // 健康路径零噪音（新增的留档告警不得误伤正常写入）
  });
});

/**
 * 092 补丁 3（C）——CLI 四处（set / delete / restore / repair）的文案与退出码验收，**双向**：
 *   ① 被抑制 / 未落盘 → **不得**打印成功，且退出码必须非 0（此处统一取 1）；
 *   ② 正常落盘 → 照常打印成功、退出码 0（防「一律报失败」这种反向的新谎报）。
 *
 * 退出码为什么取 1：本族命令里 `2` 已被「用法 / 校验错误」（缺 flag、非法价、缺 key）占用，而
 * 「命令合法但没生效」已有独立词表——`restore` 找不到墓碑本来就是 1。取 1 既让脚本能区分
 * 「改参数再重试（2）」与「环境问题：磁盘 / 权限 / 占用（1）」，又保证**绝不会是 0**。
 */
describe('092 补丁 3（C）— CLI：未落盘不得宣称成功，落盘必须照常宣称成功', () => {
  let dir: string;
  let savedRoot: string | undefined;
  let logs: string[];
  let restoreConsole: () => void;

  const denyTmp = (p: unknown): boolean => String(p).endsWith('pricing.override.json.tmp');
  const overrideFile = (): string => path.join(dir, 'pricing.override.json');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-override-cli-'));
    savedRoot = process.env.VESSEL_USAGE_ROOT;
    process.env.VESSEL_USAGE_ROOT = dir; // AGENTS.md §8：绝不读写真实 ~/.vessel
    logs = [];
    const spyLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => logs.push(a.map((x) => String(x)).join(' ')));
    const spyErr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => logs.push(a.map((x) => String(x)).join(' ')));
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => logs.push(a.map((x) => String(x)).join(' ')));
    restoreConsole = () => {
      spyLog.mockRestore();
      spyErr.mockRestore();
      spyWarn.mockRestore();
    };
  });
  afterEach(() => {
    fsHooks.denyRename = null;
    fsHooks.denyWrite = null;
    restoreConsole();
    if (savedRoot === undefined) delete process.env.VESSEL_USAGE_ROOT;
    else process.env.VESSEL_USAGE_ROOT = savedRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① set 未落盘 → exit 1 且**不打印**「✔ 已写入覆盖」（不得宣称成功）', async () => {
    fsHooks.denyWrite = denyTmp;

    const code = await main(['pricing', 'override', 'set', 'deepseek-chat', '--input', '0.1', '--output', '0.2']);

    const out = logs.join('\n');
    expect(code).toBe(1); // 与「未生效」相称的非 0 退出码
    expect(out).not.toContain('✔ 已写入覆盖'); // 本卡 C 的核心判别点
    expect(out).not.toContain('生效于后续记录');
    expect(out).toContain('未写入');
    expect(out).toContain('未生效');
    expect(out).toContain(overrideFile()); // 点名文件，便于定位
    expect(fs.existsSync(overrideFile())).toBe(false); // 真的一个字节都没落
  });

  it('② set 正常落盘 → exit 0 且照常打印「✔ 已写入覆盖」（反向：不得一律报失败）', async () => {
    const code = await main(['pricing', 'override', 'set', 'deepseek-chat', '--input', '0.1', '--output', '0.2']);

    const out = logs.join('\n');
    expect(code).toBe(0);
    expect(out).toContain('✔ 已写入覆盖');
    expect(out).not.toContain('未写入');
    expect((JSON.parse(fs.readFileSync(overrideFile(), 'utf8')) as { models: Record<string, unknown> }).models['deepseek-chat']).toEqual({
      input: 0.1,
      output: 0.2,
    });
  });

  it('③ restore 未落盘 → exit 1（旧实现：restore() 返回 true ⇒ exit 0，脚本误判已落盘）', async () => {
    new PricingOverrideStore({ rootDir: dir }).tombstone('deepseek-chat');
    fsHooks.denyWrite = denyTmp;

    const code = await main(['pricing', 'override', 'restore', 'deepseek-chat']);

    expect(code).toBe(1); // ★ 本卡 C 的核心：不再因为「内存里有墓碑」就报 0
    const out = logs.join('\n');
    expect(out).not.toContain('✔ 已撤销墓碑');
    expect(out).toContain('未写入');
    expect((JSON.parse(fs.readFileSync(overrideFile(), 'utf8')) as { deleted: string[] }).deleted).toEqual(['deepseek-chat']);

    // 放开注入 → 同一命令照常成功（双向：修复的是「谎报成功」，不是「一律失败」）
    logs = [];
    fsHooks.denyWrite = null;
    const ok = await main(['pricing', 'override', 'restore', 'deepseek-chat']);
    expect(ok).toBe(0);
    expect(logs.join('\n')).toContain('✔ 已撤销墓碑');
  });

  it('④ delete 未落盘 → exit 1 且不打印「✔ 已删除内置条目」', async () => {
    fsHooks.denyWrite = denyTmp;

    const code = await main(['pricing', 'override', 'delete', 'deepseek-chat']);

    const out = logs.join('\n');
    expect(code).toBe(1);
    expect(out).not.toContain('✔ 已删除内置条目');
    expect(out).toContain('未写入');
    expect(fs.existsSync(overrideFile())).toBe(false);
  });

  it('⑤ repair 未落盘 → exit 1、逐条文案改为「已改（未落盘）」且不打印「条生效」', async () => {
    new PricingOverrideStore({ rootDir: dir }).set('claude-sonnet-4-5', SONNET);
    const repairs = path.join(dir, 'repairs.json');
    fs.writeFileSync(
      repairs,
      JSON.stringify([{ key: 'claude-sonnet-4-5', from: SONNET, to: { input: 4, output: 20 } }]),
      'utf8',
    );
    fsHooks.denyWrite = denyTmp;

    const code = await main(['pricing', 'override', 'repair', '--file', repairs]);

    const out = logs.join('\n');
    expect(code).toBe(1);
    expect(out).not.toContain('条生效'); // 「共 1/1 条生效」这类成功口径不得出现
    expect(out).toContain('已改（未落盘）');
    expect(out).toContain('未写入');
    expect((JSON.parse(fs.readFileSync(overrideFile(), 'utf8')) as { models: Record<string, TokenPrice> }).models['claude-sonnet-4-5']).toEqual(SONNET);
  });
});
