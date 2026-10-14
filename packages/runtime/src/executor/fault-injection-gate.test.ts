import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalToolInvocation, ToolCall, ToolExecutionResult, ToolSpec } from '@vessel/shared';
import { EffectJournal } from './EffectJournal.js';

/**
 * ARC-11 §11.1.3 — Crash / Fault Injection gates.
 *
 * A durable side-effect counter file stands in for an *irreversible* external
 * effect (the file system / an outbound call). Across a simulated process
 * restart the journal must:
 *   - surface every boundary that has an *unknown* outcome, and
 *   - refuse to replay a non-idempotent call, so the counter can never advance
 *     twice for the same invocation.
 */

const call: ToolCall = { toolCallId: 'call-1', toolName: 'Write', arguments: { path: 'out.txt' } };
const invocation: CanonicalToolInvocation = {
  canonicalToolId: 'builtin:Write',
  subject: { sessionId: 's', runId: 'r', agentInstanceId: 'agent-1' },
  argumentsCanonicalHash: 'hash-v1',
  requestedScopes: ['workspace-write'],
};
const writeTool = { name: 'Write', requiredPermission: 'workspace-write', effects: 'non_idempotent' } as ToolSpec;
const observedResult: ToolExecutionResult = { content: 'wrote 1 line', meta: { bytes: 12 } };

describe('ARC-11 fault injection — no duplicate execution of non-idempotent tools', () => {
  let root: string; let journalFile: string; let effectFile: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-fault-'));
    journalFile = path.join(root, 'execution.jsonl');
    effectFile = path.join(root, 'effect-count');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** The irreversible side effect: every real run appends to the durable counter. */
  const runEffect = (): ToolExecutionResult => {
    const current = fs.existsSync(effectFile) ? Number(fs.readFileSync(effectFile, 'utf8')) : 0;
    fs.writeFileSync(effectFile, String(current + 1));
    return observedResult;
  };
  const effectCount = (): number => fs.existsSync(effectFile) ? Number(fs.readFileSync(effectFile, 'utf8')) : 0;

  /**
   * Mirror the runtime dispatch contract: `begin` (intent) → run → `finish`
   * (outcome). A crash is modelled by performing a subset of those steps.
   */
  const dispatchOnce = (journal: EffectJournal, tool: ToolSpec = writeTool, inv: CanonicalToolInvocation = invocation): 'completed' => {
    journal.begin(call, tool, inv);
    const result = runEffect();
    journal.finish(call, result);
    return 'completed';
  };

  it('boundary 1 — crash after pre-dispatch intent: recovery pauses, never re-executes', () => {
    const journal = new EffectJournal(journalFile);
    journal.begin(call, writeTool, invocation); // intent written, effect not yet run
    expect(effectCount()).toBe(0);

    const recovered = new EffectJournal(journalFile);
    expect(recovered.pending()).toHaveLength(1);
    expect(() => dispatchOnce(recovered)).toThrow('OUTCOME_UNKNOWN');
    expect(effectCount()).toBe(0); // the blind retry never reached the side effect
  });

  it('boundary 2 — crash after dispatch, before tool result: unknown outcome blocks replay', () => {
    const journal = new EffectJournal(journalFile);
    journal.begin(call, writeTool, invocation);
    runEffect(); // the irreversible effect happened
    expect(effectCount()).toBe(1); // then the process crashed before finish()

    const recovered = new EffectJournal(journalFile);
    expect(recovered.pending()).toHaveLength(1);
    expect(() => dispatchOnce(recovered)).toThrow('OUTCOME_UNKNOWN');
    expect(effectCount()).toBe(1); // never executed twice
  });

  it('boundary 3 — crash after the tool result is recorded: replay is prohibited outright', () => {
    const journal = new EffectJournal(journalFile);
    expect(dispatchOnce(journal)).toBe('completed');
    expect(effectCount()).toBe(1);

    const recovered = new EffectJournal(journalFile);
    expect(recovered.pending()).toEqual([]);
    expect(() => dispatchOnce(recovered)).toThrow('already observed');
    expect(effectCount()).toBe(1);
  });

  it('boundary 3b — an errored non-idempotent effect stays unresolved (outcome_unknown)', () => {
    const journal = new EffectJournal(journalFile);
    journal.begin(call, writeTool, invocation);
    journal.finish(call, { content: '', error: { errorClass: 'TOOL_FAILURE', message: 'lost response' }, meta: {} });
    const recovered = new EffectJournal(journalFile);
    expect(recovered.pending()).toHaveLength(1);
    expect(() => dispatchOnce(recovered)).toThrow('OUTCOME_UNKNOWN');
  });

  it('boundary 4 — approval transition binds the exact operation hash (no widen, no replay)', () => {
    const journal = new EffectJournal(journalFile);
    journal.begin(call, writeTool, invocation); // intent recorded at the approval boundary

    const recovered = new EffectJournal(journalFile);
    // A renewed approval must re-evaluate against the same canonical arguments.
    expect(() => recovered.begin(call, writeTool, { ...invocation, argumentsCanonicalHash: 'tampered-hash' })).toThrow('identity changed');
    // The original approval still cannot blind-dispatch an unknown effect.
    expect(() => dispatchOnce(recovered)).toThrow('OUTCOME_UNKNOWN');
    expect(effectCount()).toBe(0);
  });

  it('a pending non-idempotent effect blocks any further write until reconciled', () => {
    const journal = new EffectJournal(journalFile);
    journal.begin(call, writeTool, invocation);
    expect(() => journal.begin({ ...call, toolCallId: 'other-write' }, writeTool, invocation)).toThrow('reconciliation');
  });

  it('read-only work is recoverable without reconciliation (safe to regenerate)', () => {
    const readTool = { ...writeTool, effects: 'read_only' as const } as ToolSpec;
    const readCall = { ...call, toolCallId: 'read-1' };
    const journal = new EffectJournal(journalFile);
    journal.begin(readCall, readTool, invocation);
    const recovered = new EffectJournal(journalFile);
    expect(() => recovered.begin(readCall, readTool, invocation)).not.toThrow();
    expect(fs.readFileSync(journalFile, 'utf8')).toContain('"attempt":2');
  });
});
