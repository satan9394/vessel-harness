/**
 * apps/local-server — Goal/Loop seam (task 065).
 *
 * The web Goal panel (queue + iteration replay + run control) is served from
 * this module over 063's ProjectTaskQueue + IterationStore, wired to the 061/062
 * real run chain (docs/Vessel…v1.0 §11) through the LoopEngine. It mirrors the
 * 060 teamSeam pattern: the local-server is the composition seam and composes
 * the engine packages, never extending them.
 *
 * Data planes:
 *
 *  1. TaskQueue — 063 ProjectTaskQueue (persistent per-project task queue with
 *     the pending/in-progress/met/not_met/cancelled state machine). list/enqueue
 *     are thin wrappers so the HTTP layer stays dumb.
 *
 *  2. IterationStore — 063 per-task iteration log (replay order = 1..n). Each
 *     task detail view renders this replay; every entry carries the 061
 *     generator record + 062 evaluator record snapshots.
 *
 *  3. Run — one synchronous, bounded task run (maxIterations=1, maxRetries=1,
 *     §11.1 default autonomy). claim → LoopEngine (RealGeneratorAdapter +
 *     RealEvaluatorAdapter over the injected providers; TempDir workspace per
 *     attempt) → IterationStore.persist (with generator/evaluator snapshots) →
 *     queue.settle. 066 relaxes autonomy / pause / resume / budget — not here.
 *
 * Layer note: importing @vessel/engine (LoopEngine + real adapters + stores +
 * TempDirWorkspaceFactory) is in scope for the composition seam — the same way
 * it imports @vessel/agents/@vessel/application for the team seam. Nothing new
 * is added to the mechanism packages.
 */

import * as fs from 'node:fs';
import { EventBus } from '@vessel/core';
import type { ChatProvider, PolicyArtifacts } from '@vessel/shared';
import {
  IterationStore,
  LoopEngine,
  ProjectTaskQueue,
  RealEvaluatorAdapter,
  RealGeneratorAdapter,
  TempDirWorkspaceFactory,
} from '@vessel/engine';
import type { IterationEntry, IterationTaskRecord, QueueTask, TaskStatus } from '@vessel/engine';

/** Task queue statuses the Goal UI shows (queue terminal state machine). */
export type GoalTaskStatus = TaskStatus;

export interface GoalSeamOptions {
  /** ProjectTaskQueue (defaults to ~/.vessel/taskqueue; tests inject tmp) */
  queue?: ProjectTaskQueue;
  /** IterationStore (defaults to ~/.vessel/iterations; tests inject tmp) */
  iterations?: IterationStore;
}

export interface GoalRunContextOptions {
  /** providerId → ChatProvider the generator/evaluator sessions run on */
  providers: Record<string, ChatProvider>;
  /** compiled policy artifacts (default server policy.default.yaml) */
  policyArtifacts: PolicyArtifacts;
  /** developer (generator) provider id + model (default mock) */
  developerProviderId?: string;
  developerModel?: string;
  /** reviewer (evaluator) provider id + model (default mock) */
  reviewerProviderId?: string;
  reviewerModel?: string;
}

/** Verdict set used by the queue's settle (evaluator transient → queue terminal). */
type TerminalVerdict = 'met' | 'not_met' | 'impossible' | 'error';

/** Result of one task run round (what POST /tasks/:id/run returns). */
export interface GoalRunResult {
  queueTask: QueueTask;
  /** the iteration entry just appended (replay unit; carries gen/eval snapshots) */
  entry?: IterationEntry;
  /** complete task iteration record (for an immediate refresh) */
  record?: IterationTaskRecord;
  /** latest run outcome */
  outcome: 'met' | 'not_met' | 'stopped' | 'error';
  error?: string;
}

/**
 * GoalSeam — 063 stores + a run orchestrator for the local server. Holds the
 * persistent queue + iteration log and composes one LoopEngine run when asked.
 */
export class GoalSeam {
  readonly queue: ProjectTaskQueue;
  readonly iterations: IterationStore;

  constructor(opts: GoalSeamOptions = {}) {
    this.queue = opts.queue ?? new ProjectTaskQueue();
    this.iterations = opts.iterations ?? new IterationStore();
  }

  /** All tasks, newest first (management view). */
  listTasks(opts: { projectRoot?: string; status?: GoalTaskStatus } = {}): QueueTask[] {
    return this.queue.list(opts);
  }

  /** One task; undefined when absent/corrupt. */
  getTask(id: string): QueueTask | undefined {
    return this.queue.get(id);
  }

  /** Enqueue a goal into the persistent queue (no run). */
  enqueue(input: { projectRoot: string; goal: string; acceptance?: readonly string[] }): QueueTask {
    return this.queue.enqueue(input);
  }

  /** Replay a task's iterations (empty log → [] — friendly empty state). */
  replay(taskId: string): readonly IterationEntry[] {
    return this.iterations.replay(taskId);
  }

