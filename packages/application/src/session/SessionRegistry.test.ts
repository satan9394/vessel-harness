import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionRegistry } from './SessionRegistry.js';

describe('SessionRegistry', () => {
  let dir: string;
  let home: string;
  let ws: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-session-'));
    home = path.join(dir, 'vessel-home');
    ws = path.join(dir, 'workspace');
    fs.mkdirSync(ws, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('create/list/get round-trips session metadata', () => {
    const reg = new SessionRegistry({ vesselHome: home });
    const meta = reg.create({
      workspaceRoot: ws,
      provider: 'mock',
      model: 'mock-model',
      permission: 'workspace-write',
    });
    expect(meta.id).toMatch(/^sess_/);
    expect(meta.workspaceRoot).toBe(path.resolve(ws));
    expect(meta.createdAt).toBeTruthy();
    expect(meta.updatedAt).toBeTruthy();

    expect(reg.get(meta.id)).toEqual(meta);
    expect(reg.list().map((s) => s.id)).toContain(meta.id);
  });

  it('create defaults provider/model/permission when omitted', () => {
    const reg = new SessionRegistry({ vesselHome: home });
    const meta = reg.create();
    expect(meta.provider).toBe('unknown');
    expect(meta.model).toBe('unknown');
    expect(meta.permission).toBe('workspace-write');
  });

  it('list returns newest first', () => {
    const reg = new SessionRegistry({ vesselHome: home });
    const a = reg.create({ workspaceRoot: ws });
    const b = reg.create({ workspaceRoot: ws });
    const [first, second] = reg.list();
    expect(first!.id).toBe(b.id);
    expect(second!.id).toBe(a.id);
  });

  it('persists across instances (fresh registry sees prior sessions)', () => {
    const reg1 = new SessionRegistry({ vesselHome: home });
    const created = reg1.create({
      workspaceRoot: ws,
      provider: 'mock',
      model: 'mock-model',
      permission: 'read-only',
    });

    const reg2 = new SessionRegistry({ vesselHome: home });
    const restored = reg2.get(created.id);
    expect(restored).toBeDefined();
    expect(restored!.provider).toBe('mock');
    expect(restored!.model).toBe('mock-model');
    expect(restored!.permission).toBe('read-only');
  });

  it('remove drops a session from the registry and persists it', () => {
    const reg = new SessionRegistry({ vesselHome: home });
    const a = reg.create({ workspaceRoot: ws });
    const b = reg.create({ workspaceRoot: ws });

    expect(reg.remove(a.id)).toBe(true);
    expect(reg.remove('missing')).toBe(false);
    expect(reg.get(a.id)).toBeUndefined();
    expect(reg.list().map((s) => s.id)).toEqual([b.id]);

    // removal survived a fresh instance
    const reg2 = new SessionRegistry({ vesselHome: home });
    expect(reg2.get(a.id)).toBeUndefined();
    expect(reg2.get(b.id)).toBeDefined();
  });
});