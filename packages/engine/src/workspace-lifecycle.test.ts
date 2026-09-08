import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  LoopEngine,
  type LoopEngineDeps,
  type LoopTask,
  type Workspace,
  type GeneratorOutput,
} from './LoopEngine.js';
import { TempDirWorkspaceFactory, GitWorktreeWorkspaceFactory } from './workspace.js';
import type { EvaluatorVerdict } from '@vessel/agents';

/**
 * engine — workspace/worktree lifecycle (task 064).
 *
 * Regression target: 062 known issue "LoopEngine attempt1 的 workspace 不 dispose" —
 * on a retry the engine used to create a NEW workspace and overwrite the
 * reference, so every earlier attempt's temp dir / git worktree leaked under
 * os.tmpdir(). The lifecycle contract: every attempt workspace is disposed
 * exactly once when the attempt ends — met/stopped admit, retry, exception,
 * interruption — and no main-workspace path is ever touched.
 *
 * Temp-dir mode asserts REAL os.tmpdir residue: prefix-scoped (unique per
 * test), dispose is awaited before run()/runTask() resolves, so a leftover
 * directory is a true leak. Git-worktree mode wires the real factory seam with
 * an injected fake git runner (repo convention — no real git spawn in tests)
 * and asserts a balanced create(add)→use→remove closed loop per attempt.
 */

const TASK: LoopTask = { id: 't1', goal: '写一个文件', acceptance: ['GOLDEN'] };

function tmpPrefix(tag: string): string {
  return `cah-064-${tag}-`;
}

/** dirs under os.tmpdir() matching a prefix (leak detector). */
function residue(prefix: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(os.tmpdir());
  } catch {
    return [];
  }
  return names.filter((n) => n.startsWith(prefix)).sort();
}

function metVerdict(reason = 'acceptance present'): EvaluatorVerdict {
  return { verdict: 'met', evidence: ['GOLDEN'], reason };
}

function notMetVerdict(reason: string): EvaluatorVerdict {
  return { verdict: 'not_met', evidence: ['missing'], reason };
}

/** engine deps whose generate/evaluate are injected per test. */
function baseDeps(overrides: Partial<LoopEngineDeps>): LoopEngineDeps {
  return {
    selectTask: async () => TASK,
    generate: async () => ({ output: 'gen GOLDEN' }) as GeneratorOutput,
    evaluate: async () => metVerdict(),
    persist: async () => {},
    ...overrides,
  };
}

