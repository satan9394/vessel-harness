import { describe, it, expect } from 'vitest';
import type { ToolCall, ToolSpec } from '@vessel/shared';
import { ToolRegistry } from './Registry.js';
import { ParallelScheduler, isReadFamily } from './parallel.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Read tool that records [start, end] timestamps and can block on a gate. */
function readTool(name: string, events: { id: string; kind: 'start' | 'end' }[], gate?: () => Promise<void>): ToolSpec {
  return {
    name,
    description: name,
    family: 'file_read',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      events.push({ id: name, kind: 'start' });
      if (gate) await gate();
      events.push({ id: name, kind: 'end' });
      return { content: `${name}-done`, meta: {} };
    },
  };
}

function writeTool(name: string, events: { id: string; kind: 'start' | 'end' }[], gate?: () => Promise<void>): ToolSpec {
  return {
    name,
    description: name,
    family: 'file_write',
    requiredPermission: 'workspace-write',
    exclusive: true,
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      events.push({ id: name, kind: 'start' });
      if (gate) await gate();
      events.push({ id: name, kind: 'end' });
      return { content: `${name}-done`, meta: {} };
    },
  };
}

const CTX = {
  workspaceRoot: process.cwd(),
  cwd: process.cwd(),
  sandbox: { confine: async () => ({ argv: [], enforcement: 'none' as const }), status: () => ({ enabled: false, supported: 'none' as const, active: false }) },
};

function call(id: string, toolName: string): ToolCall {
  return { toolCallId: id, toolName, arguments: {} };
}

describe('V0.2-M5 parallel exploration — 1–3 concurrency, read/write split', () => {
  it('isReadFamily classifies read-only tools (file_read/search) and excludes exclusive/write', () => {
    const r: ToolSpec = { name: 'Read', description: '', family: 'file_read', requiredPermission: 'read', exclusive: false, inputSchema: { type: 'object', properties: {} }, async execute() { return { content: '', meta: {} }; } };
    const s: ToolSpec = { name: 'Grep', description: '', family: 'search', requiredPermission: 'read', exclusive: false, inputSchema: { type: 'object', properties: {} }, async execute() { return { content: '', meta: {} }; } };
    const w: ToolSpec = { name: 'Write', description: '', family: 'file_write', requiredPermission: 'workspace-write', exclusive: true, inputSchema: { type: 'object', properties: {} }, async execute() { return { content: '', meta: {} }; } };
    const sh: ToolSpec = { name: 'Shell', description: '', family: 'exec', requiredPermission: 'danger-full-access', exclusive: true, inputSchema: { type: 'object', properties: {} }, async execute() { return { content: '', meta: {} }; } };
    expect(isReadFamily(r)).toBe(true);
    expect(isReadFamily(s)).toBe(true);
    expect(isReadFamily(w)).toBe(false);
    expect(isReadFamily(sh)).toBe(false);
    expect(isReadFamily(undefined)).toBe(false);
  });

  it('runs multiple read-only calls concurrently (≤ maxParallel)', async () => {
    const events: { id: string; kind: 'start' | 'end' }[] = [];
    const g1 = deferred();
    const g2 = deferred();
    const g3 = deferred();
    const registry = new ToolRegistry([
      readTool('ReadA', events, () => g1.promise),
      readTool('ReadB', events, () => g2.promise),
      readTool('ReadC', events, () => g3.promise),
    ]);
    const scheduler = new ParallelScheduler(registry, CTX, { maxParallel: 2 });

    const p = scheduler.runBatch([call('c1', 'ReadA'), call('c2', 'ReadB'), call('c3', 'ReadC')]);
    // with maxParallel=2, A and B start together; C waits until one finishes
    await new Promise((r) => setTimeout(r, 20));
    const starts = events.filter((e) => e.kind === 'start').map((e) => e.id).sort();
    expect(starts).toEqual(['ReadA', 'ReadB']);
    expect(events.some((e) => e.id === 'ReadC' && e.kind === 'start')).toBe(false);

    g1.resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(events.some((e) => e.id === 'ReadC' && e.kind === 'start')).toBe(true);
    g2.resolve();
    g3.resolve();
    const results = await p;
    expect(results.map((r) => r.result.content)).toEqual(['ReadA-done', 'ReadB-done', 'ReadC-done']);
  });

  it('clamps maxParallel into [1,3]', () => {
    const registry = new ToolRegistry([readTool('ReadA', [])]);
    expect(new ParallelScheduler(registry, CTX, { maxParallel: 5 }).parallelLimit).toBe(3);
    expect(new ParallelScheduler(registry, CTX, { maxParallel: 0 }).parallelLimit).toBe(1);
    expect(new ParallelScheduler(registry, CTX).parallelLimit).toBe(2);
  });

  it('write/exclusive calls are serial barriers between reads (读并发/写串行)', async () => {
    const events: { id: string; kind: 'start' | 'end' }[] = [];
    const rg = deferred(); // blocks the first read until released
    const registry = new ToolRegistry([
      readTool('Read1', events, () => rg.promise),
      writeTool('Write1', events),
      readTool('Read2', events),
    ]);
    const scheduler = new ParallelScheduler(registry, CTX, { maxParallel: 2 });

    const p = scheduler.runBatch([call('c1', 'Read1'), call('c2', 'Write1'), call('c3', 'Read2')]);
    await new Promise((r) => setTimeout(r, 20));
    // Read1 started; the write must NOT start while a read is in flight
    expect(events.some((e) => e.id === 'Read1' && e.kind === 'start')).toBe(true);
    expect(events.some((e) => e.id === 'Write1' && e.kind === 'start')).toBe(false);

    rg.resolve();
    const results = await p;
    const timeline = events.map((e) => `${e.id}:${e.kind}`);
    const writeStart = timeline.indexOf('Write1:start');
    const read1End = timeline.indexOf('Read1:end');
    const read2Start = timeline.indexOf('Read2:start');
    expect(read1End).toBeGreaterThanOrEqual(0);
    expect(writeStart).toBeGreaterThan(read1End); // write waits for pending reads
    expect(read2Start).toBeGreaterThan(timeline.indexOf('Write1:end')); // later reads wait for the write
    expect(results.map((r) => r.result.content)).toEqual(['Read1-done', 'Write1-done', 'Read2-done']);
  });

  it('returns results in input order (stable) and handles denied/unknown tools', async () => {
    const events: { id: string; kind: 'start' | 'end' }[] = [];
    const registry = new ToolRegistry([readTool('ReadA', events), readTool('ReadB', events)]);
    const scheduler = new ParallelScheduler(registry, CTX, { maxParallel: 3 });
    const results = await scheduler.runBatch([call('b', 'ReadB'), call('a', 'ReadA'), call('x', 'MissingTool'), call('w', 'WriteOnly')]);
    expect(results.map((r) => r.call.toolCallId)).toEqual(['b', 'a', 'x', 'w']);
    expect(results[0]!.result.content).toBe('ReadB-done');
    expect(results[2]!.result.error?.errorClass).toBe('INVALID_ARGS'); // unknown tool
    expect(results[3]!.result.error?.errorClass).toBe('INVALID_ARGS'); // unregistered write → serial barrier, error result
  });
});
