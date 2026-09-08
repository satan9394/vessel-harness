import type { EvaluatorVerdict } from '@vessel/agents';
import type { RunControl } from './run-control.js';

/**
 * V0.5 Loop Engine core (MISSION-V0.5 §三.1 / task 010).
 *
 * Outer-loop orchestration state machine. One "iteration" = the full lifecycle
 * of a single candidate task: select → isolate workspace → Generator executes →
 * independent Evaluator reviews → Persist → continue/stop decision.
 *
 * The Loop Engine is an ORCHESTRATION layer, NOT a new kernel (ARCHITECTURE
 * §7 V0.5 row): it never imports core internals and never adds loop mechanisms.
 * Generator = a single-session loop run by the caller (injected); Evaluator =
 * agents/evaluator (injected); the verdict that decides met/not_met comes from
 * the Evaluator — the Generator never self-certifies.
 *
 * Workspace lifecycle (task 064): when `workspaceFactory` is wired, every
 * generate attempt runs in its own fresh workspace that is disposed exactly
 * once when that attempt ends — met/stopped admit, retry, exception, or
 * interruption all unwind through the per-attempt finally. No workspace ever
 * outlives its attempt, so earlier attempts cannot leak when a retry creates a
 * fresh one (062 known issue: "attempt1 workspace 不 dispose").
 */

/** Loop Engine phases of a single iteration lifecycle. */
export type LoopPhase =
  | 'idle'
  | 'selecting'
  | 'generating'
  | 'evaluating'
  | 'persisting'
  | 'done'
  | 'retry';

/** Terminal outcome of a completed iteration (phase 'done'). */
export type IterationOutcome = 'met' | 'stopped';

/**
 * Persisted iteration record (MISSION-V0.5 §三.5: failures and successes both
 * leave a trace). `verdict` comes from the Evaluator — never the Generator.
 */
export interface IterationResult {
  iteration: number;
  taskId: string;
  /** final Evaluator verdict; 'impossible'/'error' also carry evidence */
  verdict: EvaluatorVerdict['verdict'];
  evidence: string[];
  reason: string;
  /** absolute path of the generated artifact workspace (if any) */
  outputPath?: string;
  /** number of generate→evaluate attempts consumed by this iteration */
  retryCount: number;
  /** true when the iteration was admitted with met after prior not_met retries */
  metAfterRetries?: boolean;
}

/** Injected collaborators — deterministic tests substitute all of them. */
export interface LoopEngineDeps {
  /** picks the candidate task for the iteration. */
  selectTask: () => Promise<LoopTask | null>;
  /**
   * Runs the Generator inside the isolated workspace and returns its claimed
   * final output. The claim is DATA for the Evaluator, never proof.
   */
  generate: (ctx: GenerateContext) => Promise<GeneratorOutput>;
  /**
   * Independent review — the only authority for met/not_met/impossible/error.
   */
  evaluate: (ctx: EvaluateContext) => Promise<EvaluatorVerdict>;
  /**
   * Persists the iteration record (project memory / iteration log); failures
   * and successes both leave a trace. Must not throw.
   */
  persist: (result: IterationResult) => Promise<void>;
  /**
   * Decides whether another iteration should run after a met/stopped one.
   * Defaults to false (stop after the first admitted iteration).
   */
  shouldContinue?: (ctx: ContinueContext) => Promise<boolean>;
  /**
   * Optional: fresh workspace each generate attempt (try/retry). When provided,
   * `disposeWorkspace` MUST also be provided (guardDeps fails loud otherwise) —
   * a created workspace without a disposal seam would leak on every attempt.
   */
  workspaceFactory?: (task: LoopTask) => Promise<Workspace>;
  /**
   * Optional: called exactly once per workspace the engine created (per-attempt,
   * on every exit path incl. exception/interruption — task 064). Delegates to
   * the factory seam (TempDir rmSync / git worktree remove); never touches the
   * main workspace.
   */
  disposeWorkspace?: (ws: Workspace) => Promise<void>;
}

/** A candidate task fed to the engine. */
export interface LoopTask {
  id: string;
  goal: string;
  /** optional acceptance criteria handed to the Evaluator */
  acceptance?: string[];
}

/** Context handed to the Generator for one attempt. */
export interface GenerateContext {
  task: LoopTask;
  iteration: number;
  attempt: number;
  workspace: Workspace;
}

/** Claimed generator output — data for the Evaluator to verify, never proof. */
export interface GeneratorOutput {
  /** the generator's claimed final text / artifact summary */
  output: string;
  /** artifact paths the Evaluator MAY inspect (read-only) */
  artifactPaths?: string[];
}

/** Context handed to the Evaluator for one review. */
export interface EvaluateContext {
  task: LoopTask;
  iteration: number;
  attempt: number;
  workspace: Workspace;
  generatorOutput: GeneratorOutput;
}

/** Context handed to the continue/stop predicate. */
export interface ContinueContext {
  iteration: number;
  lastResult: IterationResult;
}

/** Isolated execution surface for one attempt (git worktree or temp dir). */
export interface Workspace {
  root: string;
  /** raw free-form data, e.g. task-id of the worktree; never relied upon */
  meta?: Record<string, unknown>;
}

