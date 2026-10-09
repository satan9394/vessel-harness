import type { ChatMessage } from '@vessel/shared';

export interface BlastRadius {
  modifiedFiles: string[];
  directDependencies: string[];
  unrelatedFiles: string[];
}
export interface ContextPruneOptions {
  tokenThreshold: number;
  targetTokenBudget: number;
  preserveRecentTurns: number;
  /** Session-record errors remain protected independent of their rendered text. */
  protectedToolCallIds?: readonly string[];
}
export interface PrunedContextResult {
  prunedTokenCount: number;
  originalTokenCount: number;
  blastRadius: BlastRadius;
  prunedTurnsSummary: Array<{ turnIndex: number; action: 'skeletonized' | 'summarized' | 'retained' }>;
}
export interface IAdaptiveContextPruner {
  computeBlastRadius(modifiedFiles: string[]): Promise<BlastRadius>;
  prune(messages: ChatMessage[], options: ContextPruneOptions): Promise<{ messages: ChatMessage[]; result: PrunedContextResult }>;
}
