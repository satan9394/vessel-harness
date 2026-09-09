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
