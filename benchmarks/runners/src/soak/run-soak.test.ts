/**
 * run-soak.ts —— `SOAK_BASE` 的空值口径（本卡第 4 条）。
 *
 * 背景：`run-soak.ts` 是**入口脚本**（顶层直接 `main()`），import 即触发一次 soak 并把报告写进
 * `benchmarks/reports/SOAK-068/<runId>/`（仓库内、**未** gitignore）——所以本用例把
 * `./soak-driver.js` 与 `node:fs` 都注入掉，于是「SOAK_BASE 解析成了哪个 base」变成可**行为**
 * 断言的事实（`runSoak` 的入参 `baseDir`），而不是源码文本匹配。
 *
 * 判别性（「删掉修复就红」）：把 run-soak.ts 的
 *   `const base = path.resolve(envRoot('SOAK_BASE') ?? os.tmpdir());`
 * 换回
 *   `const base = path.resolve(process.env.SOAK_BASE ?? os.tmpdir());`
 * ⇒ ①（空串）与 ①-b（纯空白）立即红：`path.resolve('')` = **进程 CWD**，
 * `path.resolve('   ')` = CWD 下的 `'   '` 子路径。② 负对照（有值时仍用它）两版都绿，
 * 故它证明的是「有值时行为不变」，不是修复本身。
 *
 * 生产调用点：`benchmarks/runners/src/soak/run-soak.ts` 唯一的 `base` 变量 →
 * `runSoak({ baseDir: base })`（stores/workspaces 的临时根）+ 报告 `config.baseDir`。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Mock } from 'vitest';

/**
 * 注入面 1：driver 替身（记录入参并返回一份**完整**观测——`main()` 会对它跑 `summarize()`，
 * 缺字段会让 `main()` 抛错并 `process.exitCode = 1`，污染整个测试进程的退出码）。
 * 工厂被提升，故对象字面量内联在这里（不引用外部绑定）。
 */
vi.mock('./soak-driver.js', () => {
  const obs = {
    label: 'soak-test',
    wsPrefix: 'cah-068-soak-ws-',
    taskCount: 1,
    totalRounds: 1,
    enqueued: 1,
    attempts: 1,
    iterations: 1,
    iterationsPerTask: {},
    finalQueueStatuses: { done: 1 },
    handoffCount: 0,
    handoffChainLength: 0,
    pauseResumeCycles: 0,
    budgetChanges: 0,
    exhausted: null,
    tempResidueFinal: 0,
    storeDirBytes: 0,
    samples: [],
    heapStartMB: 1,
    heapEndMB: 1,
    roundTripQueueReadable: true,
    roundTripIterationTasks: 1,
    roundTripHandoffsReadable: true,
    countConsistent: true,
    resumeProducedIteration: true,
    resumeExtraIteration: null,
    durationMs: 1,
    perTaskAcceptedRounds: {},
  };
  return {
    SOAK_WORKSPACE_PREFIX: 'cah-068-soak-ws-',
    SOAK_STORE_PREFIX: 'cah-068-soak-store-',
    residueCount: () => 0,
    // 必须是 `vi.fn`：用例要读它的入参（`baseDir`）作为「SOAK_BASE 解析成了什么」的证据。
    runSoak: vi.fn(async () => obs),
  };
});

/** 注入面 2：不落盘（否则每次 import 都会在仓库内新建一个 SOAK-068 报告目录）。 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, mkdirSync: () => undefined, writeFileSync: () => undefined };
});

describe('run-soak — SOAK_BASE 空/纯空白 ⇒ os.tmpdir()（绝不落到进程 CWD）', () => {
  /** 进程原始值（本文件被求值时捕一次），`afterEach` 逐字还原。 */
  const originalBase = process.env.SOAK_BASE;

  afterEach(() => {
    vi.resetModules();
    if (originalBase === undefined) delete process.env.SOAK_BASE;
    else process.env.SOAK_BASE = originalBase;
  });

  /**
   * 用给定 `SOAK_BASE` 重新 import 一次 run-soak（顶层 `main()` 会在模块求值期间**同步**
   * 调用 `runSoak`），回传它实际拿到的 `baseDir`。
   */
  async function baseDirFor(value: string | undefined): Promise<string> {
    vi.resetModules();
    if (value === undefined) delete process.env.SOAK_BASE;
    else process.env.SOAK_BASE = value;
    await import('./run-soak.js');
    const driver = await import('./soak-driver.js');
    const calls = (driver.runSoak as unknown as Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return (calls[calls.length - 1]![0] as { baseDir: string }).baseDir;
  }

  it('① 判别性：SOAK_BASE= 空串 ⇒ os.tmpdir()（旧 `??` ⇒ path.resolve(\'\') = 进程 CWD）', async () => {
    const base = await baseDirFor('');
    expect(base).toBe(path.resolve(os.tmpdir()));
    expect(base).not.toBe(path.resolve('')); // = process.cwd()
    expect(base).not.toBe(process.cwd());
  });

  it('①-b 判别性：SOAK_BASE= 纯空白 ⇒ os.tmpdir()（旧 `??` ⇒ CWD 下的空白子路径）', async () => {
    const base = await baseDirFor('   ');
    expect(base).toBe(path.resolve(os.tmpdir()));
    expect(base).not.toBe(process.cwd());
  });

  it('①-c 未设置 ⇒ os.tmpdir()（既有行为，未变）', async () => {
    expect(await baseDirFor(undefined)).toBe(path.resolve(os.tmpdir()));
  });

  it('② 负对照：SOAK_BASE 有值 ⇒ 仍用它（不是 tmpdir），行为逐字不变', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'soak-base-test-'));
    try {
      const base = await baseDirFor(dir);
      expect(base).toBe(path.resolve(dir));
      expect(base).not.toBe(path.resolve(os.tmpdir()));
      // 口径统一带来的唯一（有意）差异：两侧空白被 trim —— 与全仓状态根 `envRoot`
      // 一致（taskqueue/iterations/handoffs/reviews/provider/usage/mcp/session 同款）。
      expect(await baseDirFor(`  ${dir}  `)).toBe(path.resolve(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true }); // 本用例自建、位于 os.tmpdir() 之下
    }
  });
});
