import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoopEngine, type LoopEngineDeps, type LoopEngineOptions, type IterationResult } from './LoopEngine.js';
import { ExecutionRun } from './execution-run.js';
import { IterationStore } from './iteration-store.js';

const task = { id: 'budget-task', goal: 'Record completed iterations' };
const met = { verdict: 'met' as const, evidence: ['verified'], reason: 'met' };

describe('LoopEngine iteration budget snapshots', () => {
  let root: string;
  let store: IterationStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-loop-budget-'));
    store = new IterationStore({ iterationsRoot: root, harnessRoot: root });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function execution(maxModelSteps = 10): ExecutionRun {
    return new ExecutionRun({ maxModelSteps, maxToolCalls: 0, maxElapsedMs: 0, maxConsecutiveErrors: 1 });
  }
  function engine(options: LoopEngineOptions = {}, overrides: Partial<LoopEngineDeps> = {}): LoopEngine {
    return new LoopEngine({
      selectTask: async () => task,
      generate: async () => ({ output: 'candidate' }),
      evaluate: async () => met,
      persist: async result => { store.appendEngineResult({ taskId: task.id, goal: task.goal }, result); },
      shouldContinue: async () => true,
      ...overrides,
    }, options);
  }
  function usage(run: ExecutionRun): object {
    const { inputTokens, outputTokens, estimatedCost } = run.counters;
    return { inputTokens, outputTokens, estimatedCost };
  }

  it('records one step per completed iteration and snapshots 1 then 2', async () => {
    const run = execution();
    await engine({ executionRun: run, maxIterations: 2 }).run();
    expect(run.counters.modelSteps).toBe(2);
    expect(store.replay(task.id).map(entry => entry.budgetSnapshot)).toEqual([
      { modelSteps: 1, consecutiveErrors: 0 }, { modelSteps: 2, consecutiveErrors: 0 },
    ]);
    expect(usage(run)).toEqual({ inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
  });

  it('keeps the default single iteration and omits the key without injection', async () => {
    const persisted: IterationResult[] = [];
    await engine({}, { persist: async result => {
      persisted.push(result);
      store.appendEngineResult({ taskId: task.id, goal: task.goal }, result);
    } }).run();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).not.toHaveProperty('budgetSnapshot');
    expect(store.replay(task.id)[0]).not.toHaveProperty('budgetSnapshot');
  });

  it('increments consecutive errors for an error iteration then resets on a normal one', async () => {
    const run = execution();
    const observed: number[] = [];
    const evaluate = vi.fn<LoopEngineDeps['evaluate']>()
      .mockResolvedValueOnce({ verdict: 'error', evidence: ['failure'], reason: 'evaluation failed' })
      .mockResolvedValueOnce(met);
    await engine({ executionRun: run, maxIterations: 2, maxRetries: 0 }, {
      evaluate,
      shouldContinue: async () => { observed.push(run.counters.consecutiveErrors); return true; },
    }).run();
    expect(observed).toEqual([1, 0]);
    expect(store.replay(task.id).map(entry => entry.budgetSnapshot)).toEqual([
      { modelSteps: 1, consecutiveErrors: 1 }, { modelSteps: 2, consecutiveErrors: 0 },
    ]);
    expect(usage(run)).toEqual({ inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
  });

  it('does not enforce ExecutionRun budgets, change state, or overwrite upstream usage', async () => {
    const run = execution(1);
    Object.assign(run.counters, { inputTokens: 17, outputTokens: 9, estimatedCost: 0.25 });
    await engine({ executionRun: run, maxIterations: 2 }).run();
    expect(run.counters.modelSteps).toBe(2);
    expect(run.state).toBe('CREATED');
    expect(run.revision).toBe(0);
    expect(usage(run)).toEqual({ inputTokens: 17, outputTokens: 9, estimatedCost: 0.25 });
  });

  it('counts a retried generate/evaluate lifecycle once rather than per attempt', async () => {
    const run = execution();
    const evaluate = vi.fn<LoopEngineDeps['evaluate']>()
      .mockResolvedValueOnce({ verdict: 'not_met', evidence: ['missing'], reason: 'retry' })
      .mockResolvedValueOnce(met);
    await engine({ executionRun: run }, { evaluate }).run();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(run.counters.modelSteps).toBe(1);
    expect(store.replay(task.id)[0]?.budgetSnapshot).toEqual({ modelSteps: 1, consecutiveErrors: 0 });
  });
});