describe('engine — workspace lifecycle: retry multi-attempt cleanup (task 064)', () => {
  it('attempt1 workspace is disposed when a retry creates a fresh workspace (062 regression)', async () => {
    const prefix = tmpPrefix('retry');
    const f = new TempDirWorkspaceFactory(prefix);
    const created: string[] = [];
    const disposed: string[] = [];
    // attempt1 → not_met → retry; attempt2 → met
    const evaluate = async (ctx: { attempt: number }): Promise<EvaluatorVerdict> =>
      ctx.attempt === 1 ? notMetVerdict('attempt gate') : metVerdict();
    const engine = new LoopEngine(
      baseDeps({
        evaluate: evaluate as unknown as LoopEngineDeps['evaluate'],
        workspaceFactory: async (t) => {
          const ws = await f.create(t);
          created.push(ws.root);
          return ws;
        },
        disposeWorkspace: async (ws) => {
          disposed.push(ws.root);
          await f.dispose(ws);
        },
      }),
      { maxRetries: 1 },
    );

    const report = await engine.run();

    expect(report?.outcome).toBe('met');
    expect(report?.result.retryCount).toBe(2);
    // two attempts → two distinct workspaces created…
    expect(created).toHaveLength(2);
    expect(new Set(created).size).toBe(2);
    // …and BOTH disposed exactly once (pre-064: only the last was disposed)
    expect(disposed).toHaveLength(2);
    expect(disposed).toEqual(created);
    // no real temp-dir residue
    expect(residue(prefix)).toEqual([]);
    for (const root of created) expect(fs.existsSync(root)).toBe(false);
  });

  it('stopped after exhausting retries: every attempt workspace is disposed', async () => {
    const prefix = tmpPrefix('stop');
    const f = new TempDirWorkspaceFactory(prefix);
    const created: string[] = [];
    const engine = new LoopEngine(
      baseDeps({
        evaluate: async () => notMetVerdict('never met'),
        workspaceFactory: async (t) => {
          const ws = await f.create(t);
          created.push(ws.root);
          return ws;
        },
        disposeWorkspace: async (ws) => f.dispose(ws),
      }),
      { maxRetries: 2 }, // 3 attempts, all not_met → stopped
    );

    const report = await engine.run();

    expect(report?.outcome).toBe('stopped');
    expect(report?.result.verdict).toBe('not_met');
    expect(report?.result.retryCount).toBe(3);
    expect(created).toHaveLength(3);
    expect(residue(prefix)).toEqual([]);
    for (const root of created) expect(fs.existsSync(root)).toBe(false);
  });

  it('met on the first attempt still disposes its single workspace exactly once', async () => {
    const prefix = tmpPrefix('single');
    const f = new TempDirWorkspaceFactory(prefix);
    const created: string[] = [];
    const disposed: string[] = [];
    const engine = new LoopEngine(
      baseDeps({
        workspaceFactory: async (t) => {
          const ws = await f.create(t);
          created.push(ws.root);
          return ws;
        },
        disposeWorkspace: async (ws) => {
          disposed.push(ws.root);
          await f.dispose(ws);
        },
      }),
      { maxRetries: 3 }, // met on attempt1 → no retry despite allowance
    );

    const report = await engine.run();
    expect(report?.outcome).toBe('met');
    expect(report?.result.retryCount).toBe(1);
    expect(created).toHaveLength(1);
    expect(disposed).toEqual(created);
    expect(residue(prefix)).toEqual([]);
    expect(fs.existsSync(created[0]!)).toBe(false);
  });
});

describe('engine — workspace lifecycle: exception & interruption cleanup (task 064)', () => {
  it('exception inside generate: the attempt workspace is disposed before the error propagates', async () => {
    const prefix = tmpPrefix('err');
    const f = new TempDirWorkspaceFactory(prefix);
    const created: string[] = [];
    const engine = new LoopEngine(
      baseDeps({
        generate: async () => {
          throw new Error('generator exploded');
        },
        workspaceFactory: async (t) => {
          const ws = await f.create(t);
          created.push(ws.root);
          return ws;
        },
        disposeWorkspace: async (ws) => f.dispose(ws),
      }),
      {},
    );

    await expect(engine.run()).rejects.toThrow(/generator exploded/);
    expect(created).toHaveLength(1);
    expect(residue(prefix)).toEqual([]);
    expect(fs.existsSync(created[0]!)).toBe(false);
  });

  it('interruption (050 semantics — rejected generate mid-retry): earlier + current attempt both disposed', async () => {
    const prefix = tmpPrefix('intr');
    const f = new TempDirWorkspaceFactory(prefix);
    const created: string[] = [];
    let attempt = 0;
    const engine = new LoopEngine(
      baseDeps({
        // attempt1 runs normally and is not_met → retry; attempt2 gets
        // interrupted (an aborted developer session surfaces as a rejection).
        generate: async () => {
          attempt += 1;
          if (attempt === 2) throw new Error('interrupted: attempt aborted');
          return { output: 'gen GOLDEN' } as GeneratorOutput;
        },
        evaluate: async () => notMetVerdict('retry gate'),
        workspaceFactory: async (t) => {
          const ws = await f.create(t);
          created.push(ws.root);
          return ws;
        },
        disposeWorkspace: async (ws) => f.dispose(ws),
      }),
      { maxRetries: 1 },
    );

    await expect(engine.run()).rejects.toThrow(/interrupted/);
    expect(created).toHaveLength(2);
    expect(residue(prefix)).toEqual([]);
    for (const root of created) expect(fs.existsSync(root)).toBe(false);
  });

  it('exception in evaluate on the final attempt: still disposed, no residue', async () => {
    const prefix = tmpPrefix('evale');
    const f = new TempDirWorkspaceFactory(prefix);
    const created: string[] = [];
    const engine = new LoopEngine(
      baseDeps({
        evaluate: async () => {
          throw new Error('evaluator exploded');
        },
        workspaceFactory: async (t) => {
          const ws = await f.create(t);
          created.push(ws.root);
          return ws;
        },
        disposeWorkspace: async (ws) => f.dispose(ws),
      }),
      { maxRetries: 1 },
    );

    await expect(engine.run()).rejects.toThrow(/evaluator exploded/);
    // exception on attempt1 aborts the iteration — only one workspace existed
    expect(created).toHaveLength(1);
    expect(residue(prefix)).toEqual([]);
    expect(fs.existsSync(created[0]!)).toBe(false);
  });
});

