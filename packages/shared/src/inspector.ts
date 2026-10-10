import type { WorkspaceStateFingerprint } from './noProgress.js';

/** Surface telemetry contains measurements, never raw prompt contents. */
export interface InspectorObservation {
  observedAt: number;
  prefix?: { stableBytes: number; scopedBytes: number; volatileBytes: number; sha256: string };
  workspace?: WorkspaceStateFingerprint;
}