  /** Full task iteration record (for detail refresh) or undefined. */
  taskRecord(taskId: string): IterationTaskRecord | undefined {
    return this.iterations.get(taskId);
  }

  /**
   * Run one task synchronously through the real chain (task 061-064):
   * claim (pending → in-progress) → LoopEngine [RealGeneratorAdapter +
   * RealEvaluatorAdapter, TempDir workspace per attempt] → IterationStore.append
   * (with 061 generator + 062 evaluator snapshots) → queue.settle.
   * The task must be pending (claimed backlog) or in-progress; the queue's own
   * claim/settle keep the state machine authoritative. maxIterations=1/
   * maxRetries=1 (§11.1) — 066 relaxes.
   */
  async runTask(taskId: string, runCtx: GoalRunContextOptions): Promise<GoalRunResult> {
    const task = this.queue.get(taskId);
    if (!task) throw new Error(`goal seam: unknown task id "${taskId}"`);
    if (task.status === 'met' || task.status === 'not_met' || task.status === 'cancelled') {
      throw new Error(`goal seam: task "${taskId}" is terminal (${task.status}) — requeue it first`);
    }
    if (task.projectRoot && !isDir(task.projectRoot)) {
      throw new Error(`goal seam: owning project workspace does not exist: "${task.projectRoot}"`);
    }

    // 061/062 adapters — one bounded developer run + one bounded internal review.
    const bus = new EventBus();
    const generator = new RealGeneratorAdapter({
      providers: runCtx.providers,
      policyArtifacts: runCtx.policyArtifacts,
      tools: [],
      developerProviderId: runCtx.developerProviderId ?? 'mock',
      developerModel: runCtx.developerModel ?? 'mock-pro',
      bus,
    });
    const evaluator = new RealEvaluatorAdapter({
      providers: runCtx.providers,
      policyArtifacts: runCtx.policyArtifacts,
      reviewerProviderId: runCtx.reviewerProviderId ?? 'mock',
      reviewerModel: runCtx.reviewerModel ?? 'mock-review',
      bus,
    });

    const wsFactory = new TempDirWorkspaceFactory();
    const loopTask = { id: task.id, goal: task.goal, acceptance: task.acceptance };

    // claim → in-progress (the queue is authoritative for the state machine)
    const claimed = this.queue.claim(task.id);

    const engine = new LoopEngine(
      {
        selectTask: async () => loopTask,
        generate: (ctx) => generator.generate(ctx),
        evaluate: (ctx) => evaluator.evaluate(ctx),
        persist: async (result) => {
          // attach the 061/062 snapshots + the in-progress → settled transition
          this.iterations.appendIteration(
            {
              taskId: task.id,
              goal: task.goal,
              acceptance: task.acceptance,
              projectRoot: task.projectRoot,
            },
            {
              verdict: result.verdict,
              evidence: result.evidence,
              reason: result.reason,
              outputPath: result.outputPath,
              retryCount: result.retryCount,
              metAfterRetries: result.metAfterRetries,
              engineIteration: result.iteration,
              transition: { from: 'in-progress', to: settleStatus(result.verdict) },
              generator: generator.lastRun ?? undefined,
              evaluator: evaluator.lastRun ?? undefined,
            },
          );
        },
        workspaceFactory: (t) => wsFactory.create(t),
        disposeWorkspace: (ws) => wsFactory.dispose(ws),
      },
      { maxIterations: 1, maxRetries: 1 },
    );

    try {
      const report = await engine.run();
      // settle the queue with the final evaluator verdict (met → met, else not_met)
      const finalVerdict = report?.result?.verdict;
      const settled = this.queue.settle(claimed.id, finalVerdict ?? 'not_met', {
        reason: report?.result?.reason,
        iteration: report?.result?.iteration,
      });
      const record = this.iterations.get(claimed.id);
      if (!record) throw new Error(`goal seam: no iteration record after run for "${claimed.id}"`);
      const entry = record.iterations[record.iterations.length - 1]!;
      return {
        queueTask: settled,
        entry,
        record,
        outcome: report?.outcome === 'met' ? 'met' : 'not_met',
      };
    } catch (err) {
      // structural failure — requeue so the task can be retried; surface the error
      const reason = err instanceof Error ? err.message : String(err);
      try {
        this.queue.requeue(claimed.id);
      } catch {
        // requeue needs in-progress; a settle may have partially landed — best-effort
      }
      return {
        queueTask: this.queue.get(claimed.id) ?? claimed,
        entry: this.iterations.replay(claimed.id)[0] ?? undefined,
        record: this.iterations.get(claimed.id),
        outcome: 'error',
        error: reason,
      };
    }
  }
}

/** No permanent delete — the run lifecycle only uses queue states. */
// (recycle-safe: settlement/requeue never remove files)

/** evaluator verdict → queue settle status (met → met; everything else not_met). */
function settleStatus(verdict: TerminalVerdict): 'met' | 'not_met' {
  return verdict === 'met' ? 'met' : 'not_met';
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}