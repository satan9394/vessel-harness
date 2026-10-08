import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { WorkspaceFingerprinter } from './workspaceFingerprint.js';

const roots: string[] = [];
const fixture = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-fingerprint-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('WorkspaceFingerprinter', () => {
  it('detects new/deleted files, mtime and content rewritten at the same mtime', async () => {
    const root = fixture(); const file = path.join(root, 'code.ts');
    const empty = await WorkspaceFingerprinter.compute(root);
    fs.writeFileSync(file, 'abc'); const first = await WorkspaceFingerprinter.compute(root); const stat = fs.statSync(file);
    expect(first.fileCount).toBe(1); expect(first.uncommittedDiffBytes).toBe(3);
    fs.writeFileSync(file, 'xyz'); fs.utimesSync(file, stat.atime, stat.mtime);
    const changed = await WorkspaceFingerprinter.compute(root); expect(changed.trackedFilesHash).not.toBe(first.trackedFilesHash);
    fs.utimesSync(file, stat.atime, new Date(stat.mtimeMs + 1000));
    expect((await WorkspaceFingerprinter.compute(root)).trackedFilesHash).not.toBe(changed.trackedFilesHash);
    fs.unlinkSync(file); expect((await WorkspaceFingerprinter.compute(root)).trackedFilesHash).toBe(empty.trackedFilesHash);
  });
  it('prunes dependency/output/runtime state and never follows symlinks', async () => {
    const root = fixture(); const outside = fixture();
    for (const dir of ['.git', 'node_modules', 'dist', '.harness', '.vessel']) {
      if (dir === '.git') continue;
      const destination = ['.harness', '.vessel'].includes(dir) ? path.join(root, dir, 'sessions') : path.join(root, dir);
      fs.mkdirSync(destination, { recursive: true }); fs.writeFileSync(path.join(destination, 'ignored'), 'secret');
    }
    fs.writeFileSync(path.join(outside, 'secret'), 'abc');
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
    const first = await WorkspaceFingerprinter.compute(root);
    expect(first.fileCount).toBe(1);
    fs.writeFileSync(path.join(outside, 'secret'), 'changed');
    expect((await WorkspaceFingerprinter.compute(root)).trackedFilesHash).toBe(first.trackedFilesHash);
    fs.mkdirSync(path.join(root, '.vessel', 'skills'));
    fs.writeFileSync(path.join(root, '.vessel', 'skills', 'SKILL.md'), 'authored');
    expect((await WorkspaceFingerprinter.compute(root)).trackedFilesHash).not.toBe(first.trackedFilesHash);
  });
  it('measures actual uncommitted Git changes, including staged and untracked bytes', async () => {
    const root = fixture(); execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
    fs.writeFileSync(path.join(root, '.gitignore'), 'scratch/\n');
    fs.mkdirSync(path.join(root, 'scratch')); fs.writeFileSync(path.join(root, 'scratch', 'huge.bin'), 'ignored');
    const ignoredBefore = await WorkspaceFingerprinter.compute(root);
    fs.writeFileSync(path.join(root, 'scratch', 'huge.bin'), 'changed');
    expect((await WorkspaceFingerprinter.compute(root)).trackedFilesHash).toBe(ignoredBefore.trackedFilesHash);
    fs.writeFileSync(path.join(root, 'code.ts'), 'hello\n');
    execFileSync('git', ['-C', root, 'add', 'code.ts'], { windowsHide: true });
    const staged = await WorkspaceFingerprinter.compute(root);
    expect(staged.uncommittedDiffBytes).toBeGreaterThan(6);
    fs.writeFileSync(path.join(root, 'fresh.txt'), 'abc');
    expect((await WorkspaceFingerprinter.compute(root)).uncommittedDiffBytes).toBe(staged.uncommittedDiffBytes + 3);
    const nested = path.join(root, 'nested'); fs.mkdirSync(nested); fs.writeFileSync(path.join(nested, 'source.ts'), 'xyz');
    expect((await WorkspaceFingerprinter.compute(nested)).fileCount).toBe(1);
  });
  it('detects tracked same-mtime rewrites and counts the exact binary patch plus untracked bytes', async () => {
    const root = fixture(); const file = path.join(root, 'binary.dat');
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { windowsHide: true });
    git('init', '--quiet');
    fs.writeFileSync(file, Buffer.from([0, 1, 2, 3]));
    git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    const clean = await WorkspaceFingerprinter.compute(root); const stat = fs.statSync(file);
    fs.writeFileSync(file, Buffer.from([0, 4, 5, 6])); fs.utimesSync(file, stat.atime, stat.mtime);
    fs.writeFileSync(path.join(root, 'fresh.dat'), Buffer.from([0, 7, 8]));
    const changed = await WorkspaceFingerprinter.compute(root);
    expect(changed.trackedFilesHash).not.toBe(clean.trackedFilesHash);
    expect(changed.uncommittedDiffBytes).toBe(git('diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--', '.').length + 3);
    git('add', 'binary.dat');
    expect((await WorkspaceFingerprinter.compute(root)).uncommittedDiffBytes).toBe(changed.uncommittedDiffBytes);
    fs.unlinkSync(file);
    expect((await WorkspaceFingerprinter.compute(root)).trackedFilesHash).not.toBe(changed.trackedFilesHash);
  });
  it('keeps tracked ignore exceptions and nested Git workspaces while pruning fresh ignored files', async () => {
    const root = fixture(); const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { windowsHide: true });
    git('init', '--quiet');
    fs.mkdirSync(path.join(root, 'nested')); fs.writeFileSync(path.join(root, '.gitignore'), '*.dat\n');
    const file = path.join(root, 'nested', 'tracked.dat'); fs.writeFileSync(file, 'abc'); git('add', '-f', 'nested/tracked.dat');
    const nested = path.join(root, 'nested'); const first = await WorkspaceFingerprinter.compute(nested);
    expect(first.fileCount).toBe(1);
    fs.writeFileSync(path.join(nested, 'ignored.dat'), 'ignored');
    expect((await WorkspaceFingerprinter.compute(nested)).trackedFilesHash).toBe(first.trackedFilesHash);
    const stat = fs.statSync(file); fs.writeFileSync(file, 'xyz'); fs.utimesSync(file, stat.atime, stat.mtime);
    expect((await WorkspaceFingerprinter.compute(nested)).trackedFilesHash).not.toBe(first.trackedFilesHash);
  });
  it('does not read tracked paths through a parent junction outside the workspace', async () => {
    const root = fixture(); const outside = fixture();
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { windowsHide: true });
    git('init', '--quiet');
    fs.mkdirSync(path.join(root, 'nested')); fs.writeFileSync(path.join(root, 'nested', 'code.ts'), 'inside');
    git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    fs.renameSync(path.join(root, 'nested'), path.join(root, 'original'));
    fs.writeFileSync(path.join(outside, 'code.ts'), 'outside');
    fs.symlinkSync(outside, path.join(root, 'nested'), 'junction');
    const first = await WorkspaceFingerprinter.compute(root);
    fs.writeFileSync(path.join(outside, 'code.ts'), 'outside changed');
    expect((await WorkspaceFingerprinter.compute(root)).trackedFilesHash).toBe(first.trackedFilesHash);
  });
});