/** Optional observable progress hook (events surface is reserved for later). */
export interface LoopProgress {
  onPhase?: (phase: LoopPhase, ctx: { iteration: number; taskId?: string }) => void;
}

export interface LoopEngineOptions {
  maxIterations?: number;
  /** max generate→evaluate retries per iteration before it is admitted as not_met */
  maxRetries?: number;
  progress?: LoopProgress;
  /**
   * task 066 control seam — shared, mutable pause/resume + budget gate. When
   * provided, the engine consults it at every iteration/attempt boundary for
   * pause suspension and budget exhaustion, and reads maxIterations/maxRetries
   * from it (default 1/1, §11.1). When omitted the engine falls back to the
   * static maxIterations/maxRetries options (default 1/1) — 061/062 default
   * autonomy is unchanged.
   */
  control?: RunControl;
}

export interface LoopRunReport {
  iteration: number;
  taskId: string;
  outcome: IterationOutcome;
  result: IterationResult;
}

const TERMINAL_VERDICTS: ReadonlySet<string> = new Set(['met', 'not_met', 'impossible', 'error']);

function isTerminal(verdict: EvaluatorVerdict['verdict']): boolean {
  return TERMINAL_VERDICTS.has(verdict);
}

/** fail loud: user/runner bugs surface as exceptions, never as silent skips. */
function guardDeps(deps: LoopEngineDeps): void {
  for (const key of ['selectTask', 'generate', 'evaluate', 'persist'] as const) {
    if (typeof deps[key] !== 'function') {
      throw new Error(`LoopEngine: dependency "${key}" must be a function`);
    }
  }
  // task 064 lifecycle invariant: a workspace factory without a disposal seam
  // would leak on every attempt — wiring that shape is a runner bug, fail loud.
  if (deps.workspaceFactory && typeof deps.disposeWorkspace !== 'function') {
    throw new Error('LoopEngine: disposeWorkspace must be a function when workspaceFactory is provided');
  }
}

function fmtVerdict(v: EvaluatorVerdict): string {
  return `${v.verdict}${v.reason ? ` — ${v.reason}` : ''}`;
}

/**
 * Runs one candidate task's full lifecycle and returns its terminal outcome.
 * Implemented as a small explicit state machine over LoopPhase; every phase
 * transition passes through the progress hook. not_met / impossible / error
 * verdicts retry up to maxRetries; after that the iteration is admitted
 * (persisted) with its Evaluator verdict and evidence intact.
 */
export class LoopEngine {
  private readonly deps: LoopEngineDeps;
  private readonly maxIterations: number;
  private readonly maxRetries: number;
  private readonly progress?: LoopProgress;
  /** task 066 control seam (optional). When set, it is authoritative for budget + pause. */
  private readonly control?: RunControl;

  constructor(deps: LoopEngineDeps, opts: LoopEngineOptions = {}) {
    guardDeps(deps);
    this.deps = deps;
    this.maxIterations = opts.maxIterations ?? 1;
    this.maxRetries = opts.maxRetries ?? 1;
    this.progress = opts.progress;
    this.control = opts.control;
    if (this.maxIterations < 1) throw new Error('LoopEngine: maxIterations must be ≥ 1');
    if (this.maxRetries < 0) throw new Error('LoopEngine: maxRetries must be ≥ 0');
    if (this.control) {
      // guardDeps-level fail-loud: an injected control that violates budget bounds
      // is a runner bug — surface it now, not mid-loop. Default stays 1/1.
      const budget = this.control.getBudget();
      if (budget.maxIterations < 1) throw new Error('LoopEngine: control maxIterations must be ≥ 1');
      if (budget.maxRetries < 0) throw new Error('LoopEngine: control maxRetries must be ≥ 0');
    }
  }

  /**
   * Effective iteration cap at a given moment: the live control when injected,
   * else the static option (default 1/1). Querying live allows the UI to raise
   * the budget mid-run (Goal/Loop mode relax) without rebuilding the engine.
   */
  private iterationCap(): number {
    return this.control ? this.control.getBudget().maxIterations : this.maxIterations;
  }

  /**
   * Effective retry cap: live control when injected, else the static default 1/1.
   */
  private retryCap(): number {
    return this.control ? this.control.getBudget().maxRetries : this.maxRetries;
  }

  private phase(phase: LoopPhase, ctx: { iteration: number; taskId?: string }): void {
    this.progress?.onPhase?.(phase, ctx);
  }

  /** Pick the next candidate task or stop (empty queue → stopped, nothing run). */
  async selectTask(): Promise<LoopTask | null> {
    return this.deps.selectTask();
  }

