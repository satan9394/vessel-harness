import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IterationStore, ProjectTaskQueue } from '@vessel/engine';
import { loadPolicyArtifacts } from '@vessel/policy';
import type { ChatProvider, ChatRequest, ChatResponse } from '@vessel/shared';
import { GoalSeam } from './goalSeam.js';

const POLICY = path.resolve('configs/policy.default.yaml');

/** Deterministic provider: every chat() call resolves immediately with a met verdict. */
class MetVerdictProvider implements ChatProvider {
  readonly id = 'met-verdict';
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      content: '{"verdict":"met","evidence":["GOLDEN"],"reason":"ok"}',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

/**
 * Gated provider: chat() blocks ONLY the first model call on a manual gate
 * (release() opens it). Later calls pass immediately — a run can be paused
 * while its first generate is still in flight.
 */
class GateFirstCallProvider extends MetVerdictProvider {
  private calls = 0;
  private releaseFn: (() => void) | null = null;
  private gate: Promise<void> | null = null;
  private startedResolve!: () => void;
  /** resolved when the FIRST chat() call has been entered (run is past boundary 1) */
  readonly started = new Promise<void>((r) => {
    this.startedResolve = r;
  });

  override async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    if (this.calls === 1) {
      this.startedResolve();
      this.gate = new Promise<void>((r) => {
        this.releaseFn = r;
      });
      await this.gate;
    }
    return super.chat(request);
  }

  /** Open the first-call gate (the blocked generate completes). */
  release(): void {
    this.releaseFn?.();
  }
}

describe('goalSeam — 066 run control (pause/resume/budget) over a live run', () => {
  let dir: string;
  let ws: string;
  let seam: GoalSeam;
  const policyArtifacts = loadPolicyArtifacts({ systemPath: POLICY });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-goal-seam-066-'));
    ws = path.join(dir, 'workspace');
    fs.mkdirSync(ws, { recursive: true });
    seam = new GoalSeam({
      queue: new ProjectTaskQueue({ tasksRoot: path.join(dir, 'taskqueue') }),
      iterations: new IterationStore({ iterationsRoot: path.join(dir, 'iterations') }),
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function runCtx(provider: ChatProvider) {
    return {
      providers: { mock: provider },
      policyArtifacts,
      developerProviderId: 'mock',
      developerModel: 'mock-pro',
      reviewerProviderId: 'mock',
      reviewerModel: 'mock-review',
    };
  }

  it('运行中 pause：queue → paused（持久可见）；release 后 run 自动恢复并 settle（不 abort）', async () => {
    const provider = new GateFirstCallProvider();
    const task = seam.enqueue({ projectRoot: ws, goal: '挂起再继续的任务' });
    seam.setTaskBudget(task.id, { maxIterations: 2, maxRetries: 1 });

    // runTask 不 await；等第一次 chat 进入（已越过迭代边界 1）再 pause，避免
    // pause 落在边界 1 上把 run 挂死（pause 只作用于「下一跳边界」）
    const runPromise = seam.runTask(task.id, runCtx(provider));
    await provider.started;
    // 运行中 pause：control 挂起 + queue 翻到 paused（持久可见，非 abort）
    const pausedTask = seam.pauseTask(task.id);
    expect(pausedTask.status).toBe('paused');
    expect(seam.getTask(task.id)?.status).toBe('paused');
    expect(seam.isRunning(task.id)).toBe(true);
    expect(seam.getTaskBudget(task.id)?.paused).toBe(true);
    // budget 查询：run 中读到的是 setTaskBudget 的值
    expect(seam.getTaskBudget(task.id)?.budget).toEqual({ maxIterations: 2, maxRetries: 1 });

    // 释放 generate → 迭代 1 完成（persist）→ run 结束 → settle 前自动把 paused 恢复为
    // in-progress 再落 met 终态（pause 不 abort：run 完整跑完）
    provider.release();
    const result = await runPromise;
    expect(result.outcome).toBe('met');
    expect(seam.getTask(task.id)?.status).toBe('met');
    expect(seam.replay(task.id).length).toBeGreaterThanOrEqual(1);
    expect(seam.isRunning(task.id)).toBe(false);
  }, 30000);

  it('resume 把 paused run 拉回 in-progress；resume 一个没有 live run 的任务 fail loud', async () => {
    const provider = new MetVerdictProvider();
    const task = seam.enqueue({ projectRoot: ws, goal: 'paused 开局任务' });
    // 外部先把 queue 置 paused（模拟先挂起再触发 run）
    seam.queue.claim(task.id);
    seam.queue.pause(task.id);
    expect(seam.getTask(task.id)?.status).toBe('paused');

    // paused 状态触发 run：控制从挂起开始，run 悬停在迭代边界不执行
    const runPromise = seam.runTask(task.id, runCtx(provider));
    await new Promise((r) => setTimeout(r, 30));
    // 未 resume 前：没有迭代产生（挂在边界），queue 保持 paused
    expect(seam.replay(task.id).length).toBe(0);
    expect(seam.getTask(task.id)?.status).toBe('paused');

    // resume → 边界继续 → 完整 run → settle met
    const resumedTask = seam.resumeTask(task.id);
    expect(resumedTask.status).toBe('in-progress');
    const result = await runPromise;
    expect(result.outcome).toBe('met');
    expect(seam.getTask(task.id)?.status).toBe('met');
    expect(seam.replay(task.id).length).toBeGreaterThanOrEqual(1);

    // run 已结束：再 pause/resume → fail loud（无 live run）
    expect(() => seam.pauseTask(task.id)).toThrow(/not running/);
    expect(() => seam.resumeTask(task.id)).toThrow(/not running/);
  }, 30000);

  it('setTaskBudget/getTaskBudget：默认 §11.1 1/1；设置后持久、跨 run 生效；非法值 fail loud', async () => {
    const provider = new MetVerdictProvider();
    const task = seam.enqueue({ projectRoot: ws, goal: '预算任务' });
    // 默认 1/1
    expect(seam.getTaskBudget(task.id)?.budget).toEqual({ maxIterations: 1, maxRetries: 1 });
    // 设置（Goal/Loop 模式放宽）
    expect(seam.setTaskBudget(task.id, { maxIterations: 3 })).toEqual({ maxIterations: 3, maxRetries: 1 });
    expect(seam.setTaskBudget(task.id, { maxRetries: 2 })).toEqual({ maxIterations: 3, maxRetries: 2 });
    // 非法值 fail loud（不静默 clamp）
    expect(() => seam.setTaskBudget(task.id, { maxIterations: 0 })).toThrow(/maxIterations/);
    // run 后 budget 仍持久（runControls 已清理，budgets 保留）
    const result = await seam.runTask(task.id, runCtx(provider));
    expect(result.outcome).toBe('met');
    expect(seam.isRunning(task.id)).toBe(false);
    expect(seam.getTaskBudget(task.id)?.budget).toEqual({ maxIterations: 3, maxRetries: 2 });
  }, 30000);
});
