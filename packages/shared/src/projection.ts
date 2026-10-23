import type { ChatMessage, ChatToolDef } from './provider.js';
import type { SessionRecord } from './events.js';
import { canonicalArgumentsHash } from './execution.js';

const uncertainPublications = new WeakSet<SessionRecord>();
// Replay repeats validation of old commits. Compare source bytes on every read so
// mutable records cannot bypass verification, but canonicalize unchanged evidence once.
const evidenceSnapshots = new WeakMap<SessionRecord, { seq: number; json: string }>();
const sourceHashes = new WeakMap<SessionRecord, { sources: readonly { seq: number; json: string }[]; hash: string }>();

/** A failed persistence barrier cannot establish an in-memory publication. Reopen from disk. */
export function markProjectionPublicationUncertain(event: SessionRecord): void {
  uncertainPublications.add(event);
}

/** Identity-bound uncertainty must be checked even when a derived projection is cached. */
export function assertProjectionPublicationKnown(events: readonly SessionRecord[]): void {
  if (events.some(event => uncertainPublications.has(event))) throw new Error('Projection publication outcome unknown; reopen session before continuing');
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
  readonly requiredToolPairs?: readonly { toolCallId: string; callText: string; resultText: string }[];
  readonly latestInstruction?: string;
  readonly requiredKeepIds?: readonly string[];
}

export interface ConservationMessage {
  id?: string;
  role: string;
  content: unknown;
  toolCalls?: readonly { id: string }[];
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

/** A committed event is the atomic publication; replay needs no mutable sidecar. */
export function projectSession(sessionId: string, events: readonly SessionRecord[]): SessionProjection {
  assertProjectionPublicationKnown(events);
  let records = [...events];
  let revision = 0;
  const compactedRanges: { startSeq: number; endSeq: number; summary: string }[] = [];
  let evidenceRecords: { seq: number; json: string }[] | undefined;
  for (const event of events) {
    if (event.type !== 'compaction/end' || event.outcome !== 'committed') continue;
    const commit = event.projectionCommit as { expectedRevision: number; startSeq: number; endSeq: number; summary: string; metadata?: Record<string, unknown> } | undefined;
    if (commit?.metadata?.summaryHash) {
      const provenance = commit.metadata.provenance as { sourceStart: number; sourceEnd: number; sourceHash: string } | undefined;
      if (!provenance || commit.metadata.summaryHash !== canonicalArgumentsHash({ summary: commit.summary, provenance })) throw new Error('Compaction evidence hash mismatch');
      evidenceRecords ??= events.filter(record => record.type !== 'compaction/start' && record.type !== 'compaction/end')
        .map(record => {
          const json = JSON.stringify(record);
          let snapshot = evidenceSnapshots.get(record);
          if (snapshot?.json !== json) {
            snapshot = { seq: record.seq, json };
            evidenceSnapshots.set(record, snapshot);
          }
          return snapshot;
        });
      const sources = evidenceRecords.filter(record => record.seq >= provenance.sourceStart && record.seq <= provenance.sourceEnd);
      let source = sourceHashes.get(event);
      if (!source || source.sources.length !== sources.length || sources.some((record, index) => record !== source!.sources[index])) {
        source = { sources, hash: canonicalArgumentsHash(sources.map(record => JSON.parse(record.json))) };
        sourceHashes.set(event, source);
      }
      if (provenance.sourceHash !== source.hash) throw new Error('Compaction evidence hash mismatch');
    }
    if (!commit || commit.expectedRevision !== revision || !Number.isInteger(commit.startSeq) || !Number.isInteger(commit.endSeq)
      || commit.startSeq > commit.endSeq || commit.endSeq >= event.seq || typeof commit.summary !== 'string') {
      throw new Error('Invalid compaction projection commit');
    }
    const summary: SessionRecord = { type: 'user/message', msgId: `projection_${event.seq}`, role: 'user',
      content: `<compacted-summary>\n${commit.summary}\n</compacted-summary>`, source: 'compacted-summary', surface: true,
      seq: commit.startSeq, ts: event.ts, metadata: commit.metadata };
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
