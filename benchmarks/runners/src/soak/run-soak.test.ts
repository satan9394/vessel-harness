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
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Mock } from 'vitest';

/** C-4 源码守卫读的就是实现文件本身。 */
const RUN_SOAK_SRC = fileURLToPath(new URL('./run-soak.ts', import.meta.url));

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
  const TRACKED = [
    'SOAK_BASE',
    'SOAK_TASKS',
    'SOAK_ROUNDS',
    'SOAK_HANDOFF_EVERY',
    'SOAK_PAUSE_EVERY',
    'SOAK_MAX_ACCEPTED',
  ] as const;
  const originals: Record<string, string | undefined> = {};
  for (const k of TRACKED) originals[k] = process.env[k];

  afterEach(() => {
    vi.resetModules();
    for (const k of TRACKED) {
      const v = originals[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
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

  /**
   * C-4：同样的重导入手法，但回传 `runSoak` 的**完整入参** —— 于是五个数值参数
   * （`SOAK_TASKS`/`ROUNDS`/`HANDOFF_EVERY`/`PAUSE_EVERY`/`MAX_ACCEPTED`）经 `readInt` 解析成了
   * 什么，是可**行为**断言的事实，不是源码文本匹配。
   */
  async function soakArgs(vars: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    vi.resetModules();
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await import('./run-soak.js');
    const driver = await import('./soak-driver.js');
    const calls = (driver.runSoak as unknown as Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1]![0] as Record<string, unknown>;
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

  /**
   * C-4：五个数值参数的空白判据与 `SOAK_BASE` 同源（`readInt` 的 `v.trim() === ''`）。
   *
   * **本用例非判别**（改动前后同值）：旧写法只显式挡 `''`，纯空白靠 `Number('   ') === 0`
   * 被 `n > 0` 挡回默认值 ⇒ 结论本来就与 `envRoot` 一致。这条钉的是**结论不得漂移**
   * （空/纯空白 ⇒ 与"未设置该来源"同判），判别性由下一条源码守卫承担。
   *
   * 注意 `SOAK_TASKS`/`SOAK_ROUNDS` 的默认值参数取自 `process.argv[2]/[3]`（见 run-soak.ts），
   * 在 vitest 进程里那不是数字 ⇒ 这两项断言的是「纯空白 == 空串」，不是「== 120/30」。
   */
  it('④ 五个数值参数：空串与纯空白同一判据；有值仍逐字使用（负对照）', async () => {
    const keys = ['taskCount', 'totalRounds', 'handoffEveryRounds', 'pauseEveryRounds', 'maxAcceptedRounds'];
    const empty = await soakArgs({
      SOAK_TASKS: '', SOAK_ROUNDS: '', SOAK_HANDOFF_EVERY: '', SOAK_PAUSE_EVERY: '', SOAK_MAX_ACCEPTED: '',
    });
    const blank = await soakArgs({
      SOAK_TASKS: '   ', SOAK_ROUNDS: '\t', SOAK_HANDOFF_EVERY: '   ', SOAK_PAUSE_EVERY: ' ', SOAK_MAX_ACCEPTED: '\n',
    });
    for (const k of keys) expect(blank[k]).toBe(empty[k]);

    // 负对照：有值时行为逐字不变
    const valued = await soakArgs({
      SOAK_TASKS: '7', SOAK_ROUNDS: '9', SOAK_HANDOFF_EVERY: '2', SOAK_PAUSE_EVERY: '3', SOAK_MAX_ACCEPTED: '1',
    });
    expect(valued).toMatchObject({
      taskCount: 7, totalRounds: 9, handoffEveryRounds: 2, pauseEveryRounds: 3, maxAcceptedRounds: 1,
    });
  });

  /**
   * C-4 守卫（判别性）：`readInt` 的空白判据必须是 `v.trim() === ''`（与 `envRoot` 同款），
   * 而不是只挡空串的 `v === ''` —— 改回去 ⇒ 本用例红。
   * （行为两版同值，故这条是**静态守卫**，如实标注：它证明的是"判据同源"，不是行为差异。）
   */
  it('⑤ 判据守卫：readInt 的空白判据与 envRoot/SOAK_BASE 同款（退回 `v === \'\'` ⇒ 红）', () => {
    const src = readFileSync(RUN_SOAK_SRC, 'utf8');
    const at = src.indexOf('function readInt');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 400);
    expect(body).toMatch(/v\.trim\(\) === ''/);
    expect(body).not.toMatch(/v === ''/);
  });
});
