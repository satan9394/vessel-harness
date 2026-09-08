import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { runCommand } from '@vessel/runtime';

/**
 * tools/git — Git Worktree (MISSION V0.2-M6, optional): isolated working trees
 * for parallel subagents. The git binary is behind an injectable GitRunner so
 * tests can verify behavior without a real `git` spawn (and so future runners
 * can redirect to containers/remote). Removal delegates to `git worktree
 * remove` (git-managed); this module never issues its own permanent delete.
 */
export interface GitRunner {
  (args: string[], opts: { cwd: string }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export const defaultGitRunner: GitRunner = async (args, opts) => {
  const r = await runCommand('git', args, { cwd: opts.cwd, timeoutMs: 60_000, maxOutputBytes: 1024 * 1024 });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode ?? 1 };
};

export interface CreateWorktreeOptions {
  /** branch to create (sanitized: [A-Za-z0-9._/-], leading '-' stripped) */
  branch?: string;
  /** target worktree path; default <baseDir>/wt_<ts>_<rand> */
  path?: string;
  /** parent dir for default worktree paths; default <repoRoot>/.harness/worktrees */
  baseDir?: string;
  run?: GitRunner;
}

export interface WorktreeHandle {
  repoRoot: string;
  path: string;
  branch?: string;
}

export function sanitizeBranch(name: string): string {
  const clean = name.trim().replace(/[^A-Za-z0-9._/-]/g, '-').replace(/^-+/, '');
  if (!clean) throw new Error('worktree error: branch name is empty after sanitization');
  return clean;
}

function assertGitRepo(root: string): void {
  if (!fs.existsSync(path.join(root, '.git'))) {
    throw new Error(`worktree error: not a git repository root: ${root}`);
  }
}

/** Create a git worktree for an isolated working tree (parallel subagents). */
export async function createWorktree(repoRoot: string, opts: CreateWorktreeOptions = {}): Promise<WorktreeHandle> {
  const root = path.resolve(repoRoot);
  assertGitRepo(root);
  const branch = opts.branch ? sanitizeBranch(opts.branch) : undefined;
  const base = path.resolve(opts.baseDir ?? path.join(root, '.harness', 'worktrees'));
  fs.mkdirSync(base, { recursive: true });
  const target = opts.path ? path.resolve(opts.path) : path.join(base, `wt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
  const run = opts.run ?? defaultGitRunner;
  const args = ['worktree', 'add'];
  if (branch) args.push('-b', branch);
  args.push(target);
  const r = await run(args, { cwd: root });
  if (r.exitCode !== 0) {
    throw new Error(`worktree add failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).slice(0, 500)}`);
  }
  return { repoRoot: root, path: target, branch };
}

/**
 * Remove a managed worktree via `git worktree remove` (git-managed operation;
 * only removes the worktree directory registered with git). `force` prunes
 * dirty/merged state — use sparingly.
 */
export async function removeWorktree(handle: WorktreeHandle, opts: { run?: GitRunner; force?: boolean } = {}): Promise<void> {
  const run = opts.run ?? defaultGitRunner;
  const args = ['worktree', 'remove'];
  if (opts.force) args.push('--force');
  args.push(handle.path);
  const r = await run(args, { cwd: handle.repoRoot });
  if (r.exitCode !== 0) {
    throw new Error(`worktree remove failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).slice(0, 500)}`);
  }
}

/** List worktree paths (porcelain parse). */
export async function listWorktrees(repoRoot: string, opts: { run?: GitRunner } = {}): Promise<string[]> {
  const run = opts.run ?? defaultGitRunner;
  const r = await run(['worktree', 'list', '--porcelain'], { cwd: path.resolve(repoRoot) });
  if (r.exitCode !== 0) {
    throw new Error(`git worktree list failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).slice(0, 500)}`);
  }
  return r.stdout
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim());
}
