import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BACKUP_KEEP, ProviderStore, parseBackupKeep, type ProviderConfig } from './ProviderStore.js';

/**
 * providerBackup.test.ts — task 095 备份轮转验收测试。
 *
 * 关键约束：轮转**不删除任何文件**（删除铁律）——达到上限时把最旧的一份改名成新
 * 时间戳再覆盖，备份文件数恒 ≤ keep；备份内容是旧文件字节原样，可直接拷回回滚。
 */

const SAMPLE: ProviderConfig = {
  id: 'ds',
  name: 'DeepSeek',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
};

describe('095 备份轮转', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-bak-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const storeWith = (keep?: number): ProviderStore =>
    new ProviderStore(keep === undefined ? { rootDir: dir } : { rootDir: dir, backupKeep: keep });

  it('每次写盘前备份旧 providers.json（首次写不备份）', () => {
    const store = storeWith();
    store.add(SAMPLE);
    expect(store.listBackups()).toEqual([]); // 首次写：没有旧文件

    store.update('ds', { model: 'deepseek-reasoner' });
    const backups = store.listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]!.kind).toBe('providers');
    // 备份内容 = 写盘前的旧文件字节原样（可直接回滚）
    const restored = JSON.parse(fs.readFileSync(backups[0]!.file, 'utf8')) as ProviderConfig[];
    expect(restored[0]!.model).toBe('deepseek-chat');
    expect(store.get('ds')?.model).toBe('deepseek-reasoner');
  });

  it('轮转上限：保留 N 份，超出后文件数不增长且最旧被新备份取代', () => {
    const store = storeWith(2);
    store.add(SAMPLE); // 首次写
    for (const model of ['m1', 'm2', 'm3', 'm4']) {
      store.update('ds', { model });
    }
    const backups = store.listBackups().filter((b) => b.kind === 'providers');
    expect(backups).toHaveLength(2); // 恒定 ≤ keep
    // 最新在前：最新的备份是写 m4 之前的 m3
    const newest = JSON.parse(fs.readFileSync(backups[0]!.file, 'utf8')) as ProviderConfig[];
    expect(newest[0]!.model).toBe('m3');
    const oldest = JSON.parse(fs.readFileSync(backups[1]!.file, 'utf8')) as ProviderConfig[];
    expect(oldest[0]!.model).toBe('m2');
  });

  it('备份文件只被改名/覆盖，从不被删除（数量恒为 min(写入次数-1, keep)）', () => {
    const store = storeWith(3);
    store.add(SAMPLE);
    for (let i = 0; i < 10; i += 1) store.update('ds', { model: `m${i}` });
    const names = fs.readdirSync(store.backupsDir).filter((n) => n.endsWith('.json'));
    expect(names.length).toBe(3);
    // 目录里没有 .tmp 残留、也没有被删掉的历史文件（改名保留）
    expect(names.every((n) => /^providers\.\d{4}-\d{2}-\d{2}T.*\.json$/.test(n))).toBe(true);
  });

  it('backupKeep=0 关闭备份（目录不创建）', () => {
    const store = storeWith(0);
    store.add(SAMPLE);
    store.update('ds', { model: 'm2' });
    expect(fs.existsSync(store.backupsDir)).toBe(false);
    expect(store.listBackups()).toEqual([]);
  });

  it('current.json 也走同一套备份（按 kind 各自计数）', () => {
    const store = storeWith(5);
    store.add(SAMPLE);
    store.setCurrent('ds');
    store.setCurrent('mock');
    const kinds = store.listBackups().map((b) => b.kind);
    expect(kinds).toContain('current');
    const currentBackups = store.listBackups().filter((b) => b.kind === 'current');
    expect(currentBackups).toHaveLength(1); // 第一次写 current.json 无旧文件
  });

  it('备份目录不存在时 listBackups() 返回 []（不报错、不建目录）', () => {
    const store = storeWith();
    expect(store.listBackups()).toEqual([]);
    expect(fs.existsSync(store.backupsDir)).toBe(false);
  });

  it('原子写：写盘后无 .tmp 残留（providers.json / current.json）', () => {
    const store = storeWith();
    store.add(SAMPLE);
    store.setCurrent('ds');
    expect(fs.existsSync(`${store.providersFile}.tmp`)).toBe(false);
    expect(fs.existsSync(`${store.currentFile}.tmp`)).toBe(false);
  });

  it('parseBackupKeep：默认 5，接受 0，拒绝负数/小数/非数字', () => {
    expect(DEFAULT_BACKUP_KEEP).toBe(5);
    expect(parseBackupKeep('0')).toBe(0);
    expect(parseBackupKeep('12')).toBe(12);
    expect(() => parseBackupKeep('-1')).toThrow(/非负整数/);
    expect(() => parseBackupKeep('1.5')).toThrow(/非负整数/);
    expect(() => parseBackupKeep('abc')).toThrow(/非负整数/);
    expect(() => new ProviderStore({ rootDir: dir, backupKeep: -2 })).toThrow(/非负整数/); // 显式 opts 同样 fail loud
  });
});

