/**
 * packages/shared/atomicWrite —— 原子写统一 EPERM/EBUSY 有界重试（task 113）。
 *
 * 纯 node:fs 函数、零包依赖（shared 是叶子包：无 tsconfig references、无 dependencies，
 * core/application/cli 均可依赖，不会引入环 —— 依赖环检查结论见 tasks/113）。
 *
 * 语义与 101（UsageStore）对齐：3 次尝试、5/15ms 退避、仅 EPERM/EBUSY/EACCES 重试，
 * 其它错误立即抛出；全部尝试失败后抛出最后一次错误（不吞错、不改 tmp+rename 原子语义）。
 *
 * 默认实现：同步路径用 Atomics.wait 阻塞退避（与既有 101 实现一致），异步路径用
 * setTimeout 退避。rename/sleep 均可注入（测试 mock）；默认 rename 走 fs 命名空间
 * 动态属性访问，vitest spyOn(fs.renameSync / fs.promises.rename) 亦可拦截。
 */
import * as fs from 'node:fs';

/** 尝试次数（与 101 UsageStore 对齐）。 */
export const RENAME_RETRY_ATTEMPTS = 3;

/** 每次失败后的退避（ms）：第 1 次失败后 5ms，第 2 次失败后 15ms（与 101 对齐）。 */
export const RENAME_RETRY_DELAYS_MS = [5, 15] as const;

/** Windows 杀软/索引器瞬时锁文件对应的错误码 —— 仅这些可重试。 */
export const RENAME_RETRYABLE_CODES = ['EPERM', 'EBUSY', 'EACCES'] as const;

function isRetryable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

export interface RenameWithRetryOptions {
  /** 尝试次数（缺省 RENAME_RETRY_ATTEMPTS = 3）。 */
  attempts?: number;
  /** 第 N 次失败后的退避毫秒数（缺省 RENAME_RETRY_DELAYS_MS = [5, 15]；越界取末位）。 */
  retryDelaysMs?: readonly number[];
  /** 退避实现（测试注入；缺省 Atomics.wait 阻塞式）。 */
  sleep?: (ms: number) => void;
  /** rename 实现（测试注入；缺省 fs.renameSync）。 */
  rename?: (tmp: string, dest: string) => void;
}

/** 阻塞式退避（与 101 同款；同步 fs API 无法 await，用 Atomics.wait）。 */
export function sleepBlocking(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 同步原子替换：tmp + rename，Windows 锁错误（EPERM/EBUSY/EACCES）有界重试
 * （3 次 / 5/15ms）；其它错误立即抛；全部尝试失败抛最后一次错误。
 */
export function renameWithRetry(tmp: string, dest: string, opts: RenameWithRetryOptions = {}): void {
  const attempts = opts.attempts ?? RENAME_RETRY_ATTEMPTS;
  const delays = opts.retryDelaysMs ?? RENAME_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? sleepBlocking;
  const rename = opts.rename ?? ((a, b) => fs.renameSync(a, b));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rename(tmp, dest);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;
      const delay = delays[attempt] ?? delays[delays.length - 1] ?? 0;
      if (attempt < attempts - 1 && delay > 0) sleep(delay);
    }
  }
  throw lastError;
}

export interface RenameWithRetryAsyncOptions {
  /** 尝试次数（缺省 RENAME_RETRY_ATTEMPTS = 3）。 */
  attempts?: number;
  /** 第 N 次失败后的退避毫秒数（缺省 RENAME_RETRY_DELAYS_MS = [5, 15]；越界取末位）。 */
  retryDelaysMs?: readonly number[];
  /** 退避实现（测试注入；缺省 setTimeout）。 */
  sleep?: (ms: number) => Promise<void>;
  /** rename 实现（测试注入；缺省 fs.promises.rename）。 */
  rename?: (tmp: string, dest: string) => Promise<void>;
}

/**
 * 异步原子替换（Session.replaceRegion 用 fs.promises 路径）——重试语义与同步版一致。
 */
export async function renameWithRetryAsync(
  tmp: string,
  dest: string,
  opts: RenameWithRetryAsyncOptions = {},
): Promise<void> {
  const attempts = opts.attempts ?? RENAME_RETRY_ATTEMPTS;
  const delays = opts.retryDelaysMs ?? RENAME_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const rename = opts.rename ?? ((a, b) => fs.promises.rename(a, b));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(tmp, dest);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;
      const delay = delays[attempt] ?? delays[delays.length - 1] ?? 0;
      if (attempt < attempts - 1 && delay > 0) await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * 便捷函数：写入 tmp 文件后 renameWithRetry。tmp 路径由调用方按既有约定给出
 * （不改变各调用点既有 tmp 命名），原子语义保持不变。
 */
export function writeFileAtomic(tmp: string, dest: string, data: string, opts: RenameWithRetryOptions = {}): void {
  fs.writeFileSync(tmp, data, 'utf8');
  renameWithRetry(tmp, dest, opts);
}