import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TempDirWorkspaceFactory, GitWorktreeWorkspaceFactory, createDefaultWorkspaceFactory } from './workspace.js';
import { LoopEngine, type Workspace, type LoopTask } from './LoopEngine.js';
import type { EvaluatorVerdict } from '@vessel/agents';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const TASK: LoopTask = { id: 't1', goal: '写一个文件' };

describe('engine — TempDirWorkspaceFactory (V0.5-M3)', () => {
  let ws: Workspace | undefined;
  afterEach(async () => {
    if (ws) {
      await new TempDirWorkspaceFactory().dispose(ws);
      ws = undefined;
    }
  });

  it('creates an isolated temp dir under os.tmpdir()', async () => {
    const f = new TempDirWorkspaceFactory();
    ws = await f.create(TASK);
    expect(ws.root.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(ws.root)).toBe(true);
    // isolated: does not contain main-workspace files
    const entries = fs.readdirSync(ws.root);
    expect(entries).toEqual([]);
  });

  it('dispose removes only the isolated dir', async () => {
    const f = new TempDirWorkspaceFactory();
    ws = await f.create(TASK);
    fs.writeFileSync(path.join(ws.root, 'artifact.txt'), 'hello', 'utf8');
    const root = ws.root;
    await f.dispose(ws);
    ws = undefined;
    expect(fs.existsSync(root)).toBe(false);
  });

  it('artifact writes stay inside the isolated dir (main workspace untouched)', async () => {
    const main = tmpDir('cah-main-');
    const f = new TempDirWorkspaceFactory();
    const engine = new LoopEngine(
      {
        selectTask: async () => TASK,
        generate: async (ctx) => {
          fs.writeFileSync(path.join(ctx.workspace.root, 'gen.txt'), 'generated', 'utf8');
          return { output: 'done GOLDEN', artifactPaths: [path.join(ctx.workspace.root, 'gen.txt')] };
        },
        evaluate: async () => ({ verdict: 'met', evidence: ['GOLDEN'], reason: 'ok' }) as EvaluatorVerdict,
        persist: async () => {},
        workspaceFactory: f.create.bind(f),
        disposeWorkspace: f.dispose.bind(f),
      },
      {},
    );
    const report = await engine.run();
    expect(report?.outcome).toBe('met');
    // main workspace has zero new files
    const mainEntries = fs.readdirSync(main);
    expect(mainEntries).toEqual([]);
    fs.rmSync(main, { recursive: true, force: true });
  });
});

describe('engine — createDefaultWorkspaceFactory (V0.5-M3)', () => {
  it('explicit tempdir mode returns a TempDirWorkspaceFactory', () => {
    const f = createDefaultWorkspaceFactory({ mode: 'tempdir', repoRoot: process.cwd() });
    expect(f).toBeInstanceOf(TempDirWorkspaceFactory);
  });

  it('explicit git-worktree mode returns a GitWorktreeWorkspaceFactory', () => {
    const f = createDefaultWorkspaceFactory({ mode: 'git-worktree', repoRoot: process.cwd() });
    expect(f).toBeInstanceOf(GitWorktreeWorkspaceFactory);
  });

  it('auto-detect: temp dir when the repo root has no .git', () => {
    const nonGit = tmpDir('cah-nongit-');
    const f = createDefaultWorkspaceFactory({ repoRoot: nonGit });
    expect(f).toBeInstanceOf(TempDirWorkspaceFactory);
    fs.rmSync(nonGit, { recursive: true, force: true });
  });

  it('GitWorktreeWorkspaceFactory dispose routes through the injected git runner', async () => {
    // inject a fake runner that records calls — the factory issues git worktree
    // commands through the runner only (no real git needed in tests)
    const calls: string[][] = [];
    const fakeRun = async (args: string[], _opts: { cwd: string }) => {
      calls.push(args);
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    const worktreeDir = tmpDir('cah-wt-');
    const repoRoot = tmpDir('cah-wtrepo-');
    const f = new GitWorktreeWorkspaceFactory({ repoRoot, run: fakeRun as never, baseDir: worktreeDir });
    const handle = { repoRoot, path: path.join(worktreeDir, 'wt_test'), branch: 'it-t1' };
    await f.dispose({ root: handle.path, meta: { worktree: handle } });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]![0]).toBe('worktree');
    expect(calls[0]![1]).toBe('remove');
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });
});
