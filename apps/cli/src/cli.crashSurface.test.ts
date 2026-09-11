import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { main } from './cli.js';
import { describeStartupFailure } from './startupError.js';

/**
 * CLI 崩溃面契约（G-03）：配置损坏时 `main()` 必须把异常**原样 reject 出去**，
 * 由入口 `.catch` 交给 `describeStartupFailure` 渲染成人话 + exit 1。
 *
 * 为什么单独立一个文件：cli.test.ts 只走「正常命令返回码」，没有任何用例经过
 * `main()` 的失败路径——入口兜底被删掉也不会变红。本文件是这条契约的唯一哨兵：
 * 一旦 `main()` 开始吞异常、或渲染退化成裸栈，这里必须失败。
 *
 * 隔离（task 106 口径）：三个 `VESSEL_*_ROOT` 全部指向 mkdtemp 子目录，
 * 断言绝不读写真实 `~/.vessel`（机器上的 current.json 可能指向真实供应商）。
 */

const TMP_PREFIX = 'vessel-crashsurface-';
const ROOT_ENV = [
  'VESSEL_SETTINGS_ROOT',
  'VESSEL_PROVIDER_ROOT',
  'VESSEL_USAGE_ROOT',
  // G-10：会话登记会写 <VESSEL_SESSION_ROOT ?? ~/.vessel>/sessions.json（AGENTS.md §8 必须隔离）。
  'VESSEL_SESSION_ROOT',
] as const;

/** TMP_PREFIX 下的一次性临时根 + 三个子 root（每个用例重建，原值存 Map 供 afterEach 还原）。 */
let dir: string;
let settingsDir: string;
let providerDir: string;
let usageDir: string;
let sessionDir: string;
const savedEnv = new Map<string, string | undefined>();

describe('CLI 崩溃面（main → describeStartupFailure）', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
    settingsDir = path.join(dir, 'settings');
    providerDir = path.join(dir, 'provider');
    usageDir = path.join(dir, 'usage');
    sessionDir = path.join(dir, 'sessions');
    for (const sub of [settingsDir, providerDir, usageDir, sessionDir]) {
      fs.mkdirSync(sub, { recursive: true });
    }
    for (const key of ROOT_ENV) {
      savedEnv.set(key, process.env[key]);
    }
    process.env.VESSEL_SETTINGS_ROOT = settingsDir;
    process.env.VESSEL_PROVIDER_ROOT = providerDir;
    process.env.VESSEL_USAGE_ROOT = usageDir;
    process.env.VESSEL_SESSION_ROOT = sessionDir;
  });

  afterEach(() => {
    for (const key of ROOT_ENV) {
      const prev = savedEnv.get(key);
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
    savedEnv.clear();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① settings.json 损坏 → main() reject，且渲染为 config-corrupted 人话（含路径 + vessel setup 指引，无裸栈）', async () => {
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), '{not json', 'utf8');

    await expect(main(['settings', 'list'])).rejects.toThrow(/settings\.json/);

    let rendered = false;
    try {
      await main(['settings', 'list']);
    } catch (err) {
      rendered = true;
      const f = describeStartupFailure(err);
      expect(f.kind).toBe('config-corrupted');
      expect(f.message).toContain('settings.json');
      expect(f.message).toMatch(/vessel setup/);
      // 人话渲染绝不带裸栈帧（`\n    at ...`）。
      expect(f.message).not.toMatch(/\n\s+at\s/);
    }
    if (!rendered) expect.unreachable('main() 未 reject：settings.json 损坏被吞掉了');

    // 临时 root 内被写坏的确实是本用例的文件（隔离自证：不碰真实 ~/.vessel）。
    expect(fs.existsSync(path.join(settingsDir, 'settings.json'))).toBe(true);
  });

  it('② providers.json 损坏 → main(["provider","list"]) reject，且渲染含该路径 + vessel setup 指引', async () => {
    const broken = path.join(providerDir, 'providers.json');
    fs.writeFileSync(broken, '{broken', 'utf8');

    await expect(main(['provider', 'list'])).rejects.toThrow(/providers\.json/);

    let rendered = false;
    try {
      await main(['provider', 'list']);
    } catch (err) {
      rendered = true;
      const f = describeStartupFailure(err);
      expect(f.kind).toBe('config-corrupted');
      expect(f.message).toContain('providers.json');
      expect(f.message).toContain(providerDir);
      expect(f.message).toMatch(/vessel setup/);
      expect(f.message).not.toMatch(/\n\s+at\s/);
    }
    if (!rendered) expect.unreachable('main() 未 reject：providers.json 损坏被吞掉了');
  });

  it('③ 对照：干净的临时 root → main(["settings","list"]) resolve 0（缺文件走默认值，不抛）', async () => {
    await expect(main(['settings', 'list'])).resolves.toBe(0);
  });
});