  /**
   * Runs the engine: iterations of select → generate → evaluate → persist
   * until shouldContinue says stop (default: stop after the first admitted
   * iteration). Returns the report of the iteration that stopped the loop.
   * The loop NEVER runs with an empty task queue: it stops instead.
   */
  async run(): Promise<LoopRunReport | null> {
    let lastReport: LoopRunReport | null = null;
    for (let iteration = 1; ; iteration += 1) {
      // task 066 control boundary: suspend at this hop if paused (await the
      // resume gate — never abort); stop when the (live) iteration budget runs out.
      if (this.control) {
        const canRun = await this.control.awaitIterationBoundary(iteration);
        if (!canRun) return lastReport; // maxIterations exhausted → stop, reason queryable
      } else if (iteration > this.maxIterations) {
        return lastReport; // default/static cap (1/1) — unchanged 061/062 semantics
      }

      this.phase('selecting', { iteration });
      const task = await this.deps.selectTask();
      if (!task) {
        // empty queue: stop cleanly — no task means nothing to admit or persist
        return lastReport;
      }
      const report = await this.runTask(task, iteration);
      lastReport = report;
      const ctx: ContinueContext = { iteration, lastResult: report.result };
      const cont =
        report.outcome === 'met' || report.outcome === 'stopped'
          ? await this.deps.shouldContinue?.(ctx)
          : false;
      if (!cont) return report;
    }
  }

  /**
   * Runs one candidate task through generate→evaluate→persist, returning the iteration report.
   *
   * Workspace lifecycle (task 064): each generate attempt owns a FRESH isolated
   * workspace whose disposal is guaranteed on EVERY exit path of that attempt —
   * met/stopped admit return, retry-continue, and exceptions/interruptions
   * thrown inside generate/evaluate/workspaceFactory all unwind through the
   * per-attempt finally below before the next attempt (or the caller) proceeds.
   * This closes the 062 known-issue: previously a workspace created on attempt 1
   * was silently leaked when a retry (attempt > 1) replaced the reference, and
   * only the LAST workspace was disposed. Disposal delegates to the injected
   * factory seam (disposeWorkspace) exactly once per created workspace, so the
   * TempDir/GitWorktree isolation guarantees in workspace.ts are preserved and
   * the engine never touches the main workspace itself. A dispose failure is
   * loud (never a silent leak) — it surfaces from the attempt's finally.
   */
  async runTask(task: LoopTask, iteration = 1): Promise<LoopRunReport> {
    if (!task?.id || !task.goal) {
      throw new Error(`LoopEngine: task needs id + goal (got ${JSON.stringify(task)})`);
    }
    let outputPath: string | undefined;

    const admit = async (finalVerdict: EvaluatorVerdict, attempts: number, metAfterRetries: boolean): Promise<IterationResult> => {
      const result: IterationResult = {
        iteration,
        taskId: task.id,
        verdict: finalVerdict.verdict,
        evidence: [...finalVerdict.evidence],
        reason: finalVerdict.reason,
        outputPath,
        retryCount: attempts,
        metAfterRetries,
      };
      this.phase('persisting', { iteration, taskId: task.id });
      await this.deps.persist(result);
      return result;
    };

    const attempts = this.retryCap() + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      // task 066 control boundary: suspend before this attempt if paused (await
      // the resume gate — never abort; a paused/resumed attempt continues intact).
      if (this.control) {
        await this.control.awaitAttemptBoundary();
      }
      const phaseLabel: LoopPhase = attempt === 1 ? 'generating' : 'retry';
      this.phase(phaseLabel, { iteration, taskId: task.id });

      // task 064: attempt-scoped workspace — created here, disposed in this
      // attempt's finally on every exit path (return/retry/throw). The
      // workspace variable never outlives its attempt, so no earlier attempt's
      // workspace can be stranded when a later attempt creates a fresh one.
      let workspace: Workspace | undefined;
      try {
        if (this.deps.workspaceFactory) {
          workspace = await this.deps.workspaceFactory(task);
          outputPath = workspace.root;
        }

        const generateCtx: GenerateContext = { task, iteration, attempt, workspace: workspace ?? { root: '' } };
        const generated = await this.deps.generate(generateCtx);

        this.phase('evaluating', { iteration, taskId: task.id });
        const evaluateCtx: EvaluateContext = {
          task,
          iteration,
          attempt,
          workspace: workspace ?? { root: '' },
          generatorOutput: generated,
        };
        const verdict = await this.deps.evaluate(evaluateCtx);

        if (verdict.verdict === 'met') {
          const result = await admit(verdict, attempt, attempt > 1);
          this.phase('done', { iteration, taskId: task.id });
          return { iteration, taskId: task.id, outcome: 'met', result };
        }
        if (attempt < attempts) {
          // not_met / impossible / error → retry up to maxRetries (attempts-1
          // retries); this attempt's workspace is disposed by the finally below
          // before the next attempt creates a fresh one.
          continue;
        }
        // retry budget exhausted: the last attempt admits with its verdict — the
        // stop reason is queryable (result.retryCount + control.exhausted).
        if (this.control) {
          this.control.noteRetryExhausted(iteration, attempt);
        }
        const result = await admit(verdict, attempt, false);
        this.phase('done', { iteration, taskId: task.id });
        return { iteration, taskId: task.id, outcome: 'stopped', result };
      } finally {
        if (workspace && this.deps.disposeWorkspace) {
          await this.deps.disposeWorkspace(workspace);
        }
      }
    }
    // unreachable — the loop above always returns or throws
    throw new Error('LoopEngine: runTask fell through');
  }
}
