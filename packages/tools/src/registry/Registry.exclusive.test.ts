import { describe, it, expect } from 'vitest';
import type { ToolCall, ToolExecutionResult, ToolSpec } from '@vessel/shared';
import { ToolRegistry } from './Registry.js';

/**
 * BRIEF — exclusive 链"一抛永久中毒"。
 *
 * 旧实现（`Registry.execute` 的 exclusive 分支）把 `run()` 直接放进
 * `exclusiveChain.then(...)`。`run()` 会重新抛出 `tool.execute` 的错误 ⇒ 链本身
 * 变成 **rejected 且永久 rejected**：之后每次 `.then(...)` 的**回调永不执行**
 * （工具根本没跑），而调用方 `await this.exclusiveChain` 拿到的是**上一次的陈旧
 * 错误**。一次写工具异常 ⇒ 此后所有写工具静默不执行。
 *
 * 修复：链的回调**自行吸收失败**（catch 后链恢复为 resolved），再把该次失败**如实
 * 抛给当次调用方**——错误不会被吞成成功，也不会被邻居的错误顶替。
 *
 * 本文件按 BRIEF ④ 组织：①②（+⑤，附加）为判别性用例（删掉修复必红），③④ 为负对照
 * （修复前后都必须绿，用来证明既有语义未被放宽/未被改动）。
 */

const CTX = {
  workspaceRoot: process.cwd(),
  cwd: process.cwd(),
  sandbox: {
    confine: async () => ({ argv: [], enforcement: 'none' as const }),
    status: () => ({ enabled: false, supported: 'none' as const, active: false }),
  },
};

