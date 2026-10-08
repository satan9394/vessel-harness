import type { ConvergenceCheckResult } from '@vessel/shared';

export class StagnationBreakError extends Error {
  constructor(readonly diagnostic: ConvergenceCheckResult & { stepIndex: number; toolName: string }) {
    super(`stagnation_break: ${diagnostic.reason}`);
    this.name = 'StagnationBreakError';
  }
}
