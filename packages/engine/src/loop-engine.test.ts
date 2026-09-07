import { describe, it, expect, vi } from 'vitest';
import {
  LoopEngine,
  type LoopEngineDeps,
  type LoopTask,
  type GeneratorOutput,
  type Workspace,
} from './LoopEngine.js';
import type { EvaluatorVerdict } from '@cah/agents';

const TASK: LoopTask = { id: 't1', goal: '完成一个实现', acceptance: ['GOLDEN'] };

function deps(overrides: Partial<LoopEngineDeps> = {}): LoopEngineDeps {
  const noWorkspace: Workspace = { root: '/tmp/ws' };
  return {
    selectTask: async () => TASK,
    generate: async () => ({ output: 'generated output GOLDEN' }) as GeneratorOutput,
    evaluate: async () => ({ verdict: 'met', evidence: ['GOLDEN'], reason: 'acceptance present' }) as EvaluatorVerdict,
    persist: async () => {},
    workspaceFactory: async () => noWorkspace,
    disposeWorkspace: async () => {},
    ...overrides,
  };
}

describe('engine — LoopEngine core state machine (V0.5-M1)', () => {
  it('runs a met iteration end-to-end: select → generate → evaluate → persist → done', async () => {
    const phases: string[] = [];
    const persisted: unknown[] = [];
    const engine = new LoopEngine(deps({ persist: async (r) => { persisted.push(r); } }), {
      progress: { onPhase: (p) => phases.push(p) },
    });
    const report = await engine.run();
    expect(report?.outcome).toBe('met');
    expect(report?.result.verdict).toBe('met');
    expect(report?.result.taskId).toBe('t1');
    expect(persisted).toHaveLength(1);
    // selecting → generating → evaluating → persisting → done
    expect(phases).toEqual(['selecting', 'generating', 'evaluating', 'persisting', 'done']);
  });

  it('not_met retries up to maxRetries, then admits stopped with the Evaluator verdict', async () => {
    const evaluate = vi
      .fn<(ctx: { attempt: number }) => Promise<EvaluatorVerdict>>()
      .mockResolvedValueOnce({ verdict: 'not_met', evidence: ['missing'], reason: 'no golden' })
      .mockResolvedValueOnce({ verdict: 'not_met', evidence: ['missing'], reason: 'no golden' });
    const engine = new LoopEngine(deps({ evaluate: evaluate as unknown as LoopEngineDeps['evaluate'] }), {
      maxRetries: 1, // → attempts = 2
    });
    const report = await engine.run();
    expect(report?.outcome).toBe('stopped');
    expect(report?.result.verdict).toBe('not_met');
    expect(report?.result.retryCount).toBe(2);
    expect(report?.result.evidence).toContain('missing');
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('met on a later attempt is admitted with metAfterRetries', async () => {
    const evaluate = vi
      .fn<(ctx: { attempt: number }) => Promise<EvaluatorVerdict>>()
      .mockResolvedValueOnce({ verdict: 'not_met', evidence: ['x'], reason: 'first fail' })
      .mockResolvedValueOnce({ verdict: 'met', evidence: ['GOLDEN'], reason: 'second ok' });
    const engine = new LoopEngine(deps({ evaluate: evaluate as unknown as LoopEngineDeps['evaluate'] }), {
      maxRetries: 1,
    });
    const report = await engine.run();
    expect(report?.outcome).toBe('met');
    expect(report?.result.metAfterRetries).toBe(true);
    expect(report?.result.retryCount).toBe(2);
  });

  it('Generator cannot self-certify: an evaluator rejecting the generator claim admits stopped', async () => {
    // generator claims success, but the independent evaluator says not_met
    const engine = new LoopEngine(
      deps({
        generate: async () => ({ output: '我已完成，测试全过' }) as GeneratorOutput,
        evaluate: async () => ({ verdict: 'not_met', evidence: ['无测试通过证据'], reason: 'generator 自证不可信' }) as EvaluatorVerdict,
      }),
      { maxRetries: 0 },
    );
    const report = await engine.run();
    expect(report?.outcome).toBe('stopped');
    expect(report?.result.verdict).toBe('not_met');
    expect(report?.result.reason).toContain('自证不可信');
  });

  it('empty task queue stops cleanly without persisting', async () => {
    const persisted: unknown[] = [];
    const engine = new LoopEngine(deps({ selectTask: async () => null, persist: async (r) => { persisted.push(r); } }), {
      maxIterations: 3,
    });
    const report = await engine.run();
    expect(report).toBeNull();
    expect(persisted).toHaveLength(0);
  });

  it('shouldContinue=false stops after the first admitted iteration', async () => {
    const engine = new LoopEngine(deps({ shouldContinue: async () => false }), { maxIterations: 5 });
    const report = await engine.run();
    expect(report?.iteration).toBe(1);
  });

  it('shouldContinue=true runs further iterations until the queue empties', async () => {
    const tasks = [{ id: 'a', goal: 'ga' }, { id: 'b', goal: 'gb' }, null];
    let i = 0;
    const selectTask = async (): Promise<LoopTask | null> => (i < tasks.length ? (tasks[i++] as LoopTask) : null);
    const engine = new LoopEngine(deps({ selectTask, shouldContinue: async () => true }), { maxIterations: 10 });
    const report = await engine.run();
    // stops when the queue returns null on the 3rd select; run() returns the last
    // admitted report (task 'b'), not null — null only when nothing ever ran
    expect(report?.taskId).toBe('b');
    expect(report?.outcome).toBe('met');
    expect(i).toBe(3);
  });

  it('fails loud on missing deps (guardDeps)', () => {
    const bad = deps() as unknown as Record<string, unknown>;
    delete bad.persist;
    expect(() => new LoopEngine(bad as unknown as LoopEngineDeps)).toThrow(/persist/);
  });

  it('validates maxIterations/maxRetries bounds', () => {
    expect(() => new LoopEngine(deps(), { maxIterations: 0 })).toThrow(/maxIterations/);
    expect(() => new LoopEngine(deps(), { maxRetries: -1 })).toThrow(/maxRetries/);
  });

  it('requires task id + goal', async () => {
    const engine = new LoopEngine(deps({ selectTask: async () => ({ id: '', goal: '' }) as LoopTask }), {});
    await expect(engine.run()).rejects.toThrow(/id \+ goal/);
  });

  it('workspace factory and dispose are wired (attempt lifecycle)', async () => {
    const created: string[] = [];
    const disposed: string[] = [];
    const engine = new LoopEngine(
      deps({
        workspaceFactory: async (t) => {
          created.push(t.id);
          return { root: `/tmp/it-${created.length}` } as Workspace;
        },
        disposeWorkspace: async (ws) => {
          disposed.push(ws.root);
        },
      }),
      {},
    );
    await engine.run();
    expect(created).toEqual(['t1']);
    expect(disposed).toHaveLength(1);
    expect(disposed[0]).toContain('/tmp/it-');
  });

  it('persist is called with the full IterationResult including evidence', async () => {
    const persisted: Parameters<LoopEngineDeps['persist']>[0][] = [];
    const engine = new LoopEngine(deps({ persist: async (r) => { persisted.push(r); } }), {});
    await engine.run();
    expect(persisted[0]?.taskId).toBe('t1');
    expect(persisted[0]?.evidence).toEqual(['GOLDEN']);
    expect(persisted[0]?.iteration).toBe(1);
  });
});
