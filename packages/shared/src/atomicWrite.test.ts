import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { renameWithRetry, renameWithRetryAsync, statWithRetry, sleepBlocking } from './atomicWrite.js';

function lockError(code: string, message = 'locked'): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

describe('atomicWrite renameWithRetry (sync, task 113)', () => {
  it('EPERM 前 2 次失败、第 3 次成功（mock 注入 rename；5/15ms 退避）', () => {
    const rename = vi
      .fn()
      .mockImplementationOnce(() => {
        throw lockError('EPERM');
      })
      .mockImplementationOnce(() => {
        throw lockError('EPERM');
      })
      .mockImplementationOnce(() => undefined);
    const sleep = vi.fn();
    renameWithRetry('a.tmp', 'a.json', { rename, sleep });
    expect(rename).toHaveBeenCalledTimes(3);
    expect(rename.mock.calls.map((c) => c[0])).toEqual(['a.tmp', 'a.tmp', 'a.tmp']);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]![0]).toBe(5);
    expect(sleep.mock.calls[1]![0]).toBe(15);
  });

  it('EBUSY 重试耗尽（3 次）后抛出最后一次错误', () => {
    const boom = lockError('EBUSY', 'busy');
    const rename = vi.fn(() => {
      throw boom;
    });
    const sleep = vi.fn();
    let caught: unknown;
    try {
      renameWithRetry('a.tmp', 'a.json', { rename, sleep });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);
    expect(rename).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('非锁错误（ENOENT）立即抛出、不重试、不退避', () => {
    const boom = lockError('ENOENT', 'noent');
    const rename = vi.fn(() => {
      throw boom;
    });
    const sleep = vi.fn();
    let caught: unknown;
    try {
      renameWithRetry('a.tmp', 'a.json', { rename, sleep });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('EACCES 同属可重试集：前 1 次失败后第 2 次成功', () => {
    const rename = vi
      .fn()
      .mockImplementationOnce(() => {
        throw lockError('EACCES');
      })
      .mockImplementationOnce(() => undefined);
    const sleep = vi.fn();
    renameWithRetry('a.tmp', 'a.json', { rename, sleep });
    expect(rename).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('真实 fs 往返（默认实现）：tmp 消失、目标被原子替换', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-atomic-'));
    try {
      const dest = path.join(dir, 'out.json');
      const tmp = path.join(dir, 'out.json.tmp');
      fs.writeFileSync(tmp, '{"ok":true}', 'utf8');
      renameWithRetry(tmp, dest);
      expect(fs.existsSync(tmp)).toBe(false);
      expect(JSON.parse(fs.readFileSync(dest, 'utf8'))).toEqual({ ok: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('atomicWrite renameWithRetryAsync (async, task 113)', () => {
  it('EPERM 前 2 次失败、第 3 次成功（异步注入 rename）', async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(lockError('EPERM'))
      .mockRejectedValueOnce(lockError('EPERM'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await renameWithRetryAsync('a.tmp', 'a.json', { rename, sleep });
    expect(rename).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]![0]).toBe(5);
    expect(sleep.mock.calls[1]![0]).toBe(15);
  });

  it('非锁错误（ENOENT）立即抛出、不重试', async () => {
    const boom = lockError('ENOENT');
    const rename = vi.fn().mockRejectedValueOnce(boom);
    const sleep = vi.fn().mockResolvedValue(undefined);
    let caught: unknown;
    try {
      await renameWithRetryAsync('a.tmp', 'a.json', { rename, sleep });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('真实 fs 往返（默认实现）：目标被原子替换', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-atomic-async-'));
    try {
      const dest = path.join(dir, 'out.json');
      const tmp = path.join(dir, 'out.json.tmp');
      await fs.promises.writeFile(tmp, '{"ok":true}', 'utf8');
      await renameWithRetryAsync(tmp, dest);
      expect(fs.existsSync(tmp)).toBe(false);
      expect(JSON.parse(fs.readFileSync(dest, 'utf8'))).toEqual({ ok: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('atomicWrite statWithRetry (sync, task 115)', () => {
  it('EPERM 前 2 次失败、第 3 次成功（mock 注入 stat；5/15ms 退避与 rename 同语义）', () => {
    const stat = vi
      .fn()
      .mockImplementationOnce(() => {
        throw lockError('EPERM');
      })
      .mockImplementationOnce(() => {
        throw lockError('EPERM');
      })
      .mockImplementationOnce(() => ({ mtimeMs: 42 }) as fs.Stats);
    const sleep = vi.fn();
    const stats = statWithRetry('meta.json', { stat, sleep });
    expect(stats.mtimeMs).toBe(42);
    expect(stat).toHaveBeenCalledTimes(3);
    expect(stat.mock.calls.map((c) => c[0])).toEqual(['meta.json', 'meta.json', 'meta.json']);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]![0]).toBe(5);
    expect(sleep.mock.calls[1]![0]).toBe(15);
  });

  it('EBUSY 重试耗尽（3 次）后抛出最后一次错误（不吞错 —— 调用方据此降级）', () => {
    const boom = lockError('EBUSY', 'busy');
    const stat = vi.fn(() => {
      throw boom;
    });
    const sleep = vi.fn();
    let caught: unknown;
    try {
      statWithRetry('meta.json', { stat, sleep });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);
    expect(stat).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('非锁错误（ENOENT）立即抛出、不重试、不退避（ENOENT = meta 真缺失，交还调用方判定）', () => {
    const boom = lockError('ENOENT', 'noent');
    const stat = vi.fn(() => {
      throw boom;
    });
    const sleep = vi.fn();
    let caught: unknown;
    try {
      statWithRetry('meta.json', { stat, sleep });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(boom);
    expect(stat).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('默认实现真实 fs 往返：返回真实 Stats（mtimeMs 可用）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-atomic-stat-'));
    try {
      const file = path.join(dir, 'meta.json');
      fs.writeFileSync(file, '{}', 'utf8');
      const stats = statWithRetry(file);
      expect(stats.mtimeMs).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('atomicWrite sleepBlocking', () => {
  it('阻塞指定毫秒（不抛错）', () => {
    const start = Date.now();
    sleepBlocking(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });
});