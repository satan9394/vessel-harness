import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRegistry, trashStore } from '@vessel/application';
import { main } from '../cli.js';

describe('vessel trash', () => {
  let base: string;
  let root: string;
  let output: ReturnType<typeof vi.spyOn>;
  let previousRoot: string | undefined;
  let previousSessionRoot: string | undefined;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-trash-cli-'));
    root = path.join(base, 'trash');
    previousRoot = process.env.VESSEL_TRASH_ROOT;
    process.env.VESSEL_TRASH_ROOT = root;
    previousSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_SESSION_ROOT = path.join(base, 'registry');
    output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    if (previousRoot === undefined) delete process.env.VESSEL_TRASH_ROOT;
    else process.env.VESSEL_TRASH_ROOT = previousRoot;
    if (previousSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = previousSessionRoot;
    vi.restoreAllMocks();
    fs.rmSync(base, { recursive: true, force: true });
  });
  function entry(expired = false) {
    const target = path.join(base, 'source');
    fs.writeFileSync(target, 'private payload');
    const item = trashStore.trashEntry({ root, target, kind: 'artifact', reason: 'test', ttlDays: 1 });
    if (expired) {
      const file = path.join(root, item.id, 'entry.json');
      const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
      metadata.deletedAt = '2020-01-01T00:00:00.000Z';
      metadata.expiresAt = '2020-01-02T00:00:00.000Z';
      fs.writeFileSync(file, JSON.stringify(metadata));
    }
    return { item, target };
  }
  it('lists an empty root and a nonempty root as JSON', async () => {
    expect(await main(['trash', 'list', '--json'])).toBe(0);
    expect(JSON.parse(String(output.mock.lastCall?.[0])).entries).toHaveLength(0);
    const { item } = entry();
    expect(await main(['trash', 'list', '--json'])).toBe(0);
    expect(JSON.parse(String(output.mock.lastCall?.[0])).entries[0].id).toBe(item.id);
  });
  it('restores an entry', async () => {
    const { item, target } = entry();
    expect(await main(['trash', 'restore', item.id])).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe('private payload');
  });
  function removedSession() {
    const registry = new SessionRegistry({ index: false });
    const meta = registry.create({ workspaceRoot: path.join(base, 'workspace'), provider: 'mock', model: 'fixture', permission: 'read-only' });
    const target = path.join(meta.workspaceRoot, '.harness', 'sessions', meta.id);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'session.jsonl'), 'fixture history\n');
    registry.remove(meta.id);
    return { meta, target, item: trashStore.trashEntry({ root, target, kind: 'session', reason: 'test' }) };
  }
  it('restores the session list durably and refuses a second restore without changing history', async () => {
    const { meta, target, item } = removedSession();
    expect(new SessionRegistry({ index: false }).list()).toEqual([]);
    expect(await main(['trash', 'restore', item.id])).toBe(0);
    expect(output.mock.lastCall?.[0]).toContain('session registered for vessel sessions list');
    expect(new SessionRegistry({ index: false }).list()).toEqual([meta]);
    expect(await main(['sessions', 'list'])).toBe(0);
    expect(output.mock.calls.some((call: Parameters<typeof console.log>) => String(call[0]).includes(meta.id))).toBe(true);
    const journal = fs.readFileSync(path.join(process.env.VESSEL_SESSION_ROOT!, 'sessions.metadata.jsonl'));
    expect(await main(['trash', 'restore', item.id])).toBe(1);
    expect(fs.readFileSync(path.join(target, 'session.jsonl'), 'utf8')).toBe('fixture history\n');
    expect(fs.readFileSync(path.join(process.env.VESSEL_SESSION_ROOT!, 'sessions.metadata.jsonl'))).toEqual(journal);
  });
  it('reports missing metadata without losing restored bytes or claiming registration', async () => {
    const { meta, target, item } = removedSession();
    process.env.VESSEL_SESSION_ROOT = path.join(base, 'different-registry');
    expect(await main(['trash', 'restore', item.id])).toBe(1);
    expect(fs.readFileSync(path.join(target, 'session.jsonl'), 'utf8')).toBe('fixture history\n');
    expect(new SessionRegistry({ index: false }).get(meta.id)).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Directory restored'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Verify VESSEL_SESSION_ROOT'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('vessel sessions list does not rebuild'));
    expect(output.mock.calls.some((call: Parameters<typeof console.log>) => String(call[0]).includes('session registered'))).toBe(false);
    expect(await main(['trash', 'restore', item.id])).toBe(1);
  });
  it('preserves restored bytes and reports a registry persistence failure', async () => {
    const { target, item } = removedSession();
    const restore = vi.spyOn(SessionRegistry.prototype, 'restoreRemoved').mockImplementation(() => { throw new Error('fixture disk failure'); });
    expect(await main(['trash', 'restore', item.id])).toBe(1);
    expect(restore).toHaveBeenCalledOnce();
    expect(fs.readFileSync(path.join(target, 'session.jsonl'), 'utf8')).toBe('fixture history\n');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fixture disk failure'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Do not repeat trash restore'));
  });
  it('refuses a conflicting restore without overwriting', async () => {
    const { item, target } = entry();
    fs.writeFileSync(target, 'existing');
    expect(await main(['trash', 'restore', item.id])).not.toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe('existing');
  });
  it('dry-run reports expired metadata and leaves payload and audit intact', async () => {
    const { item } = entry(true);
    expect(await main(['trash', 'purge', '--dry-run', '--json'])).toBe(0);
    const raw = String(output.mock.lastCall?.[0]);
    expect(JSON.parse(raw).entries).toHaveLength(1);
    expect(raw).not.toContain('private payload');
    expect(fs.existsSync(path.join(root, item.id, 'data'))).toBe(true);
    expect(fs.existsSync(path.join(root, '_purge.jsonl'))).toBe(false);
  });
  it('purges expired entries and reports the count', async () => {
    const { item } = entry(true);
    expect(await main(['trash', 'purge', '--older-than', '1', '--json'])).toBe(0);
    expect(JSON.parse(String(output.mock.lastCall?.[0])).purged).toHaveLength(1);
    expect(fs.existsSync(path.join(root, item.id))).toBe(false);
  });
  it('prefers an explicit root to the environment', async () => {
    entry();
    expect(await main(['trash', 'list', '--root', path.join(base, 'other'), '--json'])).toBe(0);
    expect(JSON.parse(String(output.mock.lastCall?.[0])).entries).toHaveLength(0);
  });
  it('returns a parseable JSON error for an invalid purge age', async () => {
    expect(await main(['trash', 'purge', '--older-than', 'invalid', '--json'])).toBe(2);
    expect(JSON.parse(String(output.mock.lastCall?.[0]))).toEqual({ error: 'Invalid trash command or options' });
  });
});
