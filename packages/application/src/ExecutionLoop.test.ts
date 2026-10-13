import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventBus, Session } from '@vessel/core';
import type { ChatProvider, ChatResponse } from '@vessel/shared';
import { ExecutionLoop } from './ExecutionLoop.js';

let root: string; let session: Session; let bus: EventBus;
const response: ChatResponse = { content: 'done', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
beforeEach(async () => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-execution-')); session = await Session.open({ workspaceRoot: root }); bus = new EventBus(); });
afterEach(async () => { await session.close(); fs.rmSync(root, { recursive: true, force: true }); });
function loop(provider: ChatProvider, budget?: ConstructorParameters<typeof ExecutionLoop>[1], runTool = vi.fn(async () => ({ content: 'ok', meta: {} }))) {
  return new ExecutionLoop({ session, bus, provider, model: 'mock', buildContext: async () => ({ model: 'mock', messages: [{ role: 'user', content: 'task' }], tools: [], estimateTokens: 1 }), runTool, getVisibleTools: () => [], maxSteps: 10 }, budget);
}
it('commits a plain text turn before isolated after_turn notifications', async () => {
  const chat = vi.fn(async () => response); bus.on('after_turn', () => { throw new Error('notification failure'); });
  const result = await loop({ id: 'mock', chat }).runTurn('task');
  expect(result.executionState).toBe('COMPLETED'); expect(chat).toHaveBeenCalledTimes(1);
  expect(session.replay().find(r => r.type === 'turn/end')).toMatchObject({ kind: 'success', executionState: 'COMPLETED' });
});
it('denies commit before success is persisted', async () => {
  bus.on('before_turn_commit', () => ({ kind: 'deny', reason: 'unverified' }));
  const result = await loop({ id: 'mock', chat: async () => response }).runTurn('task');
  expect(result).toMatchObject({ kind: 'error', executionState: 'DENIED', outcomeReason: 'unverified' });
  expect(session.replay().filter(r => r.type === 'turn/end')).toHaveLength(1);
  expect(session.replay().find(r => r.type === 'turn/end')).toMatchObject({ kind: 'error' });
});
it('bounds forceContinue across new attempts without resetting counters', async () => {
  const chat = vi.fn(async () => response);
  bus.on('before_turn_commit', payload => { (payload as { forceContinue: () => void }).forceContinue(); });
  const result = await loop({ id: 'mock', chat }, { maxModelSteps: 2 }).runTurn('task');
  expect(chat).toHaveBeenCalledTimes(2); expect(result).toMatchObject({ kind: 'budget', executionState: 'EXHAUSTED', outcomeReason: 'maxModelSteps' });
  expect(session.replay().filter(r => r.type === 'run/attempt')).toHaveLength(2);
});
it('enforces the legacy before_stop veto as bounded continuation', async () => {
  const chat = vi.fn(async () => response); bus.on('before_stop', () => 'deny');
  expect((await loop({ id: 'mock', chat }, { maxModelSteps: 1 }).runTurn('task')).executionState).toBe('EXHAUSTED');
  expect(chat).toHaveBeenCalledTimes(1);
});
it('denies before_turn with zero model calls and a denial terminal', async () => {
  const chat = vi.fn(async () => response); bus.on('before_turn', () => ({ kind: 'deny', reason: 'no admission' }));
  const result = await loop({ id: 'mock', chat }).runTurn('task');
  expect(result.executionState).toBe('DENIED'); expect(chat).not.toHaveBeenCalled();
  expect(session.replay().some(r => r.type === 'audit/denial')).toBe(true);
});
it('accepts cancellation while preparing the owning run before a core scope opens', async () => {
  const chat = vi.fn(async () => response);
  const execution = loop({ id: 'mock', chat });
  const pending = execution.runTurn('task');
  expect(execution.interrupt()).toBe(true);
  expect(execution.interrupt()).toBe(false);
  expect(await pending).toMatchObject({ kind: 'interrupted', executionState: 'CANCELLED' });
  expect(chat).not.toHaveBeenCalled();
});
it('blocks token overflow before dispatch and records exhaustion', async () => {
  const chat = vi.fn(async () => response);
  const result = await loop({ id: 'mock', chat }, { maxInputTokens: 0 }).runTurn('task');
  expect(chat).not.toHaveBeenCalled(); expect(result).toMatchObject({ executionState: 'EXHAUSTED', outcomeReason: 'maxInputTokens' });
});
it('blocks output overflow before any tool side effect', async () => {
  const runTool = vi.fn(async () => ({ content: 'ok', meta: {} }));
  const result = await loop({ id: 'mock', chat: async () => ({ ...response, usage: { inputTokens: 1, outputTokens: 20 }, toolCalls: [{ id: 'a', name: 'Write', arguments: {} }] }) }, { maxOutputTokens: 2 }, runTool).runTurn('task');
  expect(result.executionState).toBe('EXHAUSTED'); expect(runTool).not.toHaveBeenCalled();
});
it('bounds dispatches independently from model steps', async () => {
  const runTool = vi.fn(async () => ({ content: 'ok', meta: {} }));
  const result = await loop({ id: 'mock', chat: async () => ({ ...response, toolCalls: [{ id: 'a', name: 'Read', arguments: {} }, { id: 'b', name: 'Read', arguments: {} }] }) }, { maxToolCalls: 1 }, runTool).runTurn('task');
  expect(runTool).toHaveBeenCalledTimes(1); expect(result).toMatchObject({ executionState: 'EXHAUSTED', outcomeReason: 'maxToolCalls' });
});
it('waits for cancellation of active work and rejects a second writer', async () => {
  const provider: ChatProvider = { id: 'mock', chat: request => new Promise((resolve, reject) => {
    request.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    void resolve;
  }) };
  const execution = loop(provider, { maxElapsedMs: 30 });
  const pending = execution.runTurn('task');
  await expect(execution.runTurn('another writer')).rejects.toThrow('already owns');
  expect(await pending).toMatchObject({ executionState: 'EXHAUSTED', outcomeReason: 'maxElapsedMs' });
});
it('cancels safely even when a provider ignores its abort signal', async () => {
  let release!: (value: ChatResponse) => void;
  const chat = vi.fn(() => new Promise<ChatResponse>(resolve => { release = resolve; }));
  const execution = loop({ id: 'mock', chat });
  const pending = execution.runTurn('task');
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
  expect(execution.interrupt()).toBe(true); expect(execution.interrupt()).toBe(false);
  release(response);
  expect(await pending).toMatchObject({ kind: 'interrupted', executionState: 'CANCELLED', outcomeReason: 'cancelled' });
  expect(session.replay().filter(r => r.type === 'turn/end')).toHaveLength(1);
});
it('counts failed provider attempts toward the error and model caps', async () => {
  const chat = vi.fn(async () => { throw new Error('NETWORK'); });
  expect(await loop({ id: 'mock', chat }, { maxConsecutiveErrors: 1 }).runTurn('task')).toMatchObject({ executionState: 'EXHAUSTED', outcomeReason: 'maxConsecutiveErrors' });
  expect(chat).toHaveBeenCalledTimes(1);
});
it('blocks stream usage overflow before the assistant can dispatch tools', async () => {
  const execution = loop({ id: 'mock', chat: async () => response, stream: async function* () {
    yield { type: 'usage', inputTokens: 1, outputTokens: 10 };
    yield { type: 'tool_call_start', id: 'a', name: 'Write', arguments: '{}' };
    yield { type: 'tool_call_end', id: 'a' };
  } }, { maxOutputTokens: 2 });
  expect(await execution.runTurn('task')).toMatchObject({ executionState: 'EXHAUSTED', outcomeReason: 'maxOutputTokens', toolCalls: 0 });
});
it('honors cancellation that arrives during an asynchronous commit gate', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = vi.fn(); bus.on('before_turn_commit', async () => { entered(); await gate; });
  const execution = loop({ id: 'mock', chat: async () => response });
  const pending = execution.runTurn('task'); await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(1));
  expect(execution.interrupt()).toBe(true); release();
  expect(await pending).toMatchObject({ executionState: 'CANCELLED', kind: 'interrupted' });
  expect(session.replay().find(r => r.type === 'turn/end')).toMatchObject({ kind: 'interrupted', executionState: 'CANCELLED' });
});
it.each(['chat', 'stream'])('bounds large tool arguments even without trustworthy usage (%s)', async mode => {
  const runTool = vi.fn(async () => ({ content: 'ok', meta: {} }));
  const provider: ChatProvider = { id: 'mock', chat: async () => ({ ...response, toolCalls: [{ id: 'a', name: 'Write', arguments: { text: 'x'.repeat(1000) } }] }) };
  if (mode === 'stream') provider.stream = async function* () {
    yield { type: 'tool_call_start', id: 'a', name: 'Write', arguments: '' };
    yield { type: 'tool_call_delta', id: 'a', argumentsDelta: JSON.stringify({ text: 'x'.repeat(1000) }) };
    yield { type: 'tool_call_end', id: 'a' };
  };
  expect(await loop(provider, { maxOutputTokens: 10 }, runTool).runTurn('task')).toMatchObject({ executionState: 'EXHAUSTED', outcomeReason: 'maxOutputTokens' });
  expect(runTool).not.toHaveBeenCalled();
});
it('recovers an unfinished run with its spent counters and no automatic execution', async () => {
  const counters = { modelSteps: 5, toolCalls: 2, inputTokens: 30, outputTokens: 10, estimatedCost: 0, consecutiveErrors: 0 };
  await session.appendSync({ type: 'run/state', runId: 'old', state: 'RUNNING', revision: 2, counters, budget: { maxModelSteps: 5, maxToolCalls: 2, maxElapsedMs: 60000, maxConsecutiveErrors: 1 }, startedAt: Date.now(), outcomeReason: '', surface: false });
  const chat = vi.fn(async () => response); const execution = loop({ id: 'mock', chat });
  await execution.recoverIncompleteRuns(); await execution.recoverIncompleteRuns();
  const states = session.replay().filter(r => r.type === 'run/state');
  expect(states).toHaveLength(2); expect(states.at(-1)).toMatchObject({ state: 'CANCELLED', counters, outcomeReason: 'recovery_incomplete_run' });
  expect(chat).not.toHaveBeenCalled();
});
it('does not append a duplicate terminal after a commit flush failure and recovers the published result', async () => {
  const append = session.appendSync.bind(session);
  const spy = vi.spyOn(session, 'appendSync').mockImplementation(async record => {
    const published = await append(record);
    if (record.type === 'turn/end') throw new Error('injected fsync failure');
    return published;
  });
  const execution = loop({ id: 'mock', chat: async () => response });
  await expect(execution.runTurn('task')).rejects.toThrow('injected fsync failure');
  await expect(execution.runTurn('retry')).rejects.toThrow('close and reopen');
  expect(session.replay().filter(r => r.type === 'turn/end')).toHaveLength(1);
  spy.mockRestore(); const sessionId = session.sessionId; await session.close(); session = await Session.open({ workspaceRoot: root, sessionId });
  await loop({ id: 'mock', chat: async () => response }).recoverIncompleteRuns();
  expect(session.replay().filter(r => r.type === 'turn/end')).toHaveLength(1);
  expect(session.replay().filter(r => r.type === 'run/state').at(-1)).toMatchObject({ state: 'COMPLETED', counters: { modelSteps: 1 } });
});
it('does not dispatch another attempt when cancellation arrives after a continuation commit', async () => {
  const chat = vi.fn(async () => response);
  const execution = loop({ id: 'mock', chat });
  bus.on('before_turn_commit', payload => { (payload as { forceContinue: () => void }).forceContinue(); });
  bus.on('after_turn', () => { expect(execution.interrupt()).toBe(true); });
  expect(await execution.runTurn('task')).toMatchObject({ kind: 'interrupted', executionState: 'CANCELLED', outcomeReason: 'cancelled' });
  expect(chat).toHaveBeenCalledTimes(1);
  expect(session.replay().filter(record => record.type === 'run/attempt')).toHaveLength(1);
  expect(session.replay().filter(record => record.type === 'turn/end')).toHaveLength(1);
  expect(session.replay().filter(record => record.type === 'run/state').at(-1)).toMatchObject({ state: 'CANCELLED' });
});
it('accepts cancellation while the continuation state is being persisted outside the core scope', async () => {
  let release!: () => void; const paused = new Promise<void>(resolve => { release = resolve; });
  const entered = vi.fn(); const append = session.appendSync.bind(session);
  const spy = vi.spyOn(session, 'appendSync').mockImplementation(async record => {
    const result = await append(record);
    if (record.type === 'run/state' && record.state === 'SUSPENDED') { entered(); await paused; }
    return result;
  });
  const chat = vi.fn(async () => response); const execution = loop({ id: 'mock', chat });
  bus.on('before_turn_commit', payload => { (payload as { forceContinue: () => void }).forceContinue(); });
  const pending = execution.runTurn('task'); await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(1));
  expect(execution.turnActive).toBe(false);
  expect(execution.interrupt()).toBe(true); expect(execution.interrupt()).toBe(false);
  release();
  expect(await pending).toMatchObject({ executionState: 'CANCELLED', kind: 'interrupted', outcomeReason: 'cancelled' });
  expect(chat).toHaveBeenCalledTimes(1);
  expect(session.replay().filter(record => record.type === 'run/attempt')).toHaveLength(1);
  spy.mockRestore();
});
it('accepts cancellation immediately after an owned run starts before the first core turn', async () => {
  const chat = vi.fn(async () => response); const execution = loop({ id: 'mock', chat });
  const pending = execution.runTurn('task');
  expect(execution.interrupt()).toBe(true); expect(execution.interrupt()).toBe(false);
  expect(await pending).toMatchObject({ executionState: 'CANCELLED', kind: 'interrupted', outcomeReason: 'cancelled' });
  expect(chat).not.toHaveBeenCalled();
});
it('reports denied tool attempts in the public counters', async () => {
  const runTool = vi.fn(async () => ({ content: 'ok', meta: {} }));
  bus.on('before_tool', () => ({ kind: 'deny', reason: 'fixture denial' }));
  const execution = loop({ id: 'mock', chat: async () => ({ ...response, toolCalls: [{ id: 'a', name: 'Read', arguments: {} }] }) }, undefined, runTool);
  expect(await execution.runTurn('task')).toMatchObject({ kind: 'error', toolCalls: 3 });
  expect(runTool).not.toHaveBeenCalled();
  expect(session.replay().filter(record => record.type === 'tool/result')).toHaveLength(3);
});
it('applies the hard tool cap even when the policy denies every attempt', async () => {
  const runTool = vi.fn(async () => ({ content: 'ok', meta: {} }));
  bus.on('before_tool', () => ({ kind: 'deny', reason: 'fixture denial' }));
  const execution = loop({ id: 'mock', chat: async () => ({ ...response, toolCalls: [{ id: 'a', name: 'Read', arguments: {} }] }) }, { maxToolCalls: 1 }, runTool);
  expect(await execution.runTurn('task')).toMatchObject({ kind: 'budget', executionState: 'EXHAUSTED', outcomeReason: 'maxToolCalls', toolCalls: 1 });
  expect(runTool).not.toHaveBeenCalled();
  expect(session.replay().filter(record => record.type === 'tool/call')).toHaveLength(1);
});
it('preserves typed provider failures after publishing one FAILED terminal', async () => {
  const providerError = Object.assign(new Error('MissingSessionID'), { kind: 'missing-session', status: 400 });
  const execution = loop({ id: 'mock', chat: async () => { throw providerError; } });
  await expect(execution.runTurn('task')).rejects.toBe(providerError);
  expect(session.replay().filter(record => record.type === 'turn/end')).toHaveLength(1);
  expect(session.replay().filter(record => record.type === 'turn/end').at(-1)).toMatchObject({ kind: 'error', executionState: 'FAILED' });
  expect(session.replay().filter(record => record.type === 'run/state').at(-1)).toMatchObject({ state: 'FAILED' });
});
