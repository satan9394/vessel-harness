import type { ExecutionState, ExecutionBudget, ExecutionCounters } from '@vessel/shared';
export type { ExecutionState, ExecutionBudget, ExecutionCounters } from '@vessel/shared';
export const TERMINAL_EXECUTION_STATES = new Set<ExecutionState>(['COMPLETED', 'DENIED', 'FAILED', 'CANCELLED', 'EXHAUSTED']);
const transitions: Partial<Record<ExecutionState, ExecutionState[]>> = {
  CREATED: ['PREPARING'], PREPARING: ['RUNNING', 'DENIED', 'FAILED', 'CANCELLED'],
  RUNNING: ['WAITING_APPROVAL', 'SUSPENDED', 'FINALIZING', 'DENIED', 'FAILED', 'CANCELLED', 'EXHAUSTED'],
  WAITING_APPROVAL: ['RUNNING', 'DENIED', 'CANCELLED', 'EXHAUSTED'],
  SUSPENDED: ['RUNNING', 'CANCELLED', 'EXHAUSTED'], FINALIZING: ['COMPLETED', 'DENIED', 'FAILED', 'CANCELLED', 'EXHAUSTED'],
};
export class ExecutionBudgetError extends Error {
  constructor(readonly outcomeReason: string) { super(`Execution budget exhausted: ${outcomeReason}`); }
}
/** Single-owner state with CAS revisions; persisted counters can be restored without resetting caps. */
export class ExecutionRun {
  state: ExecutionState = 'CREATED';
  revision = 0;
  readonly counters: ExecutionCounters;
  constructor(readonly budget: ExecutionBudget, readonly startedAt = Date.now(), counters?: ExecutionCounters) {
    for (const [name, value] of Object.entries(budget)) {
      if (!Number.isFinite(value) || value < 0 || (name !== 'maxEstimatedCost' && !Number.isInteger(value))) throw new Error(`Invalid execution budget: ${name}`);
    }
    this.counters = counters ? { ...counters } : { modelSteps: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0, consecutiveErrors: 0 };
  }
  transition(next: ExecutionState, expectedRevision = this.revision): void {
    if (expectedRevision !== this.revision || !transitions[this.state]?.includes(next)) throw new Error(`Invalid execution transition ${this.state} -> ${next} at revision ${expectedRevision}`);
    this.state = next; this.revision++;
  }
  check(): void {
    if (Date.now() - this.startedAt >= this.budget.maxElapsedMs) throw new ExecutionBudgetError('maxElapsedMs');
    for (const [counter, limit] of [['inputTokens', 'maxInputTokens'], ['outputTokens', 'maxOutputTokens'], ['estimatedCost', 'maxEstimatedCost'], ['consecutiveErrors', 'maxConsecutiveErrors']] as const) {
      const cap = this.budget[limit];
      if (cap !== undefined && (counter === 'consecutiveErrors' ? this.counters[counter] > 0 && this.counters[counter] >= cap : this.counters[counter] > cap)) throw new ExecutionBudgetError(limit);
    }
  }
  model(): void { this.check(); if (this.counters.modelSteps >= this.budget.maxModelSteps) throw new ExecutionBudgetError('maxModelSteps'); this.counters.modelSteps++; }
  tool(): void { this.check(); if (this.counters.toolCalls >= this.budget.maxToolCalls) throw new ExecutionBudgetError('maxToolCalls'); this.counters.toolCalls++; }
}
