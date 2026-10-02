import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '@vessel/core';
import { createVesselServer } from './server.js';
import { SubagentSeam, type SubagentSummary } from './subagentSeam.js';

describe('SubagentSeam', () => {
  it('leaves native delegates to their own cancellation owner', async () => {
    const bus = new EventBus();
    const seam = new SubagentSeam();
    const off = seam.attach(bus, () => false);
    await bus.emit('subagent_start', { delegateId: 'del_native', childAgentId: 'native' });
    expect(await seam.listSubagents()).toEqual([]);
    off();
  });

  it('detaches SSE subscribers when disconnected during an asynchronous snapshot', async () => {
    let resolve!: (runs: SubagentSummary[]) => void;
    const snapshot = new Promise<SubagentSummary[]>(done => { resolve = done; });
    const seam = new SubagentSeam({ getActiveRuns: () => snapshot });
    const subscribe = seam.subscribe.bind(seam);
    const detached = vi.fn();
    vi.spyOn(seam, 'subscribe').mockImplementation(listener => {
      const off = subscribe(listener);
      return () => { off(); detached(); };
    });
    const server = await createVesselServer({ port: 0, subagentSeam: seam }).listen();
    const abort = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/events`, { signal: abort.signal });
      await response.body!.getReader().read();
      abort.abort();
      await vi.waitFor(() => expect(detached).toHaveBeenCalledOnce());
    } finally {
      resolve([]);
      abort.abort();
      await server.close();
    }
  });

  it('lists active subagents from registered runs', async () => {
    const seam = new SubagentSeam();
    const item: SubagentSummary = {
      id: 'sub-1',
      name: 'external-agent',
      provider: 'mock',
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const cancel = vi.fn(() => true);
    seam.registerRun(item, cancel);

    const list = await seam.listSubagents();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('sub-1');
  });

  it('cancels an existing subagent run', async () => {
    const seam = new SubagentSeam();
    const item: SubagentSummary = {
      id: 'sub-2',
      name: 'external-agent',
      provider: 'mock',
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const cancel = vi.fn(() => true);
    seam.registerRun(item, cancel);

    const cancelled = await seam.cancelSubagent('sub-2');
    expect(cancelled).toBe(true);

    const list = await seam.listSubagents();
    expect(cancel).toHaveBeenCalledWith('sub-2');
    expect(list[0]?.status).toBe('running');
  });

  it('returns false when cancelling non-existent run', async () => {
    const seam = new SubagentSeam();
    const cancelled = await seam.cancelSubagent('not-exist');
    expect(cancelled).toBe(false);
  });

  it('whitelists summary fields even from embedding callbacks and refuses fake cancellation', async () => {
    const summary = { id: 'private', name: 'fixture', provider: 'mock', status: 'running' as const, startedAt: 'today', prompt: 'secret', result: { output: 'secret' } };
    const seam = new SubagentSeam();
    seam.registerRun(summary);
    expect(await seam.cancelSubagent('private')).toBe(false);
    expect(JSON.stringify(seam.detail('private'))).not.toContain('secret');
    const injected = new SubagentSeam({ getActiveRuns: async () => [summary] });
    expect(JSON.stringify(await injected.listSubagents())).not.toContain('secret');
  });

  it('projects bounded lifecycle logs and usage without exposing result artifacts', async () => {
    const bus = new EventBus();
    const seam = new SubagentSeam();
    const off = seam.attach(bus, () => true);
    await bus.emit('subagent_start', { delegateId: 'external_one', preset: 'mock', provider: 'fixture' });
    await bus.emit('subagent_step', { delegateId: 'external_one', phase: 'workspace', worktreePath: '/private/wt' });
    for (let i = 0; i < 110; i++) await bus.emit('model_stream_delta', { turnId: 'external_one', chunk: { type: 'text_delta', text: 'x'.repeat(600) } });
    await bus.emit('model_stream_end', { turnId: 'external_one', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheCreationTokens: 2 } });
    await bus.emit('subagent_stop', { delegateId: 'external_one', exitCode: 7, result: { stopReason: 'error', diagnostic: 'failed', output: 'private result' } });
    const detail = seam.detail('external_one')!;
    expect(detail.logs).toHaveLength(100);
    expect(detail.logs.every(log => log.message.length <= 512)).toBe(true);
    expect(detail.summary).toMatchObject({ status: 'failed', exitCode: 7, worktreePath: '/private/wt' });
    expect(detail.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 });
    expect(JSON.stringify(await seam.listSubagents())).not.toContain('private result');
    expect(await seam.cancelSubagent('external_one')).toBe(false);
    detail.summary.name = 'mutated';
    expect(seam.detail('external_one')!.summary.name).toBe('mock');
    off();
  });

  it('serves summaries, replays detail and forwards lifecycle over HTTP SSE', async () => {
    const seam = new SubagentSeam();
    const bus = new EventBus();
    const cancel = vi.fn(() => true);
    const off = seam.attach(bus, cancel);
    const server = await createVesselServer({ port: 0, subagentSeam: seam }).listen();
    const base = `http://127.0.0.1:${server.port}`;
    const abort = new AbortController();
    try {
      const response = await fetch(`${base}/api/events`, { signal: abort.signal });
      const reader = response.body!.getReader();
      await reader.read();
      await bus.emit('subagent_start', { delegateId: 'external_http', preset: 'fixture' });
      await bus.emit('subagent_step', { delegateId: 'external_http', phase: 'workspace', worktreePath: '/test/wt' });
      const list = await (await fetch(`${base}/api/subagents`)).json() as { subagents: SubagentSummary[] };
      const detail = await (await fetch(`${base}/api/subagents/external_http`)).json() as { summary: SubagentSummary };
      expect(list.subagents[0]!.id).toBe('external_http');
      expect(detail.summary.worktreePath).toBe('/test/wt');
      expect((await fetch(`${base}/api/subagents/external_http/cancel`, { method: 'POST' })).status).toBe(200);
      expect(cancel).toHaveBeenCalledWith('external_http');
      await bus.emit('subagent_stop', { delegateId: 'external_http', result: { stopReason: 'aborted' } });
      let text = '';
      while (!text.includes('subagent:end')) text += new TextDecoder().decode((await reader.read()).value);
      expect(text).toContain('subagent:start');
      expect(text).toContain('subagent:step');
      expect(text).toContain('cancelled');
      expect((await fetch(`${base}/api/subagents/external_http/cancel`, { method: 'POST' })).status).toBe(404);
    } finally {
      abort.abort();
      off();
      await server.close();
    }
  });
});
