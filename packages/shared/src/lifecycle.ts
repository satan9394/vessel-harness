export type ExecutionState = 'CREATED' | 'PREPARING' | 'RUNNING' | 'WAITING_APPROVAL' | 'SUSPENDED' | 'FINALIZING' | 'COMPLETED' | 'DENIED' | 'FAILED' | 'CANCELLED' | 'EXHAUSTED';
export interface ExecutionBudget {
  maxModelSteps: number;
  maxToolCalls: number;
  maxElapsedMs: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCost?: number;
  maxConsecutiveErrors: number;
}
export interface ExecutionCounters { modelSteps: number; toolCalls: number; inputTokens: number; outputTokens: number; estimatedCost: number; consecutiveErrors: number }
