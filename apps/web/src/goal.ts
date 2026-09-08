/**
 * Vessel Local Web — Goal/Loop UI mirror types + pure helpers (task 065).
 *
 * The web app is a standalone Vite project and never imports workspace
 * packages, so the Goal JSON shapes sent by the local server (apps/local-server
 * seams over 063 ProjectTaskQueue + IterationStore + the 061/062 real run chain)
 * are mirrored here as plain interfaces. The pure selectors below turn a task
 * list / iteration replay into the Goal panel rows: status labels, generator
 * output summaries, evaluator conclusions, empty states and the 066 control
 * seam (pause/resume/budget placeholders). Keeping the mapping pure makes the
 * panel trivially testable under node.
 */

// ---------------------------------------------------------------------------
// Task queue (063 ProjectTaskQueue) — wire shape of GET /api/goal/tasks
// ---------------------------------------------------------------------------

export type GoalTaskStatus = 'pending' | 'in-progress' | 'paused' | 'met' | 'not_met' | 'cancelled';

export const GOAL_TASK_STATUSES: readonly GoalTaskStatus[] = [
  'pending',
  'in-progress',
  'paused',
  'met',
  'not_met',
  'cancelled',
];

/** Display name for a queue status (UI labels stay language-neutral). */
export const GOAL_STATUS_LABELS: Record<GoalTaskStatus, string> = {
  pending: 'Pending',
  'in-progress': 'In progress',
  paused: 'Paused',
  met: 'Met',
  not_met: 'Not met',
  cancelled: 'Cancelled',
};

/** Mirror of engine QueueTask (meta.json snapshot minus internals). */
export interface GoalTask {
  id: string;
  projectRoot: string;
  goal: string;
  acceptance: string[];
  status: GoalTaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  settledAt?: string;
  outcome?: {
    status: 'met' | 'not_met';
    verdict: GoalIterationVerdict;
    reason?: string;
    iteration?: number;
    settledAt: string;
  };
}

// ---------------------------------------------------------------------------
// Iterations (063 IterationStore) — wire shape of GET /api/goal/tasks/:id/iterations
// ---------------------------------------------------------------------------

export type GoalIterationVerdict = 'met' | 'not_met' | 'impossible' | 'error';

/** Evaluator read-only conclusion (058 ReviewConclusion shape). */
export interface GoalReviewConclusion {
  verdict: GoalIterationVerdict;
  reason: string;
  unmet: string[];
  suggestions: string[];
  evidence: string[];
}

/** Small readable subset of 061 GeneratorRunRecord (developer output + disk evidence). */
export interface GoalGeneratorSnapshot {
  output: string;
  artifactPaths: string[];
  developer?: { memberId?: string; status?: string; stopReason?: string; durationMs?: number };
}

/** Small readable subset of 062 EvaluatorRunRecord (verdict + reasons). */
export interface GoalEvaluatorSnapshot {
  conclusion: GoalReviewConclusion;
}

export interface GoalIteration {
  id: string;
  iteration: number;
  taskId: string;
  createdAt: string;
  verdict: GoalIterationVerdict;
  reason: string;
  evidence: string[];
  outputPath?: string;
  retryCount: number;
  metAfterRetries?: boolean;
  transition?: { from: GoalTaskStatus; to: GoalTaskStatus };
  testResults?: string;
  generator?: GoalGeneratorSnapshot;
  evaluator?: GoalEvaluatorSnapshot;
}

// ---------------------------------------------------------------------------
// Goal run result — wire shape of POST /api/goal/tasks/:id/run
// ---------------------------------------------------------------------------

export interface GoalRunResult {
  queueTask: GoalTask;
  entry?: GoalIteration;
  record?: { taskId: string; iterations: GoalIteration[] };
  outcome: 'met' | 'not_met' | 'stopped' | 'error';
  error?: string;
}

// ---------------------------------------------------------------------------
// Pure selectors
// ---------------------------------------------------------------------------

/** Sort tasks newest first (server sorts; belt-and-braces here). */
export function sortGoalTasks(tasks: GoalTask[]): GoalTask[] {
  return [...tasks].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
}

/** Replay order is already 1..n; defensive sort by iteration number. */
export function sortIterations(iterations: GoalIteration[]): GoalIteration[] {
  return [...iterations].sort((a, b) => a.iteration - b.iteration);
}

