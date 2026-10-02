import type { ResolvedTeamMember } from '../types.js';
import type { TeamReviewConclusion } from '@vessel/shared';

export type TeamTaskStatus = 'pending' | 'ready' | 'claimed' | 'running' | 'completed' | 'failed';
export interface TeamDagTask {
  id: string;
  title: string;
  description: string;
  assignedRole: 'generator' | 'evaluator';
  dependencies: string[];
  status: TeamTaskStatus;
  claimedBy?: string;
  result?: TeamTaskResult;
  error?: string;
}
export interface TeamTaskResult { output: string; artifacts: string[]; review?: TeamReviewConclusion }
export interface TeamPlanStage {
  id: string;
  roster: ResolvedTeamMember[];
  tasks: TeamDagTask[];
  status: 'staged' | 'approved' | 'rejected' | 'running' | 'finished';
  createdAt: number;
  approvedAt?: number;
}
