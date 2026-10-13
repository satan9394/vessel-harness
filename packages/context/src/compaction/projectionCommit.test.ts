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