/** Friendly verdict label (met / not met / …). */
export function goalVerdictDisplay(verdict: GoalIterationVerdict): string {
  switch (verdict) {
    case 'met':
      return 'Met';
    case 'not_met':
      return 'Not met';
    case 'impossible':
      return 'Impossible';
    case 'error':
      return 'Error';
    default:
      return verdict;
  }
}

/** One-line task queue row helper: goal + status label + age. */
export function goalTaskSummary(task: GoalTask): string {
  const status = GOAL_STATUS_LABELS[task.status] ?? task.status;
  const tail =
    task.status === 'in-progress'
      ? 'running…'
      : task.outcome?.status
        ? `${task.outcome.status} · ${task.outcome.reason ?? ''}`.trim()
        : GOAL_STATUS_LABELS[task.status];
  return `${status} · ${tail || status}`;
}

/** Status class for CSS (sanitized: dash → keep, lowercased). */
export function goalStatusClass(status: GoalTaskStatus): string {
  return `goal-status-${status}`;
}

/** Is this queue status one the run button may act on (pending/in-progress)? */
export function goalRunnable(status: GoalTaskStatus): boolean {
  return status === 'pending' || status === 'in-progress';
}

/** Number of artifacts a generator produced (readable count), 0-safe. */
export function generatorArtifactCount(gen?: GoalGeneratorSnapshot): number {
  return gen?.artifactPaths?.length ?? 0;
}

/** Generator output one-line summary (first non-empty line, capped). */
export function generatorOutputSummary(gen?: GoalGeneratorSnapshot, max = 120): string {
  const output = gen?.output;
  if (!output) return '';
  const firstLine = output.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine;
}

/** Evaluator conclusion: verdict label (+ reason). */
export function evaluatorConclusionText(evalSnap?: GoalEvaluatorSnapshot): string {
  const c = evalSnap?.conclusion;
  if (!c) return '';
  const base = goalVerdictDisplay(c.verdict);
  return c.reason ? `${base} — ${c.reason}` : base;
}

// ---------------------------------------------------------------------------
// 066 control seam — pause/resume/budget (+ budget wire type)
// ---------------------------------------------------------------------------

/** maxIterations/maxRetries budget (066, §11.1 default 1/1). */
export interface GoalBudget {
  maxIterations: number;
  maxRetries: number;
}

/** Goal loop control ids (066 — wired to the local server endpoints). */
export type GoalControlId = 'pause' | 'resume' | 'budget';

/** A control button's render description (enabled per run/running state). */
export interface GoalControlSeam {
  id: GoalControlId;
  label: string;
  /** enabled when a live run is running (pause) / paused (resume); budget always */
  enabled: boolean;
  /** hint shown in the UI */
  hint: string;
}

export const GOAL_CONTROL_SEAM: readonly GoalControlSeam[] = [
  { id: 'pause', label: 'Pause', enabled: true, hint: 'Suspend the running task (not an abort)' },
  { id: 'resume', label: 'Resume', enabled: true, hint: 'Continue a paused task from the same boundary' },
  { id: 'budget', label: 'Budget', enabled: true, hint: 'Query/set maxIterations & maxRetries ($11.1 default 1/1)' },
];

/** Which controls are usable for a given queue status (gate the enable flags). */
export function goalControlEnabled(
  controls: readonly GoalControlSeam[],
  status: GoalTaskStatus,
  running: boolean,
): readonly GoalControlSeam[] {
  return controls.map((c) => {
    if (c.id === 'pause') return { ...c, enabled: running && status === 'in-progress' };
    if (c.id === 'resume') return { ...c, enabled: running && status === 'paused' };
    // budget is always available (query/set on a task whether or not it is live)
    return { ...c, enabled: true };
  });
}

/** Friendly budget line for the UI (default §11.1 1/1). */
export function budgetDisplay(budget?: GoalBudget): string {
  if (!budget) return '1 / 1';
  return `${budget.maxIterations} / ${budget.maxRetries}`;
}

/** Normalize a raw task list (tolerant of partial/junk entries). */
export function normalizeGoalTasks(raw: unknown): GoalTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is GoalTask => !!t && typeof t === 'object' && typeof (t as GoalTask).id === 'string');
}