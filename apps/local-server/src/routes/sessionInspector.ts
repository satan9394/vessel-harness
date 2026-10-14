import type { ContextCacheLayerSnapshot, InspectorObservation, WorkspaceStateFingerprint } from '@vessel/shared';

export type WorkspaceObserver = (root: string) => Promise<WorkspaceStateFingerprint>;
type Receive = (observation: InspectorObservation) => void;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const layers = ['assembly', 'provider-prefix', 'projection', 'token-estimation'] as const;
function cacheSnapshot(value: unknown): ContextCacheLayerSnapshot[] | undefined {
  if (!Array.isArray(value) || value.length !== layers.length) return;
  const snapshots: ContextCacheLayerSnapshot[] = [];
  for (const layer of layers) {
    const entry = value.find(item => record(item) && item.layer === layer);
    if (!record(entry) || typeof entry.dependencyHash !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.dependencyHash)
      || !['hits', 'misses', 'invalidations', 'entries'].every(key => Number.isSafeInteger(entry[key]) && (entry[key] as number) >= 0)) return;
    snapshots.push({ layer, dependencyHash: entry.dependencyHash, hits: entry.hits as number,
      misses: entry.misses as number, invalidations: entry.invalidations as number, entries: entry.entries as number });
  }
  return snapshots;
}

/** Observe existing composition events without changing the loop or exposing prompts. */
export class SessionInspector {
  private readonly observations = new Map<string, InspectorObservation>();
  private readonly receivers = new Map<string, Set<Receive>>();
  private readonly generations = new Map<string, number>();
  private closed = false;
  constructor(private readonly workspaceObserver?: WorkspaceObserver) {}

  observe(sessionId: string, payload: unknown, root: string): void {
    if (this.closed || !record(payload) || !record(payload.envelope) || !record(payload.envelope.prefixLayout)) return;
    const prefix = payload.envelope.prefixLayout;
    if (typeof prefix.stablePrefix !== 'string' || typeof prefix.scopedPrefix !== 'string' || typeof prefix.volatileSuffix !== 'string'
      || typeof prefix.prefixByteHash !== 'string' || !/^[a-f0-9]{64}$/i.test(prefix.prefixByteHash)) return;
    const generation = (this.generations.get(sessionId) ?? 0) + 1;
    this.generations.set(sessionId, generation);
    const cacheLayers = cacheSnapshot(payload.envelope.cacheLayers);
    const projectionRevision = Number.isSafeInteger(payload.envelope.projectionRevision) && (payload.envelope.projectionRevision as number) >= 0
      ? payload.envelope.projectionRevision as number : undefined;
    this.publish(sessionId, { ...this.observations.get(sessionId), observedAt: Date.now(), cacheLayers, projectionRevision, prefix: {
      stableBytes: Buffer.byteLength(prefix.stablePrefix), scopedBytes: Buffer.byteLength(prefix.scopedPrefix),
      volatileBytes: Buffer.byteLength(prefix.volatileSuffix), sha256: prefix.prefixByteHash,
    } });
    if (this.workspaceObserver) void this.workspaceObserver(root).then(workspace => {
      if (!this.closed && this.generations.get(sessionId) === generation) this.publish(sessionId, {
        ...this.observations.get(sessionId), observedAt: Date.now(), workspace,
      });
    }).catch(() => {
      // ponytail: a failed optional observation is absent, never a fabricated clean workspace.
      if (!this.closed && this.generations.get(sessionId) === generation) {
        const previous = this.observations.get(sessionId);
        if (previous) this.publish(sessionId, { observedAt: Date.now(), prefix: previous.prefix, cacheLayers: previous.cacheLayers, projectionRevision: previous.projectionRevision });
      }
    });
  }

  subscribe(sessionId: string, receive: Receive): () => void {
    let receivers = this.receivers.get(sessionId);
    if (!receivers) { receivers = new Set(); this.receivers.set(sessionId, receivers); }
    receivers.add(receive);
    const observation = this.observations.get(sessionId);
    if (observation) this.send(sessionId, receive, observation);
    return () => {
      receivers.delete(receive);
      if (!receivers.size && this.receivers.get(sessionId) === receivers) this.receivers.delete(sessionId);
    };
  }
  close(): void { this.closed = true; this.observations.clear(); this.receivers.clear(); this.generations.clear(); }
  private publish(sessionId: string, observation: InspectorObservation): void {
    this.observations.set(sessionId, observation);
    for (const receive of this.receivers.get(sessionId) ?? []) this.send(sessionId, receive, observation);
  }
  private send(sessionId: string, receive: Receive, observation: InspectorObservation): void {
    try { receive(structuredClone(observation)); } catch { this.receivers.get(sessionId)?.delete(receive); }
  }
}
