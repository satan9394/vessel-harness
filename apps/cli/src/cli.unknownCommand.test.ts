import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { main } from './cli.js';

/**
 * 未知子命令分派（G-02 / BRIEF-01 S1）。
 *
 * `vessel foo`、`vessel chat` 必须报错并 exit 2，绝不静默当作一次 run；
 * 已知命令不得被误拦。环境隔离：只把 VESSEL_*_ROOT 指向 tmp 子路径
 * （不创建目录）——三条用例都在 store 访问之前返回，不写盘、不碰真实 ~/.vessel。
 */
const STATE_DIR = path.join(os.tmpdir(), 'vessel-unknowncmd-test');
// G-10：`main()` 的默认会话登记（`new SessionRegistry()`）也解析 env 根，
// 加进数组即自动获得 beforeEach 注入 + afterEach 还原（一处改动覆盖全部用例）。
const ROOT_ENV = ['VESSEL_PROVIDER_ROOT', 'VESSEL_USAGE_ROOT', 'VESSEL_SETTINGS_ROOT', 'VESSEL_SESSION_ROOT'] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ROOT_ENV) {
    saved.set(key, process.env[key]);
    process.env[key] = path.join(STATE_DIR, key.toLowerCase());
  }
});

afterEach(() => {
  for (const key of ROOT_ENV) {
    const prev = saved.get(key);
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
  vi.restoreAllMocks();
});

describe('未知子命令分派（G-02）', () => {
  it('未知子命令 foo → exit 2 且提示 vessel --help', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['foo']);
    expect(code).toBe(2);
    const text = err.mock.calls.flat().join(' ');
    expect(text).toContain('未知命令');
    expect(text).toContain('vessel --help');
  });

  it('chat 不是子命令（TUI 入口是无参 vessel）→ exit 2', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['chat']);
    expect(code).toBe(2);
    expect(err.mock.calls.flat().join(' ')).toContain('未知命令');
  });

  it('对照：已知命令 list-terms 未被误拦 → exit 0', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['list-terms']);
    expect(code).toBe(0);
  });
});