describe('engine — workspace lifecycle: idempotency & main-workspace isolation (task 064)', () => {
  it('engine never double-disposes a workspace across a retry loop', async () => {
    const prefix = tmpPrefix('idem');
    const f = new TempDirWorkspaceFactory(prefix);
    const createCalls: string[] = [];
    const disposeCalls: string[] = [];
    const evaluate = async (ctx: { attempt: number }): Promise<EvaluatorVerdict> =>
      ctx.attempt === 1 ? notMetVerdict('again') : metVerdict();
    const engine = new LoopEngine(
      baseDeps({
        evaluate: evaluate as unknown as LoopEngineDeps['evaluate'],
        workspaceFactory: async (t) => {
          const ws = await f.create(t);
          createCalls.push(ws.root);
          return ws;
        },
        disposeWorkspace: async (ws) => {
          disposeCalls.push(ws.root);
          await f.dispose(ws);
        },
      }),
      { maxRetries: 2 }, // attempt1 not_met → attempt2 met (no attempt3)
    );

    const report = await engine.run();
    expect(report?.outcome).toBe('met');
    expect(createCalls).toHaveLength(2);
    expect(disposeCalls).toEqual(createCalls); // each created root disposed once, none twice
    expect(residue(prefix)).toEqual([]);
  });

  it('TempDir factory dispose is idempotent (double dispose is a safe no-op)', async () => {
    const f = new TempDirWorkspaceFactory(tmpPrefix('factory'));
    const ws = await f.create(TASK);
    await f.dispose(ws);
    await f.dispose(ws); // second dispose must not throw
    expect(fs.existsSync(ws.root)).toBe(false);
  });

  it('main workspace stays untouched through a retry loop (isolation guarantee intact)', async () => {
    const main = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-main-064-'));
    try {
      const prefix = tmpPrefix('mainiso');
      const f = new TempDirWorkspaceFactory(prefix);
      const engine = new LoopEngine(
        baseDeps({
          generate: async (ctx) => {
            // artifact stays INSIDE the isolated workspace only
            fs.writeFileSync(path.join(ctx.workspace.root, 'gen.txt'), 'generated', 'utf8');
            return { output: 'done GOLDEN', artifactPaths: [path.join(ctx.workspace.root, 'gen.txt')] };
          },
          evaluate: async (ctx: { attempt: number }): Promise<EvaluatorVerdict> =>
            ctx.attempt === 1 ? notMetVerdict('gate') : metVerdict(),
          workspaceFactory: (t) => f.create(t),
          disposeWorkspace: (ws) => f.dispose(ws),
        }),
        { maxRetries: 1 },
      );

      const report = await engine.run();
      expect(report?.outcome).toBe('met');
      expect(fs.readdirSync(main)).toEqual([]); // main workspace: zero files
      expect(residue(prefix)).toEqual([]);
    } finally {
      fs.rmSync(main, { recursive: true, force: true }); // test-created tmp dir cleanup (repo convention)
    }
  });

  it('guardDeps fails loud when workspaceFactory is wired without disposeWorkspace', () => {
    const deps = baseDeps({
      workspaceFactory: async () => ({ root: os.tmpdir() }) as Workspace,
    });
    delete deps.disposeWorkspace;
    expect(() => new LoopEngine(deps)).toThrow(/disposeWorkspace.*workspaceFactory/);
  });
});

