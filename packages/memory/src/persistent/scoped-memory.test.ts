import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ScopedMemoryStore, userMemoryRoot } from './ScopedMemoryStore.js';
import { createMemoryTool } from '../project/createMemoryTool.js';
import type { ToolExecutionContext } from '@vessel/shared';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('memory/persistent — ScopedMemoryStore (V0.3-M2)', () => {
  let home: string;
  let wsA: string;
  let wsB: string;
  let store: ScopedMemoryStore;

  beforeEach(() => {
    home = tmpDir('cah-mem-home-');
    wsA = tmpDir('cah-mem-projA-');
    wsB = tmpDir('cah-mem-projB-');
    store = new ScopedMemoryStore({ workspaceRoot: wsA, userRoot: path.join(home, '.dsh', 'memory') });
  });

  afterEach(() => {
    for (const d of [home, wsA, wsB]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('userRoot defaults under os.homedir()/.dsh/memory', () => {
    expect(userMemoryRoot('fake-home')).toBe(path.join('fake-home', '.dsh', 'memory'));
  });

  it('writes to explicit scopes stay isolated (user vs project vs local)', () => {
    store.write('user', 't', 'user-content');
    store.write('project', 't', 'project-content');
    store.write('local', 't', 'local-content');
    expect(store.read('user', 't')).toContain('user-content');
    expect(store.read('project', 't')).toContain('project-content');
    expect(store.read('local', 't')).toContain('local-content');
    // same key in different scopes does not overwrite
    expect(store.list('user').map((e) => e.name)).toContain('t');
    expect(store.list('project').map((e) => e.name)).toContain('t');
    expect(store.list('local').map((e) => e.name)).toContain('t');
  });

  it('readMerged resolves by precedence local > project > user', () => {
    store.write('user', 'k', 'from-user');
    expect(store.readMerged('k')?.scope).toBe('user');
    store.write('project', 'k', 'from-project');
    expect(store.readMerged('k')?.scope).toBe('project');
    store.write('local', 'k', 'from-local');
    expect(store.readMerged('k')?.scope).toBe('local');
    expect(store.readMerged('k')?.content).toContain('from-local');
  });

  it('user memory is visible across two different project workspaces', () => {
    const storeB = new ScopedMemoryStore({ workspaceRoot: wsB, userRoot: path.join(home, '.dsh', 'memory') });
    store.write('user', 'prefs', 'prefer concise replies');
    // a different project shares the same user root
    expect(storeB.read('user', 'prefs')).toContain('prefer concise');
  });

  it('project memory is NOT visible across workspaces', () => {
    const storeB = new ScopedMemoryStore({ workspaceRoot: wsB, userRoot: path.join(home, '.dsh', 'memory') });
    store.write('project', 'secret', 'project-a-only');
    expect(storeB.read('project', 'secret')).toBeUndefined();
    expect(storeB.readMerged('secret')).toBeUndefined();
  });

  it('snapshotMerged includes user base then project overlay', () => {
    store.write('user', 'u', 'user-note');
    store.write('project', 'p', 'project-note');
    const snap = store.snapshotMerged();
    expect(snap).toContain('[user memory]');
    expect(snap).toContain('[project memory]');
    expect(snap).toContain('user-note');
    expect(snap).toContain('project-note');
  });
});

describe('memory/persistent — Memory tool scope support', () => {
  let home: string;
  let ws: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    home = tmpDir('cah-mem-home2-');
    ws = tmpDir('cah-mem-projC-');
    ctx = { workspaceRoot: ws, cwd: ws };
  });

  afterEach(() => {
    for (const d of [home, ws]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('write respects an explicit scope; read merges across scopes', async () => {
    const tool = createMemoryTool({ workspaceRoot: ws, userRoot: path.join(home, '.dsh', 'memory') });
    await tool.execute({ op: 'write', scope: 'user', name: 'name', content: 'bob' }, ctx);
    await tool.execute({ op: 'write', scope: 'project', name: 'name', content: 'bob-project' }, ctx);
    // merged read: project shadows user
    const r = await tool.execute({ op: 'read', name: 'name' }, ctx);
    expect(r.content).toContain('bob-project');
    // explicit user scope read still sees user content
    const ru = await tool.execute({ op: 'read', scope: 'user', name: 'name' }, ctx);
    expect(ru.content).toContain('bob');
  });

  it('default scope remains project for backward compatibility (no scope arg)', async () => {
    const tool = createMemoryTool({ workspaceRoot: ws, userRoot: path.join(home, '.dsh', 'memory') });
    await tool.execute({ op: 'write', name: 'note', content: 'default-project' }, ctx);
    // landed in project scope, not user
    const s = new ScopedMemoryStore({ workspaceRoot: ws, userRoot: path.join(home, '.dsh', 'memory') });
    expect(s.read('project', 'note')).toContain('default-project');
    expect(s.read('user', 'note')).toBeUndefined();
  });
});
