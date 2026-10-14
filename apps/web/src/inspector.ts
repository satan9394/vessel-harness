/** Metadata only: prompt content never enters the Inspector stream. */
import type { InspectorObservation } from '@vessel/shared';
export type { InspectorObservation } from '@vessel/shared';
export function isInspectorObservation(value: unknown): value is InspectorObservation {
  if (!value || typeof value !== 'object') return false;
  const v = value as InspectorObservation;
  const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const hash = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);
  const layers = v.cacheLayers;
  const validLayers = layers === undefined || (Array.isArray(layers) && layers.length <= 4 && new Set(layers.map(layer => layer?.layer)).size === layers.length && layers.every(layer =>
    layer && ['assembly', 'provider-prefix', 'projection', 'token-estimation'].includes(layer.layer) && hash(layer.dependencyHash) &&
    count(layer.hits) && count(layer.misses) && count(layer.invalidations) && count(layer.entries)));
  return count(v.observedAt) && Boolean(v.prefix || v.workspace || layers?.length) && validLayers && (v.projectionRevision === undefined || count(v.projectionRevision)) &&
    (v.prefix === undefined || (v.prefix !== null && typeof v.prefix === 'object' && count(v.prefix.stableBytes) && count(v.prefix.scopedBytes) && count(v.prefix.volatileBytes) && hash(v.prefix.sha256))) &&
    (v.workspace === undefined || (v.workspace !== null && typeof v.workspace === 'object' && hash(v.workspace.trackedFilesHash) && count(v.workspace.fileCount) && count(v.workspace.uncommittedDiffBytes) && count(v.workspace.timestamp)));
}
