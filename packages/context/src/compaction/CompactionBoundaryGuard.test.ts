import { describe, expect, it, vi } from 'vitest';
import { CompactionBoundaryGuard } from './CompactionBoundaryGuard.js';
import { createOverflowRecovery } from './overflowRecovery.js';
import type { Session, EventBus } from '@vessel/core';
import type { Compaction } from './Compaction.js';
import type { ContextBuilder } from '../builder/Builder.js';
import type { SessionRecord } from '@vessel/shared';

describe('compaction boundary', () => {
  it.each([0, 1, 2, -1])('only permits the user-intent boundary %i', turnIndex => {
    expect(CompactionBoundaryGuard.canTriggerCompaction({ turnIndex, hasPendingToolCalls: false, activeMicroTurn: false })).toBe(turnIndex === 0);
  });
  it('refuses active microturns and unresolved assistant tool calls', () => {
    expect(CompactionBoundaryGuard.canTriggerCompaction({ turnIndex: 0, hasPendingToolCalls: false, activeMicroTurn: true })).toBe(false);
    const attempt = { type: 'assistant/attempt', toolCalls: [{ toolCallId: 't' }] } as SessionRecord;
    expect(CompactionBoundaryGuard.canCompactHistory(0, [attempt])).toBe(false);
    expect(CompactionBoundaryGuard.canCompactHistory(0, [attempt, { type: 'tool/result', toolCallId: 't' } as SessionRecord])).toBe(true);
  });
  it('overflow recovery leaves history and events untouched inside a microturn', async () => {
    const compact = vi.fn(); const appendSync = vi.fn(); const emit = vi.fn();
    const recovery = createOverflowRecovery({ session: { replay: () => [], appendSync } as unknown as Session,
      bus: { emit } as unknown as EventBus, builder: {} as ContextBuilder, compaction: { compact } as unknown as Compaction, maxOutputTokens: 4096 });
    expect(await recovery.recover(new Error('maximum context length exceeded'), { step: 2, requestId: 'r', retryCount: 1 })).toBeNull();
    expect(compact).not.toHaveBeenCalled(); expect(appendSync).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled();
  });
  it('abandons only durably ended batches and still blocks unfinished current turns', () => {
    const attempt = { type: 'assistant/attempt', toolCalls: [{ toolCallId: 'a' }, { toolCallId: 'b' }] } as SessionRecord;
    const result = { type: 'tool/result', toolCallId: 'a' } as SessionRecord;
    const ended = { type: 'turn/end', turnId: 'old', kind: 'interrupted' } as SessionRecord;
    const start = { type: 'turn/start', turnId: 'new' } as SessionRecord;
    expect(CompactionBoundaryGuard.canCompactHistory(0, [attempt, result, start])).toBe(false);
    expect(CompactionBoundaryGuard.canCompactHistory(0, [attempt, result, ended, start])).toBe(true);
    expect([...CompactionBoundaryGuard.accountToolCalls([attempt, result, ended]).abandoned.get(attempt)!]).toEqual(['b']);
    const active = { type: 'assistant/attempt', toolCalls: [{ toolCallId: 'current' }] } as SessionRecord;
    expect(CompactionBoundaryGuard.canCompactHistory(0, [attempt, result, ended, start, active])).toBe(false);
    expect(CompactionBoundaryGuard.canCompactHistory(1, [attempt, result, ended, start])).toBe(false);
  });
  it('scopes abandonment to its attempt when a provider reuses IDs in later turns', () => {
    const oldStart = { type: 'turn/start', turnId: 'old' } as SessionRecord;
    const oldAttempt = { type: 'assistant/attempt', toolCalls: [{ toolCallId: 'same' }] } as SessionRecord;
    const oldEnd = { type: 'turn/end', turnId: 'old' } as SessionRecord;
    const nextStart = { type: 'turn/start', turnId: 'next' } as SessionRecord;
    const nextAttempt = { type: 'assistant/attempt', toolCalls: [{ toolCallId: 'same' }] } as SessionRecord;
    const nextResult = { type: 'tool/result', toolCallId: 'same' } as SessionRecord;
    const nextEnd = { type: 'turn/end', turnId: 'next' } as SessionRecord;
    const records = [oldStart, oldAttempt, oldEnd, nextStart, nextAttempt, nextResult, nextEnd];
    const accounting = CompactionBoundaryGuard.accountToolCalls(records);
    expect([...accounting.abandoned.get(oldAttempt)!]).toEqual(['same']);
    expect(accounting.abandoned.has(nextAttempt)).toBe(false);
    expect(accounting.hasPendingToolCalls).toBe(false);
    expect([...accounting.balancedAfter]).toEqual([2, 5, 6]);
    expect(CompactionBoundaryGuard.canCompactHistory(0, records)).toBe(true);
  });
  it('unmatched input-denied ends and newer completed turns cannot close an unfinished turn', () => {
    const start = { type: 'turn/start', turnId: 'unfinished' } as SessionRecord;
    const pending = { type: 'assistant/attempt', toolCalls: [{ toolCallId: 'same' }] } as SessionRecord;
    const denied = { type: 'turn/end', turnId: 'input-denied', kind: 'error' } as SessionRecord;
    const newerStart = { type: 'turn/start', turnId: 'newer' } as SessionRecord;
    const newerAttempt = { type: 'assistant/attempt', toolCalls: [{ toolCallId: 'same' }] } as SessionRecord;
    const result = { type: 'tool/result', toolCallId: 'same' } as SessionRecord;
    const newerEnd = { type: 'turn/end', turnId: 'newer' } as SessionRecord;
    const records = [start, pending, denied, newerStart, newerAttempt, result, newerEnd];
    const accounting = CompactionBoundaryGuard.accountToolCalls(records);
    expect(accounting.hasPendingToolCalls).toBe(true);
    expect(accounting.abandoned.size).toBe(0);
    expect(accounting.balancedAfter.size).toBe(0);
    expect(CompactionBoundaryGuard.canCompactHistory(0, records)).toBe(false);
    const actualEnd = { type: 'turn/end', turnId: 'unfinished' } as SessionRecord;
    expect(CompactionBoundaryGuard.canCompactHistory(0, [...records, actualEnd])).toBe(true);
    expect([...CompactionBoundaryGuard.accountToolCalls([...records, actualEnd]).abandoned.get(pending)!]).toEqual(['same']);
  });
});
