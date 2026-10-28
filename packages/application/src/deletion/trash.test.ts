import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { list, purge, restore, trashEntry } from './trash.js';

let base: string;
let root: string;
let target: string;
let previousTtl: string | undefined;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-trash-test-'));
  root = path.join(base, 'trash');
  target = path.join(base, 'workspace', '.harness', 'sessions', 'session');
  previousTtl = process.env.VESSEL_TRASH_TTL_DAYS;
  delete process.env.VESSEL_TRASH_TTL_DAYS;
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.join(target, 'nested'));
  fs.writeFileSync(path.join(target, 'nested', 'hello.txt'), 'hello');
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousTtl === undefined) delete process.env.VESSEL_TRASH_TTL_DAYS;
  else process.env.VESSEL_TRASH_TTL_DAYS = previousTtl;
  fs.rmSync(base, { recursive: true, force: true });
});

function move(ttlDays?: number) {
  return trashEntry({ root, target, kind: 'session', reason: 'user_delete', ttlDays });
}

function crossVolume() {
  const rename = fs.renameSync;
  vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
    if (source === target && String(destination).startsWith(root + path.sep)) {
      throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
    }
    rename(source, destination);
  });
}

describe('application trash', () => {
  it('moves a tree and writes exactly the documented metadata with default seven-day TTL', () => {
    const entry = move();
    expect(fs.existsSync(target)).toBe(false);
    expect(entry.sizeBytes).toBe(5);
    expect(Date.parse(entry.expiresAt!) - Date.parse(entry.deletedAt)).toBe(7 * 86_400_000);
    const disk = JSON.parse(fs.readFileSync(path.join(root, entry.id, 'entry.json'), 'utf8'));
    expect(Object.keys(disk).sort()).toEqual(['deletedAt', 'expiresAt', 'id', 'kind', 'origin', 'reason', 'sizeBytes']);
    expect(disk).toEqual(entry);
    expect(list({ root })).toEqual({ entries: [entry], skipped: [] });
  });

  it('keeps entries one second before expiry and deletes one second after, with audit before rm', () => {
    const entry = move();
    const expiry = Date.parse(entry.expiresAt!);
    expect(purge({ root, now: new Date(expiry - 1000) }).purged).toHaveLength(0);
    const remove = fs.rmSync;
    vi.spyOn(fs, 'rmSync').mockImplementation((directory, options) => {
      const audit = fs.readFileSync(path.join(root, '_purge.jsonl'), 'utf8');
      expect(JSON.parse(audit.trim().split('\n').at(-1)!)).toMatchObject({ id: entry.id, ok: false, reason: 'retention/purge:pending' });
      remove(directory, options);
    });
    expect(purge({ root, now: new Date(expiry + 1000) }).purged).toEqual([entry]);
    expect(fs.existsSync(path.join(root, entry.id))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(root, '_purge.jsonl'), 'utf8').trim().split('\n').at(-1)!)).toMatchObject({ id: entry.id, bytes: 5, ok: true });
  });

  it('dry-run only returns expired entries without writing any files', () => {
    const entry = move(1);
    const result = purge({ root, dryRun: true, now: new Date(Date.parse(entry.expiresAt!) + 1000) });
    expect(result.entries).toEqual([entry]);
    expect(result.purged).toEqual([]);
    expect(list({ root }).entries).toEqual([entry]);
    expect(fs.readdirSync(root)).toEqual([entry.id]);
    fs.writeFileSync(path.join(root, '_purge.jsonl'), 'existing-audit\n');
    purge({ root, dryRun: true, now: new Date(Date.parse(entry.expiresAt!) + 1000) });
    expect(fs.readFileSync(path.join(root, '_purge.jsonl'), 'utf8')).toBe('existing-audit\n');
  });

  it('restores a tree to its original path', () => {
    const entry = move();
    expect(restore({ root, id: entry.id })).toEqual(entry);
    expect(fs.readFileSync(path.join(target, 'nested', 'hello.txt'), 'utf8')).toBe('hello');
    expect(list({ root }).entries).toEqual([]);
  });

  it('refuses existing and dangling-link restore destinations', () => {
    const entry = move();
    fs.writeFileSync(target, 'occupied');
    expect(() => restore({ root, id: entry.id })).toThrow('already exists');
    fs.unlinkSync(target);
    fs.symlinkSync(path.join(base, 'missing'), target, 'junction');
    expect(() => restore({ root, id: entry.id })).toThrow('Linked path');
    expect(fs.existsSync(path.join(root, entry.id, 'data', 'nested', 'hello.txt'))).toBe(true);
  });

  it('refuses traversal ids and skips linked entry directories without touching their target', () => {
    fs.mkdirSync(root);
    fs.symlinkSync(target, path.join(root, 'escape'), 'junction');
    expect(() => restore({ root, id: '../session' })).toThrow('Invalid trash id');
    expect(purge({ root, olderThanDays: 0 }).skipped).toHaveLength(1);
    expect(fs.readFileSync(path.join(target, 'nested', 'hello.txt'), 'utf8')).toBe('hello');
  });

  it('never purges directories missing or carrying invalid metadata', () => {
    const entry = move();
    fs.writeFileSync(path.join(root, entry.id, 'entry.json'), JSON.stringify({ ...entry, id: 'wrong' }));
    fs.mkdirSync(path.join(root, 'unowned'));
    const result = purge({ root, olderThanDays: 0 });
    expect(result.purged).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(fs.existsSync(path.join(root, entry.id, 'data'))).toBe(true);
  });

  it('honors TTL zero even with an explicit age filter', () => {
    process.env.VESSEL_TRASH_TTL_DAYS = '0';
    const entry = move();
    expect(entry.expiresAt).toBeNull();
    expect(purge({ root, now: new Date('2099-01-01T00:00:00.000Z') }).entries).toEqual([]);
    expect(purge({ root, olderThanDays: 0 }).purged).toEqual([]);
    expect(list({ root }).entries).toEqual([entry]);
  });

  it('uses olderThanDays only to restrict already expired entries', () => {
    const entry = move(1);
    const deleted = Date.parse(entry.deletedAt);
    expect(purge({ root, olderThanDays: 0, now: new Date(deleted + 1000) }).purged).toEqual([]);
    expect(purge({ root, olderThanDays: 3, now: new Date(deleted + 2 * 86_400_000) }).purged).toEqual([]);
    expect(purge({ root, olderThanDays: 3, now: new Date(deleted + 4 * 86_400_000) }).purged).toEqual([entry]);
  });

  it.each(['bad', '-1', '1.5', '1e2', ''])('rejects invalid TTL %j before changing the source', value => {
    process.env.VESSEL_TRASH_TTL_DAYS = value;
    expect(() => move()).toThrow('TTL');
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(root)).toBe(false);
  });

  it('rejects a root inside the source before creating it', () => {
    const nestedRoot = path.join(target, 'new', 'trash');
    expect(() => trashEntry({ root: nestedRoot, target, kind: 'session', reason: 'delete' })).toThrow('overlap');
    expect(fs.existsSync(nestedRoot)).toBe(false);
  });

  it('rejects linked root ancestors, linked metadata, nested payload links and linked audit paths', () => {
    const alias = path.join(base, 'alias');
    fs.symlinkSync(target, alias, 'junction');
    expect(() => list({ root: path.join(alias, 'trash') })).toThrow('Linked path');
    const entry = move();
    const metadata = path.join(root, entry.id, 'entry.json');
    fs.renameSync(metadata, path.join(base, 'metadata.json'));
    fs.symlinkSync(base, metadata, 'junction');
    expect(list({ root }).skipped).toHaveLength(1);
    fs.unlinkSync(metadata);
    fs.renameSync(path.join(base, 'metadata.json'), metadata);
    fs.symlinkSync(base, path.join(root, entry.id, 'data', 'escape'), 'junction');
    expect(purge({ root, olderThanDays: 0 }).skipped).toHaveLength(1);
    fs.symlinkSync(base, path.join(root, '_purge.jsonl'), 'junction');
    expect(() => purge({ root, olderThanDays: 0 })).toThrow('Linked path');
  });

  it('copies and verifies EXDEV, then preserves the source in independently managed application trash', () => {
    crossVolume();
    const entry = move();
    expect(fs.existsSync(target)).toBe(false);
    expect(entry.sourceBackup).toBeDefined();
    const backup = entry.sourceBackup!;
    expect(backup.root).toBe(path.join(path.dirname(target), '.harness', 'trash'));
    expect(list({ root: backup.root }).entries).toHaveLength(1);
    expect(list({ root }).entries).toHaveLength(1);
    restore({ root: backup.root, id: backup.id });
    expect(fs.readFileSync(path.join(target, 'nested', 'hello.txt'), 'utf8')).toBe('hello');
  });

  it('keeps source bytes unchanged if cross-volume copy fails', () => {
    crossVolume();
    vi.spyOn(fs, 'cpSync').mockImplementation(() => { throw new Error('copy failed'); });
    expect(() => move()).toThrow('copy failed');
    expect(fs.readFileSync(path.join(target, 'nested', 'hello.txt'), 'utf8')).toBe('hello');
    expect(list({ root }).entries).toEqual([]);
  });

  it('keeps source bytes unchanged if cross-volume verification detects same-size corruption', () => {
    crossVolume();
    const copy = fs.cpSync;
    vi.spyOn(fs, 'cpSync').mockImplementation((source, destination, options) => {
      copy(source, destination, options);
      fs.writeFileSync(path.join(String(destination), 'nested', 'hello.txt'), 'other');
    });
    expect(() => move()).toThrow('verification failed');
    expect(fs.readFileSync(path.join(target, 'nested', 'hello.txt'), 'utf8')).toBe('hello');
  });

  it('keeps source unchanged if the final source archive rename fails', () => {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (source === target) throw Object.assign(new Error('archive failed'), { code: String(destination).startsWith(root + path.sep) ? 'EXDEV' : 'EACCES' });
      rename(source, destination);
    });
    expect(() => move()).toThrow('archive failed');
    expect(fs.readFileSync(path.join(target, 'nested', 'hello.txt'), 'utf8')).toBe('hello');
    expect(list({ root }).entries).toEqual([]);
  });

  it('rejects nested source links before creating a trash entry', () => {
    fs.symlinkSync(base, path.join(target, 'escape'), 'junction');
    expect(() => move()).toThrow('Linked payload');
    expect(fs.existsSync(path.join(target, 'nested', 'hello.txt'))).toBe(true);
    expect(fs.existsSync(root)).toBe(false);
  });

  it('retains canonical trash data if a cross-volume restoration copy fails', () => {
    const entry = move();
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === target) throw Object.assign(new Error('cross-device restore'), { code: 'EXDEV' });
      rename(source, destination);
    });
    vi.spyOn(fs, 'cpSync').mockImplementation(() => { throw new Error('restore copy failed'); });
    expect(() => restore({ root, id: entry.id })).toThrow('restore copy failed');
    expect(fs.existsSync(target)).toBe(false);
    expect(list({ root }).entries).toEqual([entry]);
  });

  it('fails closed if pre-deletion audit cannot be written', () => {
    const entry = move(1);
    vi.spyOn(fs, 'appendFileSync').mockImplementation(() => { throw new Error('audit denied'); });
    expect(() => purge({ root, now: new Date(Date.parse(entry.expiresAt!) + 1000) })).toThrow('audit denied');
    expect(fs.existsSync(path.join(root, entry.id, 'data'))).toBe(true);
  });

  it('records deletion failure and keeps its recoverable entry', () => {
    const entry = move(1);
    vi.spyOn(fs, 'rmSync').mockImplementation(() => { throw new Error('busy'); });
    const result = purge({ root, now: new Date(Date.parse(entry.expiresAt!) + 1000) });
    expect(result.purged).toEqual([]);
    expect(result.skipped).toEqual([{ id: entry.id, reason: 'busy' }]);
    expect(fs.readFileSync(path.join(root, '_purge.jsonl'), 'utf8')).toContain('busy');
  });
});
