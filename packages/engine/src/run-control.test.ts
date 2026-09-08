import { describe, it, expect, vi } from 'vitest';
import { LoopEngine } from './LoopEngine.js';
import { RunControl } from './run-control.js';
import type { LoopEngineDeps, LoopTask, GeneratorOutput, Workspace } from './LoopEngine.js';
import type { EvaluatorVerdict } from '@vessel/agents';

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

/** Manual gate — deterministic control over where the loop is paused. */
function makeGate(): { gate: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return { gate, release };
}

describe('engine/RunControl — pause/resume 挂起门（task 066）', () => {
  it('pause 后迭代边界挂起，resume 后原样继续（不 abort、不丢迭代）', async () => {
    const control = new RunControl({ maxIterations: 5 });
    const { gate: genGate, release: releaseGen } = makeGate();
    let genCalls = 0;
    let selects = 0;
    let startedResolve: () => void = () => {};
    const started = new Promise<void>((r) => {
      startedResolve = r;
    });
    const engine = new LoopEngine(
      deps({
        selectTask: async () => {
          selects += 1;
          return TASK;
        },
        generate: async () => {
          genCalls += 1;
          startedResolve();
          await genGate;
          return { output: 'ok GOLDEN' } as GeneratorOutput;
        },
        shouldContinue: async () => true,
      }),
      { control },
    );

    const runPromise = engine.run();
    // wait until iteration 1's generate is in-flight, then pause — the pause
    // takes effect at the NEXT boundary (iteration 2), never aborting in-flight work
    await started;
    control.pause();
    expect(control.paused).toBe(true);
    // release generate → iteration 1 completes → loop reaches iteration 2's
    // boundary and suspends there (the next hop does not execute)
    releaseGen();
    await new Promise((r) => setTimeout(r, 20));
    expect(selects).toBe(1); // iteration 2's select is suspended — nothing was lost
    expect(genCalls).toBe(1);

    // resume → the loop continues from the same boundary, intact
    control.resume();
    const report = await runPromise;
    expect(report?.outcome).toBe('met');
    expect(report?.iteration).toBe(5); // ran the full 5-iteration budget after resume
    expect(selects).toBe(5);
    expect(control.paused).toBe(false);
    // budget exhausted at iteration 6 — the stop reason is queryable
    expect(control.exhausted).toEqual({ kind: 'iterations', atIteration: 6 });
  });

  it('attempt 边界挂起：挂起期间下一次 generate 不启动，resume 后继续（与 abort 区分）', async () => {
    const control = new RunControl({ maxRetries: 1 });
    const { gate: genGate, release: releaseGen } = makeGate();
    let genCalls = 0;
    let startedResolve: () => void = () => {};
    const started = new Promise<void>((r) => {
      startedResolve = r;
    });
    const evaluate = vi
      .fn<(ctx: { attempt: number }) => Promise<EvaluatorVerdict>>()
      .mockResolvedValue({ verdict: 'not_met', evidence: ['x'], reason: 'never met' });
    const engine = new LoopEngine(
      deps({
        generate: async () => {
          genCalls += 1;
          startedResolve();
          await genGate;
          return { output: 'attempt output' } as GeneratorOutput;
        },
        evaluate: evaluate as unknown as LoopEngineDeps['evaluate'],
      }),
      { control },
    );

    const runPromise = engine.run();
    // attempt 1 is inside generate (blocked) — pause now: the suspension lands
    // on attempt 2's boundary (attempt 1 already crossed its own boundary)
    await started;
    control.pause();
    // release generate → attempt 1 evaluates not_met → attempt 2 boundary suspends
    releaseGen();
    await new Promise((r) => setTimeout(r, 20));
    expect(genCalls).toBe(1); // attempt 2's generate did NOT start while paused
    expect(control.paused).toBe(true);

    control.resume();
    const report = await runPromise;
    // after resume, attempt 2 runs (2nd generate call), then admits stopped (not_met)
    expect(genCalls).toBe(2);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(report?.outcome).toBe('stopped');
    expect(report?.result.retryCount).toBe(2);
    // 与 050 interrupt 区分：全程没有 abort —— run 正常结束（无中断异常），
    // 两次 generate 都完整跑完；maxRetries 用尽的哨兵即「为什么停」的证据
    expect(control.exhausted).toEqual({ kind: 'retries', atIteration: 1, attempt: 2 });
  });

  it('pause 与 050 interrupt 语义区分：interrupt 触发 abort，pause 绝不 abort', () => {
    const control = new RunControl();
    // RunControl 不暴露 abort —— 没有 abort()/signal，从 API 层面就不存在中止面
    expect((control as unknown as Record<string, unknown>).abort).toBeUndefined();
    expect((control as unknown as Record<string, unknown>).signal).toBeUndefined();
    expect(control.pause()).toBe(true);
    expect(control.pause()).toBe(false); // 幂等
    expect(control.resume()).toBe(true);
    expect(control.resume()).toBe(false); // 幂等
    expect(control.paused).toBe(false);
  });

  it('budget 默认 1/1（§11.1）：未显式设置时 maxIterations/maxRetries = 1/1', async () => {
    const control = new RunControl();
    expect(control.getBudget()).toEqual({ maxIterations: 1, maxRetries: 1 });
    // no control → engine default autonomy: exactly 1 iteration, even with
    // shouldContinue=true (061/062 e2e 1/1 semantics unchanged)
    let selects = 0;
    const engine = new LoopEngine(
      deps({
        selectTask: async () => {
          selects += 1;
          return TASK;
        },
        shouldContinue: async () => true,
      }),
      {},
    );
    const report = await engine.run();
    expect(selects).toBe(1);
    expect(report?.iteration).toBe(1);
  });

  it('setBudget 设置生效：查询/设置 round-trip，非法值 fail loud', () => {
    const control = new RunControl();
    expect(control.setBudget({ maxIterations: 3, maxRetries: 2 })).toEqual({ maxIterations: 3, maxRetries: 2 });
    expect(control.getBudget()).toEqual({ maxIterations: 3, maxRetries: 2 });
    // partial update 只改传入字段
    control.setBudget({ maxRetries: 5 });
    expect(control.getBudget()).toEqual({ maxIterations: 3, maxRetries: 5 });
    // 越界 fail loud（调用方 bug，不静默 clamp）
    expect(() => control.setBudget({ maxIterations: 0 })).toThrow(/maxIterations/);
    expect(() => control.setBudget({ maxRetries: -1 })).toThrow(/maxRetries/);
  });

  it('budget 用尽行为：maxIterations 用尽 → 停 + 可查原因（exhausted 哨兵）', async () => {
    const control = new RunControl({ maxIterations: 2 });
    let selects = 0;
    const engine = new LoopEngine(
      deps({
        selectTask: async () => {
          selects += 1;
          return TASK;
        },
        shouldContinue: async () => true,
      }),
      { control },
    );
    const report = await engine.run();
    // 2 轮迭代跑完，第 3 次边界预算用尽 → 停（返回最后 report，不抛异常）
    expect(selects).toBe(2);
    expect(report?.iteration).toBe(2);
    expect(control.exhausted).toEqual({ kind: 'iterations', atIteration: 3 });
    // 用尽后可查：exhausted 非 null = 为什么停
    expect(control.state().exhausted?.kind).toBe('iterations');
  });

  it('maxRetries 预算来自 control：setBudget({maxRetries}) 即时生效（retry 上限变化）', async () => {
    const control = new RunControl({ maxRetries: 1 });
    const evaluate = vi
      .fn<(ctx: { attempt: number }) => Promise<EvaluatorVerdict>>()
      .mockResolvedValue({ verdict: 'not_met', evidence: ['x'], reason: 'never met' });
    const engine = new LoopEngine(
      deps({ evaluate: evaluate as unknown as LoopEngineDeps['evaluate'] }),
      { control, maxRetries: 0 }, // static cap is ignored when control is present
    );
    const report = await engine.run();
    // control 的 maxRetries=1 → attempts=2
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(report?.result.retryCount).toBe(2);
    // maxRetries 用尽 → 停 + 可查原因（retries 哨兵：哪次迭代、第几个 attempt）
    expect(control.exhausted).toEqual({ kind: 'retries', atIteration: 1, attempt: 2 });
  });
});