describe('engine — workspace lifecycle: multi-iteration run (task 064)', () => {
  it('maxIterations>1: every task iteration workspace is disposed', async () => {
    const prefix = tmpPrefix('multi');
    const f = new TempDirWorkspaceFactory(prefix);
    const tasks = [{ id: 'a', goal: 'ga' }, { id: 'b', goal: 'gb' }, null];
    let i = 0;
    const created: string[] = [];
    const engine = new LoopEngine(
      baseDeps({
        selectTask: async (): Promise<LoopTask | null> => (i < tasks.length ? (tasks[i++] as LoopTask) : null),
        shouldContinue: async () => true,
        workspaceFactory: async (t) => {
          const ws = await f.create(t);
          created.push(ws.root);
          return ws;
        },
        disposeWorkspace: async (ws) => f.dispose(ws),
      }),
      { maxIterations: 10 },
    );

    const report = await engine.run();
    expect(report?.taskId).toBe('b'); // stops when the queue empties
    expect(created).toHaveLength(2); // task a + task b each ran one attempt
    expect(residue(prefix)).toEqual([]);
    for (const root of created) expect(fs.existsSync(root)).toBe(false);
  });
});

describe('engine — workspace lifecycle: git-worktree mode closed loop (task 064)', () => {
  it('create(git worktree add) → use → dispose(git worktree remove) per attempt, balanced on retry', async () => {
    // fake git runner records the worktree add/remove commands the factory
    // issues (repo convention — no real git spawn in tests, V0.2 same style).
    const calls: string[][] = [];
    const fakeRun = async (args: string[], _opts: { cwd: string }) => {
      calls.push(args);
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-wt-repo-064-'));
    fs.mkdirSync(path.join(repoRoot, '.git')); // factory asserts a git repo root
    try {
      const f = new GitWorktreeWorkspaceFactory({ repoRoot, run: fakeRun as never });
      const evaluate = async (ctx: { attempt: number }): Promise<EvaluatorVerdict> =>
        ctx.attempt === 1 ? notMetVerdict('git retry gate') : metVerdict();
      const engine = new LoopEngine(
        baseDeps({
          evaluate: evaluate as unknown as LoopEngineDeps['evaluate'],
          workspaceFactory: (t) => f.create(t),
          disposeWorkspace: (ws) => f.dispose(ws),
        }),
        { maxRetries: 1 }, // attempt1 not_met → attempt2 met → 2 worktrees total
      );

      const report = await engine.run();
      expect(report?.outcome).toBe('met');
      expect(report?.result.retryCount).toBe(2);

      const adds = calls.filter((a) => a[0] === 'worktree' && a[1] === 'add');
      const removes = calls.filter((a) => a[0] === 'worktree' && a[1] === 'remove');
      // closed loop: one add per attempt and one remove per add (attempt1's
      // worktree is removed before attempt2's add — nothing leaks).
      expect(adds).toHaveLength(2);
      expect(removes).toHaveLength(2);
      expect(adds.map((a) => a[a.length - 1])).toEqual(removes.map((r) => r[r.length - 1]));
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true }); // test-created tmp repo cleanup
    }
  });

  it('exception mid-iteration: the git worktree is still removed (dispose seam fires)', async () => {
    const calls: string[][] = [];
    const fakeRun = async (args: string[], _opts: { cwd: string }) => {
      calls.push(args);
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-wt-repo2-064-'));
    fs.mkdirSync(path.join(repoRoot, '.git'));
    try {
      const f = new GitWorktreeWorkspaceFactory({ repoRoot, run: fakeRun as never });
      const engine = new LoopEngine(
        baseDeps({
          generate: async () => {
            throw new Error('git run exploded');
          },
          workspaceFactory: (t) => f.create(t),
          disposeWorkspace: (ws) => f.dispose(ws),
        }),
        {},
      );

      await expect(engine.run()).rejects.toThrow(/git run exploded/);
      const adds = calls.filter((a) => a[0] === 'worktree' && a[1] === 'add');
      const removes = calls.filter((a) => a[0] === 'worktree' && a[1] === 'remove');
      expect(adds).toHaveLength(1);
      expect(removes).toHaveLength(1); // created worktree removed even on exception
      expect(removes[0]![removes[0]!.length - 1]).toBe(adds[0]![adds[0]!.length - 1]);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
