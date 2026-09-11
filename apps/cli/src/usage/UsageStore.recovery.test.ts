import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UsageStore } from './UsageStore.js';
import type { PricingTable } from '../providers/pricing.js';

/**
 * UsageStore.recovery.test.ts — 用量文件的两项可靠性行为验收（G-04 / BRIEF-05）。
 *
 * (a) G-04 损坏隔离：`usage.json` 解析失败时**改名**为 `<root>/usage.json.corrupted-<ts>`
 *     （原内容保留、绝不删除，符合仓库删除铁律），打一句含路径的 `console.warn`，
 *     随后以空表继续；文件**不存在**（ENOENT，首次运行）走静默空表，不隔离、不警告。
 * (b) BRIEF-05 写盘前备份轮转：`<rootDir>/backups/usage.<ts>.json`，默认保留 5 份，
 *     环境变量 `VESSEL_USAGE_BACKUP_KEEP` 可覆盖（`0` = 完全关闭）。
 *
 * (c) 读失败抑制写入（P2 补测）：`usage.json` **存在但读不到**（EACCES/EPERM/EBUSY…，非 ENOENT）时，
 *     置位 `suppressWrite` + warn，本进程**不再写**该文件（连备份都不做）——宁可不写，也不覆盖。
 * (d) 同毫秒二次损坏（P2 补测）：`<file>.corrupted-<ts>` 已存在时退化为 `-1`/`-2`，
 *     第二份隔离不得覆盖第一份。
 *
 * 隔离纪律：全部落在 `mkdtempSync(os.tmpdir(), 'vessel-usage-')`，绝不触碰真实 `~/.vessel`；
 * 断言一律「只读目录列举」，不用 unlink/rm 做「检查删除」。
 */

// 注入「读 usage.json 失败」用 `vi.mock('node:fs')` 而非 `vi.spyOn(fs, 'readFileSync')`：
// node:fs 的 ESM 命名空间导出 non-configurable，vitest 2.1.9 下 `vi.spyOn` 会报
// "Cannot redefine property"（同 packages/engine/src/project-task-queue.test.ts 与
// packages/application/src/credential/dpapiArgv.test.ts 的注释与写法）。
// 这里默认**原样委托**真实实现，只有 `readFileSync` 且 `denyRead` 谓词命中时才抛注入的错误，
// 其余 API / 其余路径不受影响（本文件既有用例照常走真实 fs）。
const fsHooks = vi.hoisted(() => ({ denyRead: null as null | ((file: unknown) => boolean) }));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const readFileSync = actual.readFileSync;
  return {
    ...actual,
    readFileSync: vi.fn((...args: Parameters<typeof readFileSync>) => {
      if (fsHooks.denyRead?.(args[0])) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return readFileSync(...args);
    }),
  };
});

const PRICING: PricingTable = {
  models: {
    default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
    'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
  },
  protocols: {},
};

/** 隔离文件列举：兼容 `usage.json.corrupted-<ts>` 与 `usage.corrupted-<ts>.json` 两种命名。 */
function listCorrupted(root: string): string[] {
  return fs.readdirSync(root).filter((n) => n.includes('.corrupted-'));
}

/** 备份列举：只数 `backups/usage.*.json`（目录不存在 → 空表，不报错、不建目录）。 */
function listBackups(root: string): string[] {
  const dir = path.join(root, 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /^usage\..*\.json$/.test(e.name))
    .map((e) => e.name);
}

/** 一次用量记录（字段形状照抄 usage-store.test.ts 的 record 调用）。 */
function recordOnce(store: UsageStore, i = 0): void {
  store.record({
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 100 + i,
    outputTokens: 50 + i,
  });
}

