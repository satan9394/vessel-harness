import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { list, purge, restore, trashEntry } from './trash.js';

let base: string;
let root: string;
let outside: string;

/** Snapshot names, types, link destinations and every byte, without following links. */
function snapshot(directory: string): unknown[] {
  return fs.readdirSync(directory).sort().map(name => {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return [name, 'link', fs.readlinkSync(file)];
    if (stat.isDirectory()) return [name, 'directory', snapshot(file)];
    return [name, 'file', fs.readFileSync(file).toString('hex')];
  });
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-trash-escape-'));
  root = path.join(base, 'trash');
  outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'outside bytes must survive');
});

afterEach(() => {
  vi.restoreAllMocks();
  // Only this process's own fixture below os.tmpdir(); never a user trash root.
  fs.rmSync(base, { recursive: true, force: true });
});

function expectSkippedWithoutMutation(id: string, reason: string): void {
  const disk = snapshot(base);
  const listing = list({ root });
  const result = purge({ root, now: new Date('2099-01-01T00:00:00.000Z') });
  expect(snapshot(base)).toEqual(disk);
  expect(result.entries).toEqual([]);
  expect(result.purged).toEqual([]);
  expect(result.skipped).toEqual([expect.objectContaining({ id, reason: expect.stringContaining(reason) })]);
  expect(list({ root })).toEqual(listing);
}

describe('trash escape rejection leaves disk and listing unchanged', () => {
  it('rejects .. traversal without changing either side of the trash root', () => {
    const disk = snapshot(base);
    const listing = list({ root });
    expect(() => restore({ root, id: '..' })).toThrow('Invalid trash id');
    expect(snapshot(base)).toEqual(disk);
    expect(list({ root })).toEqual(listing);
  });

  it.runIf(process.platform !== 'win32')('rejects a real directory symbolic link to outside trash (POSIX)', () => {
    fs.symlinkSync(outside, path.join(root, 'directory-link'), 'dir');
    expectSkippedWithoutMutation('directory-link', 'Linked path refused');
  });

  it.runIf(process.platform === 'win32')('rejects the directory-symlink lstat branch with real disk unchanged (Windows mocked metadata)', () => {
    const directory = path.join(root, 'directory-link');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'data'), 'fixture is a real directory, not a native link');
    const disk = snapshot(base);
    const inode = fs.lstatSync(directory).ino;
    // Windows native directory symlink creation requires unavailable privilege.
    // Keep the real junction test below; mock only this inode's link predicate.
    const linked = vi.spyOn(fs.Stats.prototype, 'isSymbolicLink').mockImplementation(function (this: fs.Stats) {
      return this.ino === inode;
    });
    const listing = list({ root });
    const result = purge({ root, now: new Date('2099-01-01T00:00:00.000Z') });
    expect(list({ root })).toEqual(listing);
    linked.mockRestore();
    expect(snapshot(base)).toEqual(disk);
    expect(result.entries).toEqual([]);
    expect(result.purged).toEqual([]);
    expect(result.skipped).toEqual([{ id: 'directory-link', reason: `Linked path refused: ${directory}` }]);
  });

  it.runIf(process.platform === 'win32')('rejects a Windows junction to outside trash', () => {
    fs.symlinkSync(outside, path.join(root, 'junction'), 'junction');
    expectSkippedWithoutMutation('junction', 'Linked path refused');
  });

  it('rejects expiry moved before deletion while the original path is outside trash', () => {
    const entry = trashEntry({ root, target: outside, kind: 'session', reason: 'test', ttlDays: 7 });
    fs.writeFileSync(path.join(root, entry.id, 'entry.json'), JSON.stringify({
      ...entry, expiresAt: new Date(Date.parse(entry.deletedAt) - 1).toISOString(),
    }));
    expectSkippedWithoutMutation(entry.id, 'Invalid entry metadata');
  });

  it('rejects a directory missing entry.json without removing its data', () => {
    fs.mkdirSync(path.join(root, 'unowned'));
    fs.writeFileSync(path.join(root, 'unowned', 'data'), 'unowned bytes');
    expectSkippedWithoutMutation('unowned', 'ENOENT');
  });

  it('purges schema-valid forged metadata only inside trash and never changes its outside origin', () => {
    const id = 'forged';
    fs.mkdirSync(path.join(root, id));
    fs.writeFileSync(path.join(root, id, 'data'), 'payload');
    fs.writeFileSync(path.join(root, id, 'entry.json'), JSON.stringify({
      id, origin: outside, kind: 'session', reason: 'user_delete',
      deletedAt: '2020-01-01T00:00:00.000Z', expiresAt: '2020-01-02T00:00:00.000Z', sizeBytes: 7,
    }));
    const externalDisk = snapshot(outside);
    const result = purge({ root, now: new Date('2026-10-27T00:00:00.000Z') });
    expect(result.purged.map(entry => entry.id)).toEqual([id]);
    expect(result.skipped).toEqual([]);
    expect(fs.existsSync(path.join(root, id))).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
    expect(snapshot(outside)).toEqual(externalDisk);
    expect(list({ root })).toEqual({ entries: [], skipped: [] });
  });

  it('rejects forged session restore origin before creating its absent parent directories', () => {
    const entry = trashEntry({ root, target: outside, kind: 'session', reason: 'test', ttlDays: 7 });
    const origin = path.join(base, 'arbitrary', 'absent-parent', 'session');
    fs.writeFileSync(path.join(root, entry.id, 'entry.json'), JSON.stringify({ ...entry, origin }));
    const disk = snapshot(base);
    const listing = list({ root });
    expect(() => restore({ root, id: entry.id })).toThrow('Invalid session restore destination');
    expect(snapshot(base)).toEqual(disk);
    expect(list({ root })).toEqual(listing);
    expect(fs.existsSync(path.join(base, 'arbitrary'))).toBe(false);
  });

  it('restores a valid session to workspace/.harness/sessions/id', () => {
    const origin = path.join(base, 'workspace', '.harness', 'sessions', 'valid-session');
    fs.mkdirSync(origin, { recursive: true });
    fs.writeFileSync(path.join(origin, 'session.jsonl'), 'original session bytes');
    const entry = trashEntry({ root, target: origin, kind: 'session', reason: 'test', ttlDays: 7 });
    expect(restore({ root, id: entry.id })).toEqual(entry);
    expect(fs.readFileSync(path.join(origin, 'session.jsonl'), 'utf8')).toBe('original session bytes');
  });

  it('rejects a forged session origin through a linked parent before creating directories', () => {
    const source = path.join(base, 'source');
    fs.writeFileSync(source, 'session bytes');
    const entry = trashEntry({ root, target: source, kind: 'session', reason: 'test', ttlDays: 7 });
    const alias = path.join(base, 'linked-workspace');
    fs.symlinkSync(outside, alias, 'junction');
    const origin = path.join(alias, '.harness', 'sessions', 'session');
    fs.writeFileSync(path.join(root, entry.id, 'entry.json'), JSON.stringify({ ...entry, origin }));
    const disk = snapshot(base);
    expect(() => restore({ root, id: entry.id })).toThrow('Linked path refused');
    expect(snapshot(base)).toEqual(disk);
    expect(fs.existsSync(path.join(outside, '.harness'))).toBe(false);
  });
});