/**
 * `VESSEL_PROVIDER_BACKUP_KEEP` 的读法 —— 与**同一概念**的
 * `UsageStore.resolveBackupKeep()`（`VESSEL_USAGE_BACKUP_KEEP`）同口径：
 * 未设置 / 空串 / 纯空白 ⇒ **默认 5**；其余 trim 后解析（非法值仍 fail loud）。
 *
 * 判别性（「删掉修复就红」）：旧实现是 `envKeep === undefined ? 5 : parseBackupKeep(envKeep)`，
 * 而 `Number('') === 0`、`Number('   ') === 0` ⇒ `VESSEL_PROVIDER_BACKUP_KEEP=`（shell 里
 * "清空变量"的常见写法）会**静默把备份数设成 0 = 关掉备份**——空值的默认行为本该是"用默认值"，
 * 而不是"关掉保护"。把构造函数里的 `envRoot('VESSEL_PROVIDER_BACKUP_KEEP')` 换回裸读
 * `process.env.…` ⇒ ① 与 ①-b 立即红（`backupKeep` 变 0、备一个都不产生）。
 */
describe('095 备份保留份数 — env 口径（空/纯空白 ⇒ 默认，不静默关闭备份）', () => {
  let dir: string;
  let savedKeep: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-bak-env-'));
    savedKeep = process.env.VESSEL_PROVIDER_BACKUP_KEEP;
  });

  afterEach(() => {
    if (savedKeep === undefined) delete process.env.VESSEL_PROVIDER_BACKUP_KEEP;
    else process.env.VESSEL_PROVIDER_BACKUP_KEEP = savedKeep;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 设 env 后构造 store（`backupKeep` 显式给出时测试「显式传参优先」）。 */
  function makeStore(envValue: string | undefined, backupKeep?: number): ProviderStore {
    if (envValue === undefined) delete process.env.VESSEL_PROVIDER_BACKUP_KEEP;
    else process.env.VESSEL_PROVIDER_BACKUP_KEEP = envValue;
    return new ProviderStore(backupKeep === undefined ? { rootDir: dir } : { rootDir: dir, backupKeep });
  }

  /** 写两次配置（第二次写前应有旧文件可备份），返回 providers 类备份数。 */
  function backupsAfterTwoWrites(store: ProviderStore): number {
    store.add(SAMPLE); // 首次写：无旧文件 ⇒ 不产生备份
    store.update('ds', { model: 'deepseek-reasoner' });
    return store.listBackups().filter((b) => b.kind === 'providers').length;
  }

  it('① 判别性：env 空串 ⇒ 默认备份数（非 0），备份照常发生 —— 不会静默关闭备份', () => {
    const store = makeStore('');
    expect(store.backupKeep).toBe(DEFAULT_BACKUP_KEEP);
    expect(store.backupKeep).toBeGreaterThan(0); // 旧实现这里是 0
    expect(backupsAfterTwoWrites(store)).toBe(1);
    expect(fs.existsSync(store.backupsDir)).toBe(true);
  });

  it("①-b 判别性：env 纯空白 ⇒ 默认备份数，备份照常发生（旧实现 Number('   ')=0）", () => {
    const store = makeStore('   ');
    expect(store.backupKeep).toBe(DEFAULT_BACKUP_KEEP);
    expect(backupsAfterTwoWrites(store)).toBe(1);
  });

  it('② 负对照：env 有值 ⇒ 该值生效（含首尾空白 trim 后同值）；显式 0 仍表示关闭', () => {
    expect(makeStore('2').backupKeep).toBe(2);
    expect(makeStore(' 2 ').backupKeep).toBe(2);
    // 有值时的行为逐字不变：`0`（显式写出来）依旧是「关闭备份」
    const off = makeStore('0');
    expect(off.backupKeep).toBe(0);
    expect(backupsAfterTwoWrites(off)).toBe(0);
    expect(fs.existsSync(off.backupsDir)).toBe(false);
  });

  it('③ 负对照：显式 opts.backupKeep 优先于 env；env 未设置 ⇒ 默认 5', () => {
    expect(makeStore('', 3).backupKeep).toBe(3);
    expect(makeStore('2', 3).backupKeep).toBe(3);
    expect(makeStore(undefined).backupKeep).toBe(DEFAULT_BACKUP_KEEP);
  });

  it('④ 有值口径未放宽：env 非法值仍 fail loud（空/空白是唯一新增的"未设置"形态）', () => {
    expect(() => makeStore('abc')).toThrow(/非负整数/);
    expect(() => makeStore('-1')).toThrow(/非负整数/);
    expect(() => makeStore('1.5')).toThrow(/非负整数/);
  });
});