function call(id: string, toolName: string): ToolCall {
  return { toolCallId: id, toolName, arguments: {} };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Exclusive tool that records its run and optionally throws / blocks. */
function exclusiveTool(
  name: string,
  state: { events: string[]; tick: (delta: 1 | -1) => void },
  opts: { throw?: () => unknown; gate?: () => Promise<void>; delayMs?: number } = {},
): ToolSpec {
  return {
    name,
    description: name,
    family: 'file_write',
    requiredPermission: 'workspace-write',
    exclusive: true,
    inputSchema: { type: 'object', properties: {} },
    async execute(): Promise<ToolExecutionResult> {
      state.tick(1);
      state.events.push(`${name}:start`);
      try {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (opts.gate) await opts.gate();
        if (opts.throw) {
          state.events.push(`${name}:throw`);
          throw opts.throw();
        }
        state.events.push(`${name}:end`);
        return { content: `${name}-done`, meta: {} };
      } finally {
        state.tick(-1);
      }
    },
  };
}

/** Non-exclusive (read) tool — must never enter the exclusive chain. */
function readTool(
  name: string,
  state: { events: string[]; tick: (delta: 1 | -1) => void },
  opts: { gate?: () => Promise<void> } = {},
): ToolSpec {
  return {
    name,
    description: name,
    family: 'file_read',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: { type: 'object', properties: {} },
    async execute(): Promise<ToolExecutionResult> {
      state.tick(1);
      state.events.push(`${name}:start`);
      try {
        if (opts.gate) await opts.gate();
        state.events.push(`${name}:end`);
        return { content: `${name}-done`, meta: {} };
      } finally {
        state.tick(-1);
      }
    },
  };
}

/** Shared concurrency ledger + event log handed to every fake tool. */
function ledger(): { events: string[]; tick: (delta: 1 | -1) => void; maxActive: () => number } {
  const events: string[] = [];
  let active = 0;
  let max = 0;
  return {
    events,
    tick: (delta) => {
      active += delta;
      if (active > max) max = active;
    },
    maxActive: () => max,
  };
}

describe('exclusive chain recovery — one throwing write tool must not poison later writes', () => {
  it('① a throwing exclusive tool does not stop the NEXT exclusive call (it really runs, with its own result)', async () => {
    const s = ledger();
    const registry = new ToolRegistry([
      exclusiveTool('WriteBoom', s, { throw: () => new Error('WriteBoom-error') }),
      exclusiveTool('WriteOk', s),
    ]);

    // the failing call still fails — that is the pre-existing contract, unchanged
    await expect(registry.execute(call('c1', 'WriteBoom'), CTX)).rejects.toThrow('WriteBoom-error');

    // DISCRIMINATOR: on the pre-fix chain (`this.exclusiveChain.then(async () => { result = await run(); })`)
    // this line rejects with the STALE 'WriteBoom-error' and `WriteOk.execute` is never entered.
    const ok = await registry.execute(call('c2', 'WriteOk'), CTX);
    expect(ok.error).toBeUndefined();
    expect(ok.content).toBe('WriteOk-done');
    expect(s.events).toEqual(['WriteBoom:start', 'WriteBoom:throw', 'WriteOk:start', 'WriteOk:end']);
  });

  it('② each failing exclusive caller receives ITS OWN error — never swallowed into a success, never a neighbour\'s error', async () => {
    const s = ledger();
    const registry = new ToolRegistry([
      exclusiveTool('W1', s, { throw: () => new Error('W1-error') }),
      exclusiveTool('W2', s),
      exclusiveTool('W3', s, { throw: () => new Error('W3-error') }),
    ]);

    await expect(registry.execute(call('c1', 'W1'), CTX)).rejects.toThrow('W1-error');
    expect((await registry.execute(call('c2', 'W2'), CTX)).content).toBe('W2-done');

    // DISCRIMINATOR (swallowing): an empty `catch {}` with no rethrow makes this
    // resolve instead of reject — the write failure would become a silent success.
    const w3 = await registry.execute(call('c3', 'W3'), CTX).then(
      () => null,
      (err: unknown) => err as Error,
    );
    expect(w3).toBeInstanceOf(Error);
    // DISCRIMINATOR (stale error): a poisoned chain would surface 'W1-error' here.
    expect((w3 as Error).message).toBe('W3-error');

    // and the chain is still usable after the second failure
    expect((await registry.execute(call('c4', 'W2'), CTX)).content).toBe('W2-done');
    expect(s.events).toEqual([
      'W1:start', 'W1:throw',
      'W2:start', 'W2:end',
      'W3:start', 'W3:throw',
      'W2:start', 'W2:end',
    ]);
  });

  it('⑤ a throwing exclusive call still releases its rolling-pool slot (the `finally` ledger is untouched)', async () => {
    const s = ledger();
    // maxParallel=1 ⇒ a leaked inFlight slot would make the next call report
    // 'rolling pool exhausted' instead of running.
    const registry = new ToolRegistry(
      [exclusiveTool('WriteBoom', s, { throw: () => new Error('boom') }), exclusiveTool('WriteOk', s)],
      { maxParallel: 1 },
    );
    await expect(registry.execute(call('c1', 'WriteBoom'), CTX)).rejects.toThrow('boom');
    const ok = await registry.execute(call('c2', 'WriteOk'), CTX);
    expect(ok.error).toBeUndefined();
    expect(ok.content).toBe('WriteOk-done');
  });
});

describe('exclusive chain — negative controls (must hold before AND after the fix)', () => {
  it('③ consecutive exclusive calls stay serial, in call order, each with its own result', async () => {
    const s = ledger();
    const registry = new ToolRegistry([
      exclusiveTool('W1', s, { delayMs: 5 }),
      exclusiveTool('W2', s, { delayMs: 5 }),
      exclusiveTool('W3', s, { delayMs: 5 }),
    ]);

    // fired concurrently without awaiting — the barrier is what makes them serial
    const results = await Promise.all([
      registry.execute(call('c1', 'W1'), CTX),
      registry.execute(call('c2', 'W2'), CTX),
      registry.execute(call('c3', 'W3'), CTX),
    ]);

    expect(results.map((r) => r.content)).toEqual(['W1-done', 'W2-done', 'W3-done']);
    expect(s.events).toEqual(['W1:start', 'W1:end', 'W2:start', 'W2:end', 'W3:start', 'W3:end']);
    expect(s.maxActive()).toBe(1); // never two exclusive bodies at once
  });

  it('④ the non-exclusive path bypasses the barrier entirely and is unaffected by it', async () => {
    const s = ledger();
    const gate = deferred();
    const registry = new ToolRegistry([
      exclusiveTool('WriteGate', s, { gate: () => gate.promise }),
      readTool('ReadA', s),
    ]);

    const write = registry.execute(call('c1', 'WriteGate'), CTX);
    // the read resolves WHILE the exclusive call is still blocked ⇒ it never
    // queued behind `exclusiveChain`. (No event-order equality here: whether the
    // exclusive body has already been entered depends on microtask scheduling.)
    const read = await registry.execute(call('c2', 'ReadA'), CTX);
    expect(read.error).toBeUndefined();
    expect(read.content).toBe('ReadA-done');
    expect(s.events).toContain('ReadA:start');
    expect(s.events).not.toContain('WriteGate:end'); // the exclusive call is provably still in flight

    gate.resolve();
    const w = await write;
    expect(w.content).toBe('WriteGate-done');
    expect(s.events).toContain('WriteGate:end');
  });
});
