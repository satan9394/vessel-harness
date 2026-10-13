import type { ChatMessage, ChatToolDef } from './provider.js';
import type { SessionRecord } from './events.js';

const uncertainPublications = new WeakSet<SessionRecord>();

/** A failed persistence barrier cannot establish an in-memory publication. Reopen from disk. */
export function markProjectionPublicationUncertain(event: SessionRecord): void {
  uncertainPublications.add(event);
}

/** Derived view. The event log is never rewritten when this revision changes. */
export interface SessionProjection {
  readonly sessionId: string;
  readonly revision: number;
  readonly lastEventId: string;
  readonly lastEventSequence: number;
  readonly visibleMessages: readonly SessionRecord[];
  readonly compactedRanges: readonly { startSeq: number; endSeq: number; summary: string }[];
  readonly tokenEstimate: number;
  readonly updatedAt: string;
}

export interface RequestEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly projectionRevision: number;
  readonly basedOnEventSequence: number;
  readonly requestHash: string;
  readonly dependencyHash: string;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ChatToolDef[];
  readonly estimateTokens: number;
}

export type RequestEnvelope = RequestEnvelopeV1;

export interface CompactionConservationCheckInput {
  readonly originalMessages: readonly ConservationMessage[];
  readonly compactedMessages: readonly ConservationMessage[];
  readonly preservedGoalPrefix?: string;
  readonly requiredDenialEventIds?: readonly string[];
}

export interface ConservationMessage {
  role: string;
  content: unknown;
  toolCalls?: readonly { id: string }[];
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

/** A committed event is the atomic publication; replay needs no mutable sidecar. */
export function projectSession(sessionId: string, events: readonly SessionRecord[]): SessionProjection {
  if (events.some(event => uncertainPublications.has(event))) throw new Error('Projection publication outcome unknown; reopen session before continuing');
  let records = [...events];
  let revision = 0;
  const compactedRanges: { startSeq: number; endSeq: number; summary: string }[] = [];
  for (const event of events) {
    if (event.type !== 'compaction/end' || event.outcome !== 'committed') continue;
    const commit = event.projectionCommit as { expectedRevision: number; startSeq: number; endSeq: number; summary: string } | undefined;
    if (!commit || commit.expectedRevision !== revision || !Number.isInteger(commit.startSeq) || !Number.isInteger(commit.endSeq)
      || commit.startSeq > commit.endSeq || commit.endSeq >= event.seq || typeof commit.summary !== 'string') {
      throw new Error('Invalid compaction projection commit');
    }
    const summary: SessionRecord = { type: 'user/message', msgId: `projection_${event.seq}`, role: 'user',
      content: `<compacted-summary>\n${commit.summary}\n</compacted-summary>`, source: 'compacted-summary', surface: true,
      seq: commit.startSeq, ts: event.ts };
    const start = records.findIndex(record => record.seq >= commit.startSeq);
    records = records.filter(record => record.seq < commit.startSeq || record.seq > commit.endSeq);
    records.splice(start, 0, summary);
    compactedRanges.push({ startSeq: commit.startSeq, endSeq: commit.endSeq, summary: commit.summary });
    revision++;
  }
  const tail = events.at(-1);
  return { sessionId, revision, lastEventId: tail ? `${sessionId}:${tail.seq}` : '', lastEventSequence: tail?.seq ?? 0,
    visibleMessages: records, compactedRanges, tokenEstimate: Math.ceil(JSON.stringify(records).length / 4), updatedAt: tail?.ts ?? '' };
}
