import type { TeamDagTask, TeamTaskResult } from '../dag/types.js';
import type { ResolvedTeamMember } from '../types.js';

export interface MeshNodeDescriptor {
  nodeId: string;
  endpoint: string;
  token: string;
  roleCapabilities: string[];
  status: 'online' | 'busy' | 'offline';
  latencyMs: number;
}
export interface RemoteSubDagTask {
  dagId: string;
  subGraphNodes: string[];
  contextSnapshotRef: string;
}
export interface MeshEventBus {
  registerPeer(node: MeshNodeDescriptor): Promise<void>;
  dispatchSubDag(targetNodeId: string, task: RemoteSubDagTask): Promise<void>;
  subscribePeerEvents(targetNodeId: string, onEvent: (event: any) => void): () => void;
}
export interface MeshArtifactDiff { path: string; diff: string }
export interface MeshTaskResult extends TeamTaskResult { artifactDiffs?: MeshArtifactDiff[] }
export interface MeshEvent {
  nodeId: string;
  seq: number;
  dagId: string;
  tasks: TeamDagTask[];
  artifactDiffs: MeshArtifactDiff[];
}
export interface MeshExecution {
  roster: ResolvedTeamMember[];
  /** Locally composed executor owns workspace/policy; snapshot is data, never a filesystem path. */
  execute(task: TeamDagTask, context: unknown, signal: AbortSignal, dependencies: TeamDagTask[]): Promise<MeshTaskResult>;
}
