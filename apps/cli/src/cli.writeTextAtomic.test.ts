import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { main } from './cli.js';

// node:fs 的 ESM 命名空间导出 non-configurable（vitest 2.1.9 报 "Cannot redefine property"），
// 沿用 113 vi.mock 方案：默认真实委托的 renameSync，供 task 114 EPERM 有界重试注入；
// 其余 API 原样委托，不影响本文件其它用例（本文件只覆盖 writeTextAtomic 收敛点）。
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const renameSync = actual.renameSync;
  return {
    ...actual,
    renameSync: vi.fn((...args: Parameters<typeof renameSync>) => renameSync(...args)),
  };
});

describe('cli.ts writeTextAtomic → renameWithRetry（task 114）', () => {
  let dir: string;
  let out: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-114-'));
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-114-out-'));
    process.env.VESSEL_PROVIDER_ROOT = dir;
    // G-10：会话登记根同款指向临时 dir（本用例的 main() 路径若构造默认 SessionRegistry，
    // 也绝不写真实 ~/.vessel/sessions.json）。本文件沿用「直接 delete」的既有还原写法。
    process.env.VESSEL_SESSION_ROOT = dir;
  });
  afterEach(() => {
    delete process.env.VESSEL_PROVIDER_ROOT;
    delete process.env.VESSEL_SESSION_ROOT;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('provider export --out 在 rename 瞬时 EPERM 下经 helper 有界重试后写盘成功（helper 复用确认）', async () => {
    fs.writeFileSync(
      path.join(dir, 'providers.json'),
      JSON.stringify([
        {
          id: 'ds',
          name: 'DS',
          protocol: 'openai-compatible',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
        },
      ]),
      'utf8',
    );
    const renameSync = vi.mocked(fs.renameSync);
    renameSync.mockClear();
    renameSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    });
    renameSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    });
    const outFile = path.join(out, 'export.json');
    const code = await main(['provider', 'export', '--out', outFile]);
    expect(code).toBe(0);
    // helper 复用确认：裸 fs.renameSync 第 2 次 EPERM 即抛出；走到 3 次 = writeTextAtomic 已收敛到 renameWithRetry
    expect(renameSync).toHaveBeenCalledTimes(3);
    const text = fs.readFileSync(outFile, 'utf8');
    expect(text).toContain('vessel-provider-export');
    expect(fs.existsSync(`${outFile}.tmp`)).toBe(false); // 原子写无残留
  });
});