import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '@vessel/shared';
import { observeRun } from './RunObservation.js';

const record = (seq: number, type: string, turnId: string, kind?: string) => ({ seq, ts: '2026-10-23T00:00:00Z', type, turnId, kind }) as SessionRecord;

describe('read-only run evidence', () => {
  it.each([
    ['success', 'completed'], ['error', 'failed'], ['failure', 'failed'], ['budget', 'failed'],
    ['interrupted', 'interrupted'], ['cancelled', 'cancelled'], ['unknown-new-kind', 'unknown'],
  ])('observes terminal %s as %s', (kind, status) => {
    expect(observeRun([record(1, 'turn/start', 'run'), record(2, 'turn/end', 'run', kind)]))
      .toMatchObject({ lastRunStatus: status, runId: 'run', revision: 2, recordCount: 2, observedAt: Date.parse('2026-10-23T00:00:00Z') });
  });

  it('keeps empty sessions queued, unfinished runs unknown and recovered interrupted events authoritative', () => {
    expect(observeRun([])).toMatchObject({ lastRunStatus: 'queued', reasonCode: 'no_turn' });
    const records = [record(1, 'turn/end', 'old', 'success'), record(2, 'turn/start', 'new')];
    expect(observeRun(records)).toMatchObject({ runId: 'new', lastRunStatus: 'unknown', reasonCode: 'terminal_missing' });
    records.push(record(3, 'turn/end', 'old', 'success'));
    expect(observeRun(records)).toMatchObject({ runId: 'new', lastRunStatus: 'unknown', reasonCode: 'terminal_run_mismatch' });
    records.push(record(4, 'turn/end', 'new', 'interrupted'));
    expect(observeRun(records)).toMatchObject({ runId: 'new', lastRunStatus: 'interrupted', reasonCode: 'turn_interrupted' });
    // Compacted/legacy histories may retain an end without its start.
    records.push(record(5, 'turn/end', 'next', 'error'));
    expect(observeRun(records)).toMatchObject({ runId: 'next', lastRunStatus: 'failed' });
  });
});
