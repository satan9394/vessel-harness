import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorktree, removeWorktree, type GitRunner } from '@cah/tools';
import type { Workspace, LoopTask } from './LoopEngine.js';

/**
 * engine/workspace — isolated per-iteration workspaces (V0.5-M3; task 012;
 * MISSION-V0.5 §三.3). Each LoopEngine iteration executes inside its own
 * isolated directory so artifacts never pollute the main workspace or leak
 * between iterations.
 *
 * Two modes:
 *   - TempDirWorkspaceFactory — fs.mkdtemp under os.tmpdir() (default for
 *     non-git repos; naturally isolated; dispose removes the temp dir).
 *   - GitWorktreeWorkspaceFactory — reuses V0.2 tools/git Worktree.ts when the
 *     repo has a .git (git-managed isolation; dispose = `git worktree remove`).
 *
 * Cleanup discipline: dispose removes ONLY the isolated directory it created
 * (temp dir under os.tmpdir(), or the git-managed worktree). It NEVER touches
 * the main workspace — this is the isolation guarantee tests assert.
 */

export interface WorkspaceFactory {
  create(task: LoopTask): Promise<Workspace>;
  dispose(ws: Workspace): Promise<void>;
}

/** Temp-dir factory: an isolated directory under os.tmpdir() (non-git default). */
export class TempDirWorkspaceFactory implements WorkspaceFactory {
  private readonly prefix: string;

  constructor(prefix = 'cah-engine-') {
    this.prefix = prefix;
  }

  async create(_task: LoopTask): Promise<Workspace> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), this.prefix));
    return { root, meta: { mode: 'tempdir' } };
  }

  async dispose(ws: Workspace): Promise<void> {
    // os.tmpdir() isolated test/product temp dir — same cleanup convention the
    // whole repo uses in tests (see packages/tools/src/git/worktree.test.ts);
    // never a main-workspace path.
    fs.rmSync(ws.root, { recursive: true, force: true });
  }
}

export interface GitWorktreeWorkspaceFactoryOptions {
  repoRoot: string;
  /** base dir for worktree paths (default <repoRoot>/.harness/worktrees) */
  baseDir?: string;
  /** injectable git runner (tests) */
  run?: GitRunner;
  /** branch prefix; sanitized per task id */
  branchPrefix?: string;
}

/** Git-worktree factory: reuses V0.2 tools/git Worktree (git-managed isolation). */
export class GitWorktreeWorkspaceFactory implements WorkspaceFactory {
  constructor(private readonly opts: GitWorktreeWorkspaceFactoryOptions) {}

  async create(task: LoopTask): Promise<Workspace> {
    const branch = `${this.opts.branchPrefix ?? 'it'}-${task.id}`;
    const handle = await createWorktree(this.opts.repoRoot, {
      branch,
      baseDir: this.opts.baseDir,
      run: this.opts.run,
    });
    return { root: handle.path, meta: { mode: 'git-worktree', worktree: handle } };
  }

  async dispose(ws: Workspace): Promise<void> {
    const handle = (ws.meta?.worktree ?? { repoRoot: this.opts.repoRoot, path: ws.root }) as {
      repoRoot: string;
      path: string;
      branch?: string;
    };
    // `git worktree remove` is git-managed; the module never issues its own
    // permanent delete (V0.2 design: removal delegates to git).
    await removeWorktree(handle, { run: this.opts.run });
  }
}

export interface DefaultWorkspaceOptions {
  /** mode override; default: auto-detect .git */
  mode?: 'tempdir' | 'git-worktree';
  repoRoot?: string;
  /** temp-dir prefix when mode=tempdir */
  tempPrefix?: string;
  /** git worktree options when mode=git-worktree */
  worktree?: Omit<GitWorktreeWorkspaceFactoryOptions, 'repoRoot'>;
}

function hasGitDir(repoRoot: string): boolean {
  return fs.existsSync(path.join(repoRoot, '.git'));
}

/**
 * Default factory — auto-detects git worktree vs temp dir, or honors an
 * explicit mode override (explicit mode is what deterministic tests use).
 */
export function createDefaultWorkspaceFactory(opts: DefaultWorkspaceOptions = {}): WorkspaceFactory {
  const repoRoot = path.resolve(opts.repoRoot ?? process.cwd());
  const mode = opts.mode ?? (hasGitDir(repoRoot) ? 'git-worktree' : 'tempdir');
  if (mode === 'git-worktree') {
    return new GitWorktreeWorkspaceFactory({ repoRoot, ...(opts.worktree ?? {}) });
  }
  return new TempDirWorkspaceFactory(opts.tempPrefix);
}
