import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorktree, removeWorktree, listWorktrees, sanitizeBranch, type GitRunner } from './Worktree.js';

function tempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-worktree-'));
  fs.mkdirSync(path.join(root, '.git'), { recursive: true }); // marker only (fake runner)
  return root;
}

/** In-process fake git runner: records args, simulates `worktree add` by creating the target dir. */
function fakeGit(record: { calls: string[][] }): GitRunner {
  return async (args, opts) => {
    record.calls.push(args);
    if (args[0] === 'worktree' && args[1] === 'add') {
      const target = args[args.length - 1]!;
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, '.git'), 'gitdir: fake\n', 'utf8');
      return { stdout: `worktree ${target}\n`, stderr: '', exitCode: 0 };
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      const target = args[args.length - 1]!;
      // fake removal: leave the dir for test cleanup; record the call
      void target;
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (args[0] === 'worktree' && args[1] === 'list') {
      return { stdout: `worktree ${opts.cwd}\nworktree ${path.join(opts.cwd, '.harness', 'worktrees', 'wt_1')}\n`, stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: 'unknown fake git command', exitCode: 1 };
  };
}

describe('V0.2-M6 git worktree (optional)', () => {
  let repo: string;
  beforeEach(() => {
    repo = tempRepo();
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('sanitizeBranch keeps valid names and neutralizes invalid characters', () => {
    expect(sanitizeBranch('feat/explore-v0.2')).toBe('feat/explore-v0.2');
    expect(sanitizeBranch('branch with spaces!')).toBe('branch-with-spaces-');
    expect(sanitizeBranch('-leading-dash')).toBe('leading-dash');
    expect(() => sanitizeBranch('   ')).toThrow(/empty/);
    expect(() => sanitizeBranch('!!!')).toThrow(/empty/);
  });

  it('createWorktree issues `git worktree add [-b branch] <path>` via the injected runner', async () => {
    const record: { calls: string[][] } = { calls: [] };
    const handle = await createWorktree(repo, {
      branch: 'explore/topic-1',
      baseDir: path.join(repo, '.harness', 'worktrees'),
      run: fakeGit(record),
    });
    expect(handle.path.startsWith(path.join(repo, '.harness', 'worktrees'))).toBe(true);
    expect(handle.branch).toBe('explore/topic-1');
    expect(record.calls).toHaveLength(1);
    const args = record.calls[0]!;
    expect(args.slice(0, 2)).toEqual(['worktree', 'add']);
    expect(args).toContain('-b');
    expect(args).toContain('explore/topic-1');
    expect(args[args.length - 1]).toBe(handle.path);
    expect(fs.existsSync(handle.path)).toBe(true); // fake runner created it
  });

  it('createWorktree rejects non-repository roots and fails loud on runner errors', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-worktree-plain-'));
    await expect(createWorktree(plain)).rejects.toThrow(/not a git repository/);
    fs.rmSync(plain, { recursive: true, force: true });

    const record: { calls: string[][] } = { calls: [] };
    const failing: GitRunner = async (args) => {
      record.calls.push(args);
      return { stdout: '', stderr: 'fatal: not a git repository', exitCode: 128 };
    };
    await expect(createWorktree(repo, { run: failing })).rejects.toThrow(/worktree add failed/);
  });

  it('removeWorktree delegates to `git worktree remove` and propagates failures', async () => {
    const record: { calls: string[][] } = { calls: [] };
    const handle = { repoRoot: repo, path: path.join(repo, '.harness', 'worktrees', 'wt_1') };
    await removeWorktree(handle, { run: fakeGit(record) });
    expect(record.calls[0]!.slice(0, 3)).toEqual(['worktree', 'remove', handle.path]);

    const failing: GitRunner = async () => ({ stdout: '', stderr: 'worktree not found', exitCode: 1 });
    await expect(removeWorktree(handle, { run: failing })).rejects.toThrow(/worktree remove failed/);
  });

  it('listWorktrees parses porcelain output', async () => {
    const record: { calls: string[][] } = { calls: [] };
    const paths = await listWorktrees(repo, { run: fakeGit(record) });
    expect(record.calls[0]).toEqual(['worktree', 'list', '--porcelain']);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe(repo);
  });
});
