import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalToolInvocation, ToolSpec } from '@vessel/shared';
import { EffectJournal } from './EffectJournal.js';

describe('durable execution recovery boundaries', () => {
  let root: string; let file: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-effects-')); file = path.join(root, 'execution.jsonl'); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const call = { toolCallId: 'call', toolName: 'Write', arguments: {} };
  const invocation: CanonicalToolInvocation = { canonicalToolId: 'builtin:Write', subject: { sessionId: 's', runId: 'r', agentInstanceId: 'a' }, argumentsCanonicalHash: 'hash', requestedScopes: [] };
  const tool = { name: 'Write', requiredPermission: 'workspace-write', effects: 'non_idempotent' } as ToolSpec;
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
