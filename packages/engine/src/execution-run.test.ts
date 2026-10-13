import { expect, it } from 'vitest';
import { ExecutionRun } from './execution-run.js';
const budget = { maxModelSteps: 2, maxToolCalls: 2, maxElapsedMs: 60_000, maxConsecutiveErrors: 1 };
it('rejects stale writers and terminal revival', () => {
  const run = new ExecutionRun(budget); run.transition('PREPARING');
  expect(() => run.transition('RUNNING', 0)).toThrow('Invalid execution transition');
  run.transition('RUNNING'); run.transition('CANCELLED');
  expect(() => run.transition('RUNNING')).toThrow('Invalid execution transition');
});
it('restores counters instead of resetting a retry budget', () => {
  const run = new ExecutionRun(budget, Date.now(), { modelSteps: 2, toolCalls: 0, inputTokens: 1, outputTokens: 1, estimatedCost: 0, consecutiveErrors: 0 });
  expect(() => run.model()).toThrow('maxModelSteps');
});
it('rejects invalid budget inputs', () => {
  expect(() => new ExecutionRun({ ...budget, maxModelSteps: NaN })).toThrow('Invalid execution budget');
});
