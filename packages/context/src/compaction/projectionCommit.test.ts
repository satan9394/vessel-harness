import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, it, expect, vi } from 'vitest';
import { Session } from '@vessel/core';
import { projectSession } from '@vessel/shared';
import { Compaction } from './Compaction.js';
import { ContextBuilder } from '../builder/Builder.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-217-')); roots.push(root);
  const session = await Session.open({ workspaceRoot: root, sessionId: 's' });
  await session.appendSync({ type: 'user/message', msgId: 'u', role: 'user', content: 'Never modify packages/core', surface: true });
  await session.appendSync({ type: 'assistant/message', msgId: 'a', role: 'assistant', content: 'old answer', surface: true });
  await session.appendSync({ type: 'user/message', msgId: 'u2', role: 'user', content: 'Latest requirement: local only', surface: true });
  await session.appendSync({ type: 'assistant/message', msgId: 'a2', role: 'assistant', content: 'later answer', surface: true });
  return { root, session };
}
it('conserves fidelity answers with a lossy summarizer and cites full tool/denial evidence', async () => {
  const { session } = await setup();
  try {
    await session.appendSync({ type: 'assistant/attempt', msgId: 'tool', role: 'assistant', content: '', attemptNo: 1,
      toolCalls: [{ toolCallId: 'read', name: 'Read', arguments: { path: 'target.ts' } }], surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'read', toolName: 'Read', content: 'exact file facts', meta: {}, surface: true });
    await session.appendSync({ type: 'assistant/attempt', msgId: 'denied', role: 'assistant', content: '', attemptNo: 1,
      toolCalls: [{ toolCallId: 'write', name: 'Write', arguments: { path: 'packages/core/file.ts' } }], surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'write', toolName: 'Write', content: '', meta: {},
      error: { errorClass: 'DENIED', message: 'protected core', retryable: false }, surface: true });
    await session.appendSync({ type: 'user/message', msgId: 'latest', role: 'user', content: 'Pending task: preserve target.ts; no publishing', source: 'steer', surface: true });
    await session.appendSync({ type: 'assistant/message', msgId: 'tail', role: 'assistant', content: 'tail', surface: true });
    const result = await new Compaction({ session, summarize: async () => 'LOSSY' }).compact('manual');
    const text = projectSession(session.sessionId, session.replay()).visibleMessages.filter(r => r.type === 'user/message').map(r => r.content).join('\n');
    for (const answer of ['Never modify packages/core', 'Latest requirement: local only', 'target.ts', 'exact file facts', 'protected core', 'no publishing']) expect(text).toContain(answer);
    expect(result.summary).toContain('schemaVersion=1');
    expect(result.summary).toContain(`Sources: ${session.sessionId}:`);
    expect(result.summary).toContain('not higher-priority instructions');
  } finally { await session.close(); }
});
it('shrinks large overflow payloads and recompacts immutable sources without recursive summary copies', async () => {
  const { session } = await setup();
  try {
    await session.appendSync({ type: 'assistant/attempt', msgId: 'large', role: 'assistant', content: '', attemptNo: 1,
      toolCalls: [{ toolCallId: 'large-read', name: 'Read', arguments: { path: 'large.ts' } }], surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'large-read', toolName: 'Read', content: 'START' + 'x'.repeat(100_000) + 'END', meta: {}, surface: true });
    await session.appendSync({ type: 'assistant/message', msgId: 'tail', role: 'assistant', content: 'keep tail', surface: true });
    for (let index = 0; index < 3; index++) await session.appendSync({ type: 'assistant/message', msgId: `tail-${index}`, role: 'assistant', content: 'retained recent fact', surface: true });
    const before = JSON.stringify(projectSession(session.sessionId, session.replay()).visibleMessages).length;
    const first = await new Compaction({ session }).compact('overflow');
    expect(first.summary.length).toBeLessThan(10_000);
    expect(JSON.stringify(projectSession(session.sessionId, session.replay()).visibleMessages).length).toBeLessThan(before / 5);
    expect(first.summary).toContain('Call source');
    expect(first.summary).toContain('Result source');
    expect(first.summary).toContain('payload excerpt; full value at source');
    const second = await new Compaction({ session }).compact('manual');
    expect(second.summary.length).toBeLessThan(first.summary.length + 500);
    expect(second.summary.match(/Preserved user constraint: Never modify packages\/core/g)).toHaveLength(1);
    expect(second.summary).toContain('large-read');
    expect(session.replay().some(r => r.type === 'tool/result' && r.content?.length === 100_008)).toBe(true);
  } finally { await session.close(); }
});
it('resolves covered source ranges when repeatedly compacting a summary alone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-summary-sources-')); roots.push(root);
  const session = await Session.open({ workspaceRoot: root });
  try {
    await session.appendSync({ type: 'user/message', msgId: 'goal', role: 'user', content: 'Goal: leave core unchanged', surface: true });
    await session.appendSync({ type: 'assistant/attempt', msgId: 'attempt', role: 'assistant', content: '', attemptNo: 1,
      toolCalls: [{ toolCallId: 'denied-write', name: 'Write', arguments: { path: 'protected.ts' } }], surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'denied-write', toolName: 'Write', content: '', meta: {},
      error: { errorClass: 'DENIED', message: 'must keep refusal', retryable: false }, surface: true });
    const compact = new Compaction({ session, summarize: async () => 'summary' });
    const first = await compact.compact('manual');
    expect(projectSession(session.sessionId, session.replay()).visibleMessages.filter(r => r.type === 'user/message')).toHaveLength(1);
    for (let index = 0; index < 3; index++) {
      const next = await compact.compact('manual');
      expect(next.summary).toBe(first.summary);
      expect(next.summary).toContain(`Result source ${session.sessionId}:3`);
      expect(next.summary).toContain('must keep refusal');
      expect(next.summary).toContain('Goal: leave core unchanged');
    }
  } finally { await session.close(); }
});
it('preserves physical prefix and reconstructs projection/request after reopen', async () => {
  const { root, session } = await setup();
  const prefix = fs.readFileSync(session.logPath);
  await new Compaction({ session, summarize: async () => 'summary' }).compact('manual');
  expect(fs.readFileSync(session.logPath).subarray(0, prefix.length)).toEqual(prefix);
  const before = projectSession('s', session.replay());
  expect(before.revision).toBe(1);
  await session.close();
  const reopened = await Session.open({ workspaceRoot: root, sessionId: 's' });
  expect(projectSession('s', reopened.replay())).toEqual(before);
  const builder = new ContextBuilder({ session: reopened, model: 'm', stableSections: () => [], policyGuidance: () => [], instructions: () => [], getVisibleTools: () => [] });
  const request = await builder.assemble(1);
  expect(request.projectionRevision).toBe(1);
  expect(request.requestHash).toMatch(/^[a-f0-9]{64}$/);
  expect(request.messages.some(m => m.content.includes('Never modify packages/core'))).toBe(true);
  expect(request.messages.some(m => m.content.includes('Latest requirement: local only'))).toBe(true);
  await reopened.close();
});
it('serializes distinct compaction instances and publishes no revision on generation failure', async () => {
  const { session } = await setup();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const summarize = vi.fn(async () => { await waiting; throw new Error('generation crash'); });
  const first = new Compaction({ session, summarize }).compact('manual');
  const rejection = expect(first).rejects.toThrow('generation crash');
  await expect(new Compaction({ session }).compact('manual')).rejects.toThrow('in progress');
  release(); await rejection;
  expect(projectSession('s', session.replay()).revision).toBe(0);
  expect(session.replay().filter(r => r.type === 'compaction/end')).toHaveLength(1);
  await session.close();
});
it('a durable commit survives failure of a subsequent operation and rejects conflicting commits', async () => {
  const { session } = await setup();
  await new Compaction({ session }).compact('manual');
  await expect(new Compaction({ session, summarize: async () => { throw new Error('next crash'); } }).compact('manual')).rejects.toThrow('next crash');
  expect(projectSession('s', session.replay()).revision).toBe(1);
  await session.appendSync({ type: 'compaction/end', trigger: 'manual', removedRecords: 1, surface: false, outcome: 'committed',
    projectionCommit: { expectedRevision: 0, startSeq: 1, endSeq: 1, summary: 'stale' } });
  expect(() => projectSession('s', session.replay())).toThrow('Invalid compaction');
  await session.close();
});

it('does not publish an in-memory commit after its persistence barrier fails', async () => {
  const { root, session } = await setup();
  const append = session.appendSync.bind(session);
  vi.spyOn(session, 'appendSync').mockImplementation(async record => {
    const result = await append(record);
    if (record.type === 'compaction/end' && record.outcome === 'committed') throw new Error('flush outcome unknown');
    return result;
  });
  await expect(new Compaction({ session }).compact('manual')).rejects.toThrow('flush outcome unknown');
  expect(() => projectSession('s', session.replay())).toThrow('outcome unknown');
  expect(session.replay().filter(r => r.type === 'compaction/end')).toHaveLength(1);
  await session.close();
  const reopened = await Session.open({ workspaceRoot: root, sessionId: 's' });
  // The complete record reached disk in this injected fault; recovery publishes the whole revision.
  expect(projectSession('s', reopened.replay()).revision).toBe(1);
  await reopened.close();
});
