import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '@vessel/core';
import type { CanonicalToolInvocation, ToolSpec } from '@vessel/shared';
import { EffectJournal } from '@vessel/runtime';
import { listSessionEffects, resolveSessionEffect } from './effectsRecovery.js';

/**
 * Card 279: the operator could only clear an unknown effect through HTTP, so a CLI-only user had no
 * way out. These cases pin the two paths that matter — listing pending intents across sessions and
 * resolving one durably, including the audit record the in-process path also writes.
 */
describe('operator recovery of unknown effects from the CLI', () => {
  let ws: string;
  beforeEach(() => { ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-effects-cli-')); });
  afterEach(() => { fs.rmSync(ws, { recursive: true, force: true }); });

  const call = { toolCallId: 'call-1', toolName: 'Write', arguments: { path: 'a.txt' } };
  const tool = { name: 'Write', requiredPermission: 'workspace-write', effects: 'non_idempotent' } as ToolSpec;
  const invocation: CanonicalToolInvocation = {
    canonicalToolId: 'builtin:Write', subject: { sessionId: 's', runId: 'r', agentInstanceId: 'a' },
    argumentsCanonicalHash: 'hash', requestedScopes: [],
  };

  /** Leave an intent with no outcome behind — what a crash between dispatch and result looks like. */
  async function crashedSession(id = 'sess_crashed'): Promise<string> {
    const session = await Session.open({ workspaceRoot: ws, sessionId: id });
    new EffectJournal(path.join(session.dir, 'execution.jsonl')).begin(call, tool, invocation);
    await session.close();
    return id;
  }

  it('lists only sessions that actually have pending effects', async () => {
    await crashedSession();
    const clean = await Session.open({ workspaceRoot: ws, sessionId: 'sess_clean' });
    await clean.close();
    const listed = listSessionEffects(ws);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ sessionId: 'sess_crashed', pending: [{ key: 'call-1', attempt: 1, effects: 'non_idempotent', tool: 'builtin:Write' }] });
    expect(listSessionEffects(ws, 'sess_clean')).toEqual([]);
    expect(fs.existsSync(path.join(ws, '.harness', 'sessions', 'sess_clean', 'execution.jsonl'))).toBe(false);
  });

  it('resolves a pending effect, records the receipt and leaves the journal settled', async () => {
    const id = await crashedSession();
    const result = await resolveSessionEffect(ws, { sessionId: id, key: 'call-1', attempt: 1, resolution: 'not_applied', evidence: 'inspected the fixture: file absent' });
    expect(result.resolved.invocationHash).toBeDefined();
    expect(result.pending).toEqual([]);
    expect(listSessionEffects(ws)).toEqual([]);

    const records = fs.readFileSync(path.join(ws, '.harness', 'sessions', id, 'session.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    expect(records.filter(record => record.type === 'audit/effect_reconciled')).toMatchObject([
      { key: 'call-1', attempt: 1, resolution: 'not_applied', surface: false },
    ]);

    // The barrier is released, and the old invocation still cannot be replayed.
    const reopened = new EffectJournal(path.join(ws, '.harness', 'sessions', id, 'execution.jsonl'));
    expect(reopened.pending()).toEqual([]);
    expect(() => reopened.begin(call, tool, invocation)).toThrow('already observed');
    await expect(resolveSessionEffect(ws, { sessionId: id, key: 'call-1', attempt: 1, resolution: 'applied', evidence: 'again' })).rejects.toThrow('no pending effect');
  });

  it('refuses an unknown session id without creating a phantom session directory', async () => {
    await expect(resolveSessionEffect(ws, { sessionId: 'sess_typo', key: 'call-1', attempt: 1, resolution: 'applied', evidence: 'x' }))
      .rejects.toThrow('no pending effect');
    expect(fs.existsSync(path.join(ws, '.harness', 'sessions', 'sess_typo'))).toBe(false);
  });

  it('refuses to touch a session another process still owns', async () => {
    const id = await crashedSession();
    const owner = await Session.open({ workspaceRoot: ws, sessionId: id });
    try {
      await expect(resolveSessionEffect(ws, { sessionId: id, key: 'call-1', attempt: 1, resolution: 'applied', evidence: 'x' }))
        .rejects.toThrow(/already open|lease/i);
    } finally { await owner.close(); }
  });
});
