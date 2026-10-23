import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalArgumentsHash, type CanonicalToolInvocation, type ToolSpec } from '@vessel/shared';
import { EffectJournal } from './EffectJournal.js';

describe('durable execution recovery boundaries', () => {
  let root: string; let file: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-effects-')); file = path.join(root, 'execution.jsonl'); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const call = { toolCallId: 'call', toolName: 'Write', arguments: {} };
  const invocation: CanonicalToolInvocation = { canonicalToolId: 'builtin:Write', subject: { sessionId: 's', runId: 'r', agentInstanceId: 'a' }, argumentsCanonicalHash: 'hash', requestedScopes: [] };
  const tool = { name: 'Write', requiredPermission: 'workspace-write', effects: 'non_idempotent' } as ToolSpec;
  it.each(['applied', 'not_applied'] as const)('durably reconciles %s without permitting replay and rejects stale or conflicting receipts', resolution => {
    const journal = new EffectJournal(file); journal.begin(call, tool, invocation);
    const receipt = { key: call.toolCallId, attempt: 1, invocationHash: canonicalArgumentsHash(invocation), resolution, evidence: 'operator inspected fixture receipt' };
    expect(() => journal.reconcile({ ...receipt, invocationHash: 'wrong' })).toThrow('identity');
    expect(() => journal.reconcile({ ...receipt, attempt: 2 })).toThrow('identity');
    journal.reconcile(receipt); journal.reconcile(receipt);
    const reopened = new EffectJournal(file);
    expect(reopened.pending()).toEqual([]);
    expect(() => reopened.begin(call, tool, invocation)).toThrow('already observed');
    expect(() => reopened.reconcile({ ...receipt, evidence: 'different' })).toThrow('conflict');
    reopened.begin({ ...call, toolCallId: 'next' }, tool, invocation);
    expect(reopened.pending().map(entry => entry.key)).toEqual(['next']);
  });
  it('fails closed for orphan outcomes, reordered records and semantic corruption without repairing them', () => {
    const journal = new EffectJournal(file); journal.begin(call, tool, invocation); journal.finish(call, { content: 'ok', meta: {} });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    for (const content of [lines.reverse().join('\n') + '\n', '{"kind":"unknown","key":"call","attempt":1}\n']) {
      fs.writeFileSync(file, content);
      expect(() => new EffectJournal(file)).toThrow(); expect(fs.readFileSync(file, 'utf8')).toBe(content);
    }
  });
  it('repairs a torn tail while preserving durable intents and replay protection', () => {
    new EffectJournal(file).begin(call, tool, { ...invocation, argumentsCanonicalHash: '多字节' });
    const prefix = fs.readFileSync(file);
    fs.appendFileSync(file, '{"kind":"intent","key":"call-partial');
    const recovered = new EffectJournal(file);
    expect(recovered.pending()).toMatchObject([{ key: 'call', effects: 'non_idempotent' }]);
    expect(fs.readFileSync(file)).toEqual(prefix);
    expect(() => recovered.begin(call, tool, { ...invocation, argumentsCanonicalHash: '多字节' })).toThrow('OUTCOME_UNKNOWN');
    recovered.finish(call, { content: 'reconciled', meta: {} });
    recovered.begin({ ...call, toolCallId: 'next' }, tool, invocation);
    expect(new EffectJournal(file).pending()).toMatchObject([{ key: 'next' }]);
    expect(fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))).toHaveLength(3);
  });
  it('recovers an entirely torn file and separates valid unterminated entries before appending', () => {
    fs.writeFileSync(file, '{"kind":"intent","key":"call-partial');
    const recovered = new EffectJournal(file);
    expect(recovered.pending()).toEqual([]);
    recovered.begin(call, tool, invocation);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').trimEnd());
    new EffectJournal(file).finish(call, { content: 'done', meta: {} });
    expect(new EffectJournal(file).pending()).toEqual([]);
    expect(() => new EffectJournal(file).begin(call, tool, invocation)).toThrow('already observed');
  });
  it('does not discard corruption in completed lines or valid records after it', () => {
    new EffectJournal(file).begin(call, tool, invocation);
    const valid = fs.readFileSync(file, 'utf8');
    for (const contents of [valid + '{broken}\n', '{broken}\n' + valid]) {
      fs.writeFileSync(file, contents);
      expect(() => new EffectJournal(file)).toThrow(SyntaxError);
      expect(fs.readFileSync(file, 'utf8')).toBe(contents);
    }
  });
  it('crash before intent is retryable; intent before dispatch and effect before outcome pause writes', () => {
    const journal = new EffectJournal(file);
    expect(journal.pending()).toEqual([]);
    journal.begin(call, tool, invocation);
    const recovered = new EffectJournal(file);
    expect(recovered.pending()).toHaveLength(1);
    expect(() => recovered.begin(call, tool, invocation)).toThrow('OUTCOME_UNKNOWN');
    expect(() => recovered.begin({ ...call, toolCallId: 'fresh-model-call' }, tool, invocation)).toThrow('OUTCOME_UNKNOWN');
  });
  it('observed outcomes before projection never execute twice', () => {
    const journal = new EffectJournal(file); journal.begin(call, tool, invocation);
    journal.finish(call, { content: 'done', meta: {} });
    expect(new EffectJournal(file).pending()).toEqual([]);
    expect(() => new EffectJournal(file).begin(call, tool, invocation)).toThrow('already observed');
    const newStep = new EffectJournal(file);
    newStep.begin(call, tool, invocation, 'next-persisted-step');
    newStep.finish(call, { content: 'next result', meta: {} }, 'next-persisted-step');
  });
  it('failed/unknown effects remain unresolved; read recovery records a new attempt', () => {
    const journal = new EffectJournal(file); journal.begin(call, tool, invocation);
    journal.finish(call, { content: '', error: { errorClass: 'TOOL_FAILURE', message: 'lost response' }, meta: {} });
    expect(() => new EffectJournal(file).begin(call, tool, invocation)).toThrow('OUTCOME_UNKNOWN');
    const read = { ...tool, effects: 'read_only' as const }; const readCall = { ...call, toolCallId: 'read' };
    journal.begin(readCall, read, invocation);
    new EffectJournal(file).begin(readCall, read, invocation);
    expect(fs.readFileSync(file, 'utf8')).toContain('"attempt":2');
    expect(() => new EffectJournal(file).begin(readCall, read, { ...invocation, argumentsCanonicalHash: 'changed' })).toThrow('identity changed');
  });
});