describe('usage — 损坏隔离 + 写盘前备份轮转（G-04 / BRIEF-05）', () => {
  let dir: string;
  /** 本用例内额外创建的临时 root（用例 4 需要独立 env / 独立目录）。 */
  const extraDirs: string[] = [];
  let savedKeep: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-usage-'));
    savedKeep = process.env.VESSEL_USAGE_BACKUP_KEEP;
  });

  afterEach(() => {
    if (savedKeep === undefined) delete process.env.VESSEL_USAGE_BACKUP_KEEP;
    else process.env.VESSEL_USAGE_BACKUP_KEEP = savedKeep;
    for (const d of [dir, ...extraDirs]) fs.rmSync(d, { recursive: true, force: true });
    extraDirs.length = 0;
  });

  const newRoot = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-usage-'));
    extraDirs.push(d);
    return d;
  };

  it('G-04 损坏 usage.json → 改名隔离（原内容保留）+ warn 含路径 + 以空表继续', () => {
    fs.writeFileSync(path.join(dir, 'usage.json'), '{oops', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 构造即触发 load() → quarantineCorrupted（无需 record）
      const store = new UsageStore({ rootDir: dir, pricing: PRICING });
      expect(store.totals().calls).toBe(0); // 以空表继续，不抛错

      const quarantined = listCorrupted(dir);
      expect(quarantined).toHaveLength(1);
      // 原内容**原样保留**（隔离而非删除）
      expect(fs.readFileSync(path.join(dir, quarantined[0]!), 'utf8')).toBe('{oops');
      // 原文件已改名让位（后续 save() 不会用空表覆盖唯一数据源）
      expect(fs.existsSync(path.join(dir, 'usage.json'))).toBe(false);

      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls.flat().join(' ')).toContain('usage.json');
    } finally {
      warn.mockRestore();
    }
  });

  it('ENOENT（首次运行）不误伤：无 quarantine 文件、不 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const store = new UsageStore({ rootDir: dir, pricing: PRICING });
      expect(store.totals().calls).toBe(0);
      expect(listCorrupted(dir)).toEqual([]); // 空 root 不该产生任何隔离文件
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('BRIEF-05 写盘前备份：连续 record 3 次 → backups/usage.*.json ≥2 份且内容是可解析 JSON', () => {
    const store = new UsageStore({ rootDir: dir, pricing: PRICING });
    for (let i = 0; i < 3; i += 1) recordOnce(store, i);

    const backups = listBackups(dir);
    expect(backups.length).toBeGreaterThanOrEqual(2); // 首次写无旧文件可备份，之后每次写盘前各一份
    for (const name of backups) {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'backups', name), 'utf8')) as {
        entries?: unknown;
      };
      expect(typeof parsed).toBe('object');
      expect(parsed).not.toBeNull();
      expect(typeof parsed.entries).toBe('object'); // 备份的是旧 usage.json 的完整结构
    }
  });

  it('BRIEF-05 VESSEL_USAGE_BACKUP_KEEP：2 → 份数 ≤2；0 → 完全关闭', () => {
    process.env.VESSEL_USAGE_BACKUP_KEEP = '2';
    const limited = newRoot();
    const limitedStore = new UsageStore({ rootDir: limited, pricing: PRICING });
    for (let i = 0; i < 5; i += 1) recordOnce(limitedStore, i);
    const capped = listBackups(limited);
    expect(capped.length).toBeLessThanOrEqual(2); // 上限生效（默认 5 的话这里会是 4）
    expect(capped.length).toBeGreaterThan(0); // 0 是关闭，不是把上限压到 0

    process.env.VESSEL_USAGE_BACKUP_KEEP = '0';
    const off = newRoot();
    const offStore = new UsageStore({ rootDir: off, pricing: PRICING });
    for (let i = 0; i < 3; i += 1) recordOnce(offStore, i);
    expect(listBackups(off)).toEqual([]); // 关闭后一份都不产生（目录甚至不创建）
    expect(fs.existsSync(path.join(off, 'backups'))).toBe(false);
  });

  it('BRIEF-05 默认保留份数：不设环境变量时为 5 份（达到上限后文件数恒定）', () => {
    delete process.env.VESSEL_USAGE_BACKUP_KEEP;
    const store = new UsageStore({ rootDir: dir, pricing: PRICING });
    for (let i = 0; i < 8; i += 1) recordOnce(store, i);

    const backups = listBackups(dir);
    expect(backups.length).toBe(5); // 默认 5（轮转只改名/覆盖，绝不删除）
    // 再次写盘不增长（上限恒定）
    recordOnce(store, 99);
    expect(listBackups(dir).length).toBe(5);
  });

  it('读失败（非 ENOENT，EACCES）不得静默覆盖：suppressWrite 生效，本进程不再写 usage.json', () => {
    const usageFile = path.join(dir, 'usage.json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 只让「读 usage.json」失败；断言 / 备份等其它路径照旧走真实实现
    fsHooks.denyRead = (file) => typeof file === 'string' && path.resolve(file) === path.resolve(usageFile);
    try {
      // 构造即触发 load()：EACCES（非 ENOENT）→ 置位 suppressWrite + 一句含路径的 warn
      const store = new UsageStore({ rootDir: dir, pricing: PRICING });
      expect(store.totals().calls).toBe(0); // 以空表继续，不抛错

      expect(warn).toHaveBeenCalled();
      const warned = warn.mock.calls.flat().join(' | ');
      expect(warned).toContain('usage.json');
      expect(warned).toContain('EACCES'); // 确系「读失败」告警，不是别的 warn 蒙混过关

      // 读不到原文时仍记录一次：save() 必须提前返回，不得用空表覆盖
      recordOnce(store);

      expect(fs.existsSync(usageFile)).toBe(false); // 一个字节都没落盘（没被空表覆盖）
      expect(listBackups(dir)).toEqual([]); // 抑制写入时连备份都不该做
      expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
    } finally {
      fsHooks.denyRead = null;
      warn.mockRestore();
    }
  });

  it('同毫秒二次损坏不覆盖前一份隔离文件（<file>.corrupted-<ts>-N 唯一化）', () => {
    const usageFile = path.join(dir, 'usage.json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000); // 固定时钟：逼出同毫秒
    try {
      fs.writeFileSync(usageFile, '{bad1', 'utf8');
      const first = new UsageStore({ rootDir: dir, pricing: PRICING }); // 第 1 次损坏隔离
      expect(first.totals().calls).toBe(0);

      fs.writeFileSync(usageFile, '{bad2', 'utf8');
      const second = new UsageStore({ rootDir: dir, pricing: PRICING }); // 第 2 次（同一毫秒）
      expect(second.totals().calls).toBe(0);

      const quarantined = listCorrupted(dir).sort();
      expect(quarantined).toHaveLength(2); // 二次损坏不得覆盖前一份
      const contents = quarantined.map((n) => fs.readFileSync(path.join(dir, n), 'utf8')).sort();
      expect(contents).toEqual(['{bad1', '{bad2']); // 两份原字节都在（只改名留档，不删除）
      expect(fs.existsSync(usageFile)).toBe(false); // 两份都让位给隔离文件
    } finally {
      nowSpy.mockRestore();
      warn.mockRestore();
    }
  });
});
