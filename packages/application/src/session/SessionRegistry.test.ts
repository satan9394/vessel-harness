import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionRegistry, defaultSessionRoot, resolveSessionRoot } from './SessionRegistry.js';

// node:fs 的 ESM 命名空间导出是 non-configurable getter，vi.spyOn 无法重定义顶层
// renameSync（vitest 2.1.9 报 "Cannot redefine property"）。改用 vi.mock 在文件级
// 注入一个默认真实委托、可被 mockImplementationOnce 临时武装的 renameSync，供
// task 113 的 EPERM 有界重试集成测试使用；其余 API 原样委托，不影响本文件其它用例。
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const renameSync = actual.renameSync;
  return {
    ...actual,
    renameSync: vi.fn((...args: Parameters<typeof renameSync>) => renameSync(...args)),
  };
});

describe('SessionRegistry', () => {
  let dir: string;
  let home: string;
  let ws: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-session-'));
    home = path.join(dir, 'vessel-home');
    ws = path.join(dir, 'workspace');
    fs.mkdirSync(ws, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('create/list/get round-trips session metadata', () => {
    const reg = new SessionRegistry({ vesselHome: home });
    const meta = reg.create({
      workspaceRoot: ws,
      provider: 'mock',
      model: 'mock-model',
      permission: 'workspace-write',
    });
    expect(meta.id).toMatch(/^sess_/);
    expect(meta.workspaceRoot).toBe(path.resolve(ws));
    expect(meta.createdAt).toBeTruthy();
    expect(meta.updatedAt).toBeTruthy();

    expect(reg.get(meta.id)).toEqual(meta);
    expect(reg.list().map((s) => s.id)).toContain(meta.id);
  });

  it('create defaults provider/model/permission when omitted', () => {
    const reg = new SessionRegistry({ vesselHome: home });
    const meta = reg.create();
    expect(meta.provider).toBe('unknown');
    expect(meta.model).toBe('unknown');
    expect(meta.permission).toBe('workspace-write');
  });

  it('list returns newest first', () => {
    // Two creates can land in the same real millisecond; `list()` then falls back
    // to id order (random hex), which is deterministic but not insertion order. A
    // monotonic clock keeps this ordering assertion about ordering, not luck.
    let clock = 1_000_000;
    const reg = new SessionRegistry({ vesselHome: home, now: () => (clock += 7) });
    const a = reg.create({ workspaceRoot: ws });
    const b = reg.create({ workspaceRoot: ws });
    const [first, second] = reg.list();
    expect(first!.id).toBe(b.id);
    expect(second!.id).toBe(a.id);
  });

  it('persists across instances (fresh registry sees prior sessions)', () => {
    const reg1 = new SessionRegistry({ vesselHome: home });
    const created = reg1.create({
      workspaceRoot: ws,
      provider: 'mock',
      model: 'mock-model',
      permission: 'read-only',
    });

    const reg2 = new SessionRegistry({ vesselHome: home });
    const restored = reg2.get(created.id);
    expect(restored).toBeDefined();
    expect(restored!.provider).toBe('mock');
    expect(restored!.model).toBe('mock-model');
    expect(restored!.permission).toBe('read-only');
  });

  it('remove drops a session from the registry and persists it', () => {
    const reg = new SessionRegistry({ vesselHome: home });
    const a = reg.create({ workspaceRoot: ws });
    const b = reg.create({ workspaceRoot: ws });

    expect(reg.remove(a.id)).toBe(true);
    expect(reg.remove('missing')).toBe(false);
    expect(reg.get(a.id)).toBeUndefined();
    expect(reg.list().map((s) => s.id)).toEqual([b.id]);

    // removal survived a fresh instance
    const reg2 = new SessionRegistry({ vesselHome: home });
    expect(reg2.get(a.id)).toBeUndefined();
    expect(reg2.get(b.id)).toBeDefined();
  });

  it('persist survives transient EPERM on rename (task 113 bounded retry)', () => {
    const renameSync = vi.mocked(fs.renameSync);
    renameSync.mockClear();
    renameSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    });
    renameSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    });
    const reg = new SessionRegistry({ vesselHome: home });
    const meta = reg.create({ workspaceRoot: ws });
    expect(reg.get(meta.id)).toBeDefined();
    expect(renameSync).toHaveBeenCalledTimes(3);
    // 持久化确实落盘（第 3 次真实 rename 生效）
    const reg2 = new SessionRegistry({ vesselHome: home });
    expect(reg2.get(meta.id)).toBeDefined();
  });

  /**
   * 状态根口径（`VESSEL_SESSION_ROOT`）—— 唯一实现 = `envRoot`（`@vessel/shared`）：
   * 空/纯空白 ⇒ 未设置（回落默认根 `~/.vessel`），其余 trim；显式 `vesselHome` 最优先。
   *
   * 判别性（「删掉修复就红」）：改前 `resolveSessionRoot()` 是
   * `process.env.VESSEL_SESSION_ROOT ?? defaultSessionRoot()`，`??` 只挡 `undefined`：
   *   - `''`   ⇒ 根 = `''` ⇒ 构造里 `fs.mkdirSync('')` **抛 ENOENT**（生产调用点 try/catch 吞掉 ⇒ 静默不登记）；
   *   - `'   '`⇒ 根 = `'   '` ⇒ 相对进程 CWD。
   *
   * 隔离（AGENTS.md §8）：这里把 `os.homedir()` 指到**临时**目录（`HOME`/`USERPROFILE`），
   * 所以「默认根」= `<临时 home>/.vessel`，绝不写真实 `~/.vessel`。
   */
  describe('状态根口径（VESSEL_SESSION_ROOT 空/纯空白 ⇒ 未设置）', () => {
    let fakeHome: string;
    let savedRoot: string | undefined;
    let savedHome: string | undefined;
    let savedUserProfile: string | undefined;

    beforeEach(() => {
      fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-session-home-'));
      savedRoot = process.env.VESSEL_SESSION_ROOT;
      savedHome = process.env.HOME;
      savedUserProfile = process.env.USERPROFILE;
      process.env.HOME = fakeHome; // POSIX：os.homedir() 读 HOME
      process.env.USERPROFILE = fakeHome; // Windows：os.homedir() 读 USERPROFILE
    });

    afterEach(() => {
      if (savedRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
      else process.env.VESSEL_SESSION_ROOT = savedRoot;
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = savedUserProfile;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    });

    it('① 判别性：空串 ⇒ 默认根（旧实现得 "" ⇒ 构造函数 mkdirSync("") 抛 ENOENT）', () => {
      process.env.VESSEL_SESSION_ROOT = '';
      const fallback = defaultSessionRoot();
      expect(fallback).toBe(path.join(fakeHome, '.vessel'));
      expect(resolveSessionRoot()).toBe(fallback);
      expect(resolveSessionRoot()).not.toBe('');

      // 生产后果：构造不再抛 ENOENT，且落盘位置 = 默认根（不是 ""，不是 CWD）
      const reg = new SessionRegistry();
      const meta = reg.create({ workspaceRoot: ws });
      expect(reg.get(meta.id)).toBeDefined();
      expect(fs.existsSync(path.join(fakeHome, '.vessel', 'sessions.json'))).toBe(true);
      expect(fs.existsSync('sessions.json')).toBe(false);
    });

    it('①-b 判别性：纯空白 ⇒ 默认根（旧实现得 "   " ⇒ 相对 CWD）', () => {
      process.env.VESSEL_SESSION_ROOT = '   ';
      expect(resolveSessionRoot()).toBe(defaultSessionRoot());
      const reg = new SessionRegistry();
      reg.create({ workspaceRoot: ws });
      expect(fs.existsSync(path.join(fakeHome, '.vessel', 'sessions.json'))).toBe(true);
    });

    it('② 负对照：有值（含首尾空白）⇒ trim 后为该根，行为逐字不变', () => {
      const explicit = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-session-explicit-'));
      try {
        process.env.VESSEL_SESSION_ROOT = `  ${explicit}  `;
        expect(resolveSessionRoot()).toBe(explicit);
        const reg = new SessionRegistry();
        reg.create({ workspaceRoot: ws });
        expect(fs.existsSync(path.join(explicit, 'sessions.json'))).toBe(true);
        expect(fs.existsSync(path.join(fakeHome, '.vessel', 'sessions.json'))).toBe(false);
      } finally {
        fs.rmSync(explicit, { recursive: true, force: true });
      }
    });

    it('④ 负对照：显式 vesselHome 优先于 env；未设置 ⇒ 默认根', () => {
      process.env.VESSEL_SESSION_ROOT = path.join(path.dirname(ws), 'from-env');
      const reg = new SessionRegistry({ vesselHome: home });
      reg.create({ workspaceRoot: ws });
      expect(fs.existsSync(path.join(home, 'sessions.json'))).toBe(true);
      expect(fs.existsSync(path.join(path.dirname(ws), 'from-env', 'sessions.json'))).toBe(false);

      delete process.env.VESSEL_SESSION_ROOT;
      expect(resolveSessionRoot()).toBe(defaultSessionRoot());
      expect(resolveSessionRoot()).toBe(path.join(fakeHome, '.vessel'));
    });
  });
});