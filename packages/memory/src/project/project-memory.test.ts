import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectStore } from './ProjectStore.js';
import { createMemoryTool } from './createMemoryTool.js';
import type { ToolExecutionContext } from '@cah/shared';

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-mem-'));
}

describe('memory/project — ProjectStore (V0.3-M1)', () => {
  let ws: string;
  let store: ProjectStore;

  beforeEach(() => {
    ws = tmpWorkspace();
    store = new ProjectStore(ws);
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('write + read round-trip persists topic content', () => {
    store.write('architecture-note', 'core 必须薄核，机制不进 core');
    expect(store.read('architecture-note')).toContain('薄核');
  });

  it('cross-session: a second ProjectStore instance over the same root reads the same memory', () => {
    store.write('decision', 'Policy 四件套');
    // simulate a fresh session by constructing a new store over the same workspace
    const store2 = new ProjectStore(ws);
    expect(store2.read('decision')).toContain('Policy');
    expect(store2.list().map((e) => e.name)).toContain('decision');
  });

  it('index file is created at .harness/memory/MEMORY.md and lists topics', () => {
    store.write('t1', 'first topic');
    store.write('t2', 'second topic');
    const indexFile = path.join(ws, '.harness', 'memory', 'MEMORY.md');
    expect(fs.existsSync(indexFile)).toBe(true);
    const names = store.list().map((e) => e.name).sort();
    expect(names).toEqual(['t1', 't2']);
  });

  it('overwriting a topic updates content but keeps a single index line', () => {
    store.write('dup', 'v1');
    store.write('dup', 'v2');
    expect(store.read('dup')).toContain('v2');
    const lines = store.list().filter((e) => e.name === 'dup');
    expect(lines).toHaveLength(1);
  });

  it('search matches topic names and summaries case-insensitively', () => {
    store.write('rate-limit-notes', 'Anthropic quota 观测');
    expect(store.search('rate').map((e) => e.name)).toContain('rate-limit-notes');
    expect(store.search('QUOTA').length).toBeGreaterThan(0);
    expect(store.search('nope')).toHaveLength(0);
  });

  it('snapshot returns a frozen, injectable text block (empty when no memory)', () => {
    expect(new ProjectStore(tmpWorkspace()).snapshot()).toBe('');
    store.write('topic-a', 'content a');
    const snap = store.snapshot();
    expect(snap).toContain('[Project Memory 快照]');
    expect(snap).toContain('## topic-a');
    expect(snap).toContain('content a');
  });

  it('reading a missing topic returns undefined', () => {
    expect(store.read('absent')).toBeUndefined();
  });
});

describe('memory/project — Memory tool (单一 memory 工具)', () => {
  let ws: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    ws = tmpWorkspace();
    ctx = { workspaceRoot: ws, cwd: ws };
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('write then read via the tool', async () => {
    const tool = createMemoryTool({ workspaceRoot: ws });
    const w = await tool.execute({ op: 'write', name: 'note', content: 'hello memory' }, ctx);
    expect(w.error).toBeUndefined();
    const r = await tool.execute({ op: 'read', name: 'note' }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.content).toContain('hello memory');
  });

  it('list/search/snapshot ops work through the tool', async () => {
    const tool = createMemoryTool({ workspaceRoot: ws });
    await tool.execute({ op: 'write', name: 'alpha', content: 'aaa' }, ctx);
    await tool.execute({ op: 'write', name: 'beta', content: 'bbb' }, ctx);
    const list = await tool.execute({ op: 'list' }, ctx);
    expect(list.content).toContain('alpha');
    const s = await tool.execute({ op: 'search', keyword: 'beta' }, ctx);
    expect(s.content).toContain('beta');
    const snap = await tool.execute({ op: 'snapshot' }, ctx);
    expect(snap.content).toContain('## alpha');
  });

  it('tool validates required args and reports INVALID_ARGS', async () => {
    const tool = createMemoryTool({ workspaceRoot: ws });
    const bad = await tool.execute({ op: 'read' }, ctx);
    expect(bad.error?.errorClass).toBe('INVALID_ARGS');
    const unknown = await tool.execute({ op: 'explode' }, ctx);
    expect(unknown.error?.errorClass).toBe('INVALID_ARGS');
  });
});
