import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Session } from '@vessel/core';
import { canonicalArgumentsHash, projectSession, type SessionRecord } from '@vessel/shared';
import { Compaction } from './Compaction.js';
import { ContextBuilder } from '../builder/Builder.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it('conserves hashed sources, policy, pending approvals/effects, file refs and usage across two compactions, model switch and reopen', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-compaction-golden-')); roots.push(root);
  let session = await Session.open({ workspaceRoot: root, sessionId: 'golden' });
  const facts = { policyRefs: ['system-policy:sha256-fixture', 'filesystem.protected'], pendingApprovalRefs: ['approval-1'], pendingEffectRefs: ['write-unknown:1'] };
  let model = 'model-a', providerId = 'provider-a';
  const usage = () => session.replay().filter(record => record.type === 'model/usage').reduce((total, record) => {
    const value = record.usage as { inputTokens: number; outputTokens: number; cacheReadTokens: number };
    return { input: total.input + value.inputTokens, output: total.output + value.outputTokens, cache: total.cache + value.cacheReadTokens };
  }, { input: 0, output: 0, cache: 0 });
  try {
    await session.appendSync({ type: 'user/message', content: 'GOAL keep policy and important.txt; never replay unknown writes', metadata: { keepID: 'goal' } });
    for (let i = 0; i < 24; i++) {
      await session.appendSync({ type: 'assistant/attempt', content: 'read', toolCalls: [{ toolCallId: `read-${i}`, toolName: 'Read', arguments: { path: 'important.txt' } }] });
      await session.appendSync({ type: 'tool/result', toolCallId: `read-${i}`, toolName: 'Read', content: `line-${i}`, meta: {} });
      await session.appendSync({ type: 'model/usage', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 60 }, model, providerId, surface: false });
    }
    await session.appendSync({ type: 'audit/denial', ruleRef: 'filesystem.protected', stage: 'rule', reason: 'protected', surface: false });
    const beforeUsage = usage();
    const result = await new Compaction({ session, recoveryFacts: () => facts, summarize: async () => 'Generated history summary' }).compact('manual');
    expect(result.summaryHash).toMatch(/^[a-f0-9]{64}$/);
    const committed = session.replay().find(record => record.outcome === 'committed')!;
    const commit = committed.projectionCommit as { summary: string; metadata: { summaryHash: string; provenance: Record<string, unknown> } };
    expect(commit.metadata.summaryHash).toBe(canonicalArgumentsHash({ summary: commit.summary, provenance: commit.metadata.provenance }));
    expect(commit.metadata.provenance).toMatchObject({ ...facts, fileRefs: ['important.txt'], schemaVersion: 1 });
    expect(result.summary).toContain('filesystem.protected'); expect(result.summary).toContain('approval-1'); expect(result.summary).toContain('write-unknown:1');
    expect(usage()).toEqual(beforeUsage);
    model = 'model-b'; providerId = 'provider-b';
    const build = () => new ContextBuilder({ session, model, modelSelection: () => ({ model, providerId }),
      stableSections: () => ['behavior'], policyGuidance: () => ['Never weaken system policy'], instructions: () => [], getVisibleTools: () => [] });
    const envelope = await build().assemble(1);
    expect(envelope.model).toBe('model-b');
    expect(JSON.stringify(envelope.messages)).toContain('Never weaken system policy');
    expect(JSON.stringify(envelope.messages)).toContain('write-unknown:1');
    await session.close(); session = await Session.open({ workspaceRoot: root, sessionId: 'golden' });
    expect(projectSession(session.sessionId, session.replay()).revision).toBe(1); expect(usage()).toEqual(beforeUsage);
    for (let i = 0; i < 8; i++) await session.appendSync({ type: 'user/message', content: `followup ${i}` });
    const second = await new Compaction({ session, recoveryFacts: () => facts }).compact('manual');
    expect(second.summaryHash).not.toBe(result.summaryHash);
    expect(second.summary).toContain('important.txt'); expect(second.summary).toContain('approval-1');
    expect(usage()).toEqual(beforeUsage);
    for (const record of session.replay().filter(record => record.outcome === 'committed')) {
      const evidence = (record.projectionCommit as typeof commit).metadata.provenance;
      const sources = session.replay().filter(source => source.seq >= Number(evidence.sourceStart) && source.seq <= Number(evidence.sourceEnd)
        && source.type !== 'compaction/start' && source.type !== 'compaction/end');
      expect(evidence.sourceHash).toBe(canonicalArgumentsHash(JSON.parse(JSON.stringify(sources))));
    }
    for (const tamper of ['summary', 'provenance', 'source', 'sourceHash'] as const) {
      const corrupted = structuredClone([...session.replay()]);
      // Warm validation first: mutating the same objects must invalidate cached evidence.
      expect(projectSession(session.sessionId, corrupted).revision).toBe(2);
      const target = corrupted.find(record => record.outcome === 'committed')!;
      const altered = target.projectionCommit as typeof commit;
      if (tamper === 'summary') altered.summary += 'tampered';
      if (tamper === 'provenance') altered.metadata.provenance.pendingApprovalRefs = [];
      if (tamper === 'source') (corrupted.find(record => record.type === 'tool/result') as { content: string }).content += 'tampered';
      if (tamper === 'sourceHash') {
        altered.metadata.provenance.sourceHash = 'tampered';
        altered.metadata.summaryHash = canonicalArgumentsHash({ summary: altered.summary, provenance: altered.metadata.provenance });
      }
      expect(() => projectSession(session.sessionId, corrupted)).toThrow('Compaction evidence hash mismatch');
    }
  } finally { await session.close(); }
});

it('fails compaction safely when pending authority changes during summarization', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-compaction-race-')); roots.push(root);
  const session = await Session.open({ workspaceRoot: root });
  let pending = ['approval-1'];
  try {
    for (let i = 0; i < 8; i++) await session.appendSync({ type: 'user/message', content: `goal ${i}` });
    await expect(new Compaction({ session, recoveryFacts: () => ({ pendingApprovalRefs: [...pending] }), summarize: async () => { pending = []; return 'summary'; } }).compact('manual')).rejects.toThrow('recovery facts changed');
    expect(projectSession(session.sessionId, session.replay()).revision).toBe(0);
    expect(session.replay().some((record: SessionRecord) => record.outcome === 'failed')).toBe(true);
  } finally { await session.close(); }
});
