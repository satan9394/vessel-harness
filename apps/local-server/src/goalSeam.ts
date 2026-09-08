/**
 * apps/local-server — Goal/Loop seam (task 065 + 066).
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
 *     the pending/in-progress/paused/met/not_met/cancelled state machine —
 *     `paused` added by 066). list/enqueue are thin wrappers so the HTTP layer
 *     stays dumb.
 *
 *  2. IterationStore — 063 per-task iteration log (replay order = 1..n). Each
 *     task detail view renders this replay; every entry carries the 061
 *     generator record + 062 evaluator record snapshots.
 *
 *  3. Run — one bounded task run (§11.1 default autonomy maxIterations=1/
 *     maxRetries=1, relaxed by 066 budget). claim → LoopEngine (RealGeneratorAdapter
 *     + RealEvaluatorAdapter over the injected providers; TempDir workspace per
 *     attempt) → IterationStore.persist (with generator/evaluator snapshots) →
 *     queue.settle. 066 adds the RunControl seam: pause/resume suspend/continue
 *     the live LoopEngine at iteration/attempt boundaries (never abort) and the
 *     per-task budget (query/set via setTaskBudget).
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
  RunControl,
  TempDirWorkspaceFactory,
} from '@vessel/engine';
import type { IterationEntry, IterationTaskRecord, QueueTask, RunBudget, TaskStatus } from '@vessel/engine';

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

  /**
   * Live run controls per task id — one shared RunControl per in-flight
   * runTask, so pause/resume/budget can suspend/query the running LoopEngine.
   * Created at runTask start, removed when the run settles/errors.
   */
  private readonly runControls = new Map<string, RunControl>();
  /**
   * Persisted per-task budget (maxIterations/maxRetries, §11.1 default 1/1) —
   * survives runs, applies to the next runTask. Goal/Loop mode relax writes here.
   */
  private readonly budgets = new Map<string, RunBudget>();

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
   * Is there a live run for this task right now? (a runTask has claimed the
   * task to in-progress and not yet settled). Used to gate pause/budget.
   */
  isRunning(taskId: string): boolean {
    return this.runControls.has(taskId);
  }

  /**
   * Pause a live run (066): suspends the running LoopEngine at its next
   * iteration/attempt boundary and flips the queue to `paused` (persistent
   * visible state). Does NOT abort — resume() continues the same run.
   * Fails loud (no-op-free) when there is no live run.
   */
  pauseTask(taskId: string): QueueTask {
    const control = this.runControls.get(taskId);
    if (!control) {
      throw new Error(`goal seam: task "${taskId}" is not running — nothing to pause`);
    }
    if (control.pause()) {
      // only flip the durable queue state once (idempotent pause → second call no-op)
      this.queue.pause(taskId);
    }
    return this.queue.get(taskId)!;
  }

  /**
   * Resume a paused run (066): releases the suspension gate so the LoopEngine
   * continues from the same boundary (never aborts, never loses a step), and
   * flips the queue back to `in-progress`. Fails loud when not paused.
   */
  resumeTask(taskId: string): QueueTask {
    const control = this.runControls.get(taskId);
    if (!control) {
      throw new Error(`goal seam: task "${taskId}" is not running — nothing to resume`);
    }
    if (control.resume()) {
      // flip the durable queue state only when it is actually paused (a
      // paused-started run may already be in-progress after claim)
      const task = this.queue.get(taskId);
      if (task?.status === 'paused') this.queue.resume(taskId);
    }
    return this.queue.get(taskId)!;
  }

  /**
   * Query the live budget (maxIterations/maxRetries, §11.1 default 1/1) plus
   * pause/exhausted state for a task. Works for both a live run and the queue
   * record; falls back to defaults when no run is in flight.
   */
  getTaskBudget(taskId: string): { budget: RunBudget; paused: boolean } | undefined {
    const control = this.runControls.get(taskId);
    const task = this.queue.get(taskId);
    if (!task) return undefined;
    const budget = control?.getBudget() ?? this.budgets.get(taskId) ?? { maxIterations: 1, maxRetries: 1 };
    const paused = task.status === 'paused' || (control?.paused ?? false);
    return { budget, paused };
  }

  /**
   * Set the live budget for a task (066 — Goal/Loop mode relax raises the §11.1
   * 1/1 caps). Applies to the next run; when a run is in flight it also adjusts
   * the live control immediately. Validates bounds (fail loud on invalid).
   */
  setTaskBudget(taskId: string, update: Partial<RunBudget>): RunBudget {
    const current = this.budgets.get(taskId) ?? { maxIterations: 1, maxRetries: 1 };
    // partial update: undefined keys keep the current value (never reset to default)
    const next: RunBudget = {
      maxIterations: update.maxIterations !== undefined ? update.maxIterations : current.maxIterations,
      maxRetries: update.maxRetries !== undefined ? update.maxRetries : current.maxRetries,
    };
    const control = this.runControls.get(taskId);
    const budget = control ? control.setBudget(next) : new RunControl(next).getBudget();
    this.budgets.set(taskId, budget);
    return budget;
  }

  /**
   * Run one task through the real chain (task 061-064 + 066 control):
   * claim (pending → in-progress) → LoopEngine [RealGeneratorAdapter +
   * RealEvaluatorAdapter, TempDir workspace per attempt] → IterationStore.append
   * (with 061 generator + 062 evaluator snapshots) → queue.settle.
   * The task must be pending (claimed backlog), in-progress or paused; the
   * queue's own claim/settle keep the state machine authoritative. Budget
   * defaults to §11.1 (1/1), relaxed by setTaskBudget (Goal/Loop mode); the
   * attached RunControl makes the run pauseable/resumable mid-flight.
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

    // task 066 control seam — reuse any budget set via setTaskBudget before the
    // run (default 1/1 §11.1), attach it to this in-flight run so pause/resume/
    // budget address the live LoopEngine.
    const persistedBudget = this.budgets.get(task.id) ?? { maxIterations: 1, maxRetries: 1 };
    const control = this.runControls.get(task.id) ?? new RunControl(persistedBudget);
    this.runControls.set(task.id, control);

    // claim → in-progress for pending backlog (the queue is authoritative for the
    // state machine). A paused task keeps its `paused` queue state — the visible
    // suspension — and its control starts suspended until resumeTask.
    let claimed = task;
    if (task.status === 'paused') {
      control.pause();
    } else {
      claimed = this.queue.claim(task.id);
    }

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
      { control },
    );

    try {
      const report = await engine.run();
      this.runControls.delete(task.id);
      // if the run was paused mid-flight, the queue is `paused` — but the loop
      // has now continued to completion, so bring it back to in-progress before
      // settling (settle only allows in-progress → met/not_met).
      const now = this.queue.get(task.id);
      if (now?.status === 'paused') this.queue.resume(task.id);
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
      this.runControls.delete(task.id);
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