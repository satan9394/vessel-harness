/**
 * core/state — step/turn ledger + context snapshot (ARCHITECTURE §4.1).
 * Budgets are extension concerns (policy layer), not core logic.
 */
export interface StateSnapshot {
  turnId: string | null;
  steps: number;
  toolCalls: number;
  contextEstimateTokens: number;
  lastStepAt: string | null;
}

export class LoopState {
  private turnId: string | null = null;
  private steps = 0;
  private toolCalls = 0;
  private contextEstimateTokens = 0;
  private lastStepAt: string | null = null;

  beginTurn(turnId: string): void {
    this.turnId = turnId;
    this.steps = 0;
    this.toolCalls = 0;
    this.contextEstimateTokens = 0;
    this.lastStepAt = new Date().toISOString();
  }

  beginStep(): void {
    this.steps += 1;
    this.lastStepAt = new Date().toISOString();
  }

  recordToolCall(): void {
    this.toolCalls += 1;
  }

  setContextEstimate(tokens: number): void {
    this.contextEstimateTokens = tokens;
  }

  snapshot(): StateSnapshot {
    return {
      turnId: this.turnId,
      steps: this.steps,
      toolCalls: this.toolCalls,
      contextEstimateTokens: this.contextEstimateTokens,
      lastStepAt: this.lastStepAt,
    };
  }
}
