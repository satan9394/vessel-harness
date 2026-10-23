import type { SessionRecord } from '@vessel/shared';

export interface RunObservation {
  lastRunStatus: 'queued' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'unknown';
  runId?: string;
  observedAt?: number;
  revision: number;
  recordCount: number;
  reasonCode: string;
  errorDetail?: string;
}

/** Read-side evidence only: never completes or repairs an unfinished execution. */
export function observeRunRecord(previous: RunObservation, record: SessionRecord): RunObservation {
  const observation = { ...previous, revision: Math.max(previous.revision, record.seq), recordCount: previous.recordCount + 1 };
  if (record.type !== 'turn/start' && record.type !== 'turn/end') return observation;
  const observedAt = Date.parse(record.ts);
  if (record.type === 'turn/start') return { ...observation, runId: record.turnId, lastRunStatus: 'unknown',
    observedAt: Number.isFinite(observedAt) ? observedAt : undefined, errorDetail: undefined, reasonCode: 'terminal_missing' };
  if (previous.runId && previous.runId !== record.turnId && ['terminal_missing', 'terminal_run_mismatch'].includes(previous.reasonCode)) {
    return { ...observation, lastRunStatus: 'unknown', reasonCode: 'terminal_run_mismatch' };
  }
  const kind = record.kind as string;
  const lastRunStatus = kind === 'success' ? 'completed' : kind === 'error' || kind === 'failure' || kind === 'budget' ? 'failed'
    : kind === 'interrupted' || kind === 'cancelled' ? kind : 'unknown';
  return { ...observation, runId: record.turnId, lastRunStatus, observedAt: Number.isFinite(observedAt) ? observedAt : undefined,
    errorDetail: typeof record.errorDetail === 'string' ? record.errorDetail : undefined,
    reasonCode: lastRunStatus === 'unknown' ? 'terminal_kind_unknown' : `turn_${kind}` };
}

export function emptyRunObservation(): RunObservation {
  return { lastRunStatus: 'queued', revision: 0, recordCount: 0, reasonCode: 'no_turn' };
}

export function observeRun(records: Iterable<SessionRecord>): RunObservation {
  let observation = emptyRunObservation();
  for (const record of records) observation = observeRunRecord(observation, record);
  return observation;
}
