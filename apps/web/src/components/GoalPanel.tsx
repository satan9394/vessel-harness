import {
  generatorArtifactCount,
  generatorOutputSummary,
  goalStatusClass,
  goalVerdictDisplay,
  GOAL_CONTROL_SEAM,
  GOAL_STATUS_LABELS,
  sortIterations,
  type GoalIteration,
  type GoalReviewConclusion,
  type GoalTask,
} from '../goal';

/**
 * Goal panel (task 065) — renders a task queue + the selected task's iteration
 * replay (generator output summary / evaluator met·not_met·reason). Presentational
 * only: all data mounts come from <GoalModule>. Friendly empty states + the
 * reserved 066 control seam (pause/resume/budget as disabled placeholders).
 */
export default function GoalPanel({
  tasks,
  selectedId,
  iterations,
  running,
  busy,
  onSelect,
  onRun,
  enqueueCancelled,
}: {
  tasks: GoalTask[];
  /** currently selected task id (detail view) */
  selectedId: string | null;
  /** replay of the selected task's iterations */
  iterations: GoalIteration[];
  /** a run is executing for the selected task */
  running: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onRun: () => void;
  enqueueCancelled: boolean;
}) {
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="goal-panel" data-testid="goal-panel">
      <div className="goal-queue">
        <div className="goal-queue-head">
          <span className="goal-label">Task queue</span>
          <span className="dim">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
        </div>
        {enqueueCancelled && (
          <div className="dim goal-note">Terminal tasks can't be run — requeue them first (runtime).</div>
        )}
        {tasks.length === 0 ? (
          <div className="goal-empty dim">
            <div className="goal-empty-title">No tasks yet</div>
            <div>Enqueue a goal and run it — each iteration shows the generator output and the evaluator verdict.</div>
          </div>
        ) : (
          <div className="goal-task-list">
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className={`goal-task-row${task.id === selectedId ? ' goal-task-row-active' : ''}`}
                onClick={() => onSelect(task.id)}
                title={task.goal}
              >
                <span className={`goal-status ${goalStatusClass(task.status)}`}>{GOAL_STATUS_LABELS[task.status]}</span>
                <span className="goal-task-goal">{task.goal}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className="goal-detail" data-testid="goal-detail">
          <div className="goal-detail-head">
            <span className="goal-task-title" title={selected.goal}>
              {selected.goal}
            </span>
            <span className={`goal-status ${goalStatusClass(selected.status)}`}>{GOAL_STATUS_LABELS[selected.status]}</span>
          </div>
          {selected.outcome?.reason && <div className="dim goal-outcome-reason">{selected.outcome.reason}</div>}
          <div className="goal-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || running || !runnable(selected.status)}
              onClick={onRun}
            >
              {running ? 'Running…' : 'Run task'}
            </button>
            {!runnable(selected.status) && (
              <span className="dim goal-run-hint">&#8226; {selected.status} &mdash; run not available on a terminal task</span>
            )}
            {/* 066 seam — reserved control placeholders, disabled until task 066 */}
            <span className="goal-controls">
              {GOAL_CONTROL_SEAM.map((ctl) => (
                <button key={ctl.id} type="button" className="btn goal-control-btn" disabled title={ctl.reservedText}>
                  {ctl.label}
                  <span className="goal-control-reserved"> 066</span>
                </button>
              ))}
            </span>
          </div>

          <div className="goal-iterations">
            <div className="goal-label">Iterations</div>
            {iterations.length === 0 ? (
              <div className="goal-empty dim" data-testid="goal-iterations-empty">
                <div className="goal-empty-title">No iterations yet</div>
                <div>Run this task to produce the first iteration (gen &rarr; eval &rarr; met/not_met).</div>
              </div>
            ) : (
              <div className="goal-iterations-list">
                {sortIterations(iterations).map((it) => (
                  <IterationRow key={it.id} iteration={it} />
                ))}
              </div>
            )}
          </div>

          {selected.acceptance.length > 0 && (
            <div className="goal-acceptance dim">
              <span className="goal-label">Acceptance</span>
              <ul className="goal-acceptance-list">
                {selected.acceptance.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function runnable(status: GoalTask['status']): boolean {
  return status === 'pending' || status === 'in-progress';
}

/** One persisted iteration (063) — generator summary + evaluator verdict/reason. */
function IterationRow({ iteration }: { iteration: GoalIteration }) {
  return (
    <div className="goal-iteration" data-testid="goal-iteration">
      <div className="goal-iteration-head">
        <span className="goal-iteration-num">#{iteration.iteration}</span>
        <span className={`goal-verdict goal-verdict-${iteration.verdict}`}>{goalVerdictDisplay(iteration.verdict)}</span>
        {iteration.metAfterRetries && <span className="dim">· after retries</span>}
        {iteration.transition && (
          <span className="dim">· {iteration.transition.from} &rarr; {iteration.transition.to}</span>
        )}
      </div>
      {iteration.reason && <div className="goal-iteration-reason dim">{iteration.reason}</div>}

      <div className="goal-gen-eval">
        <div className="goal-gen">
          <span className="goal-label">Generator</span>
          {iteration.generator ? (
            <div className="goal-pre" title="generator output summary">
              {generatorOutputSummary(iteration.generator)}
            </div>
          ) : (
            <div className="dim">(no generator snapshot)</div>
          )}
          {iteration.generator && (
            <div className="goal-artifact-count dim">
              {generatorArtifactCount(iteration.generator)} artifact{generatorArtifactCount(iteration.generator) === 1 ? '' : 's'} on disk
            </div>
          )}
        </div>
        <div className="goal-eval">
          <span className="goal-label">Evaluator</span>
          {iteration.evaluator ? (
            <EvaluationBlock conclusion={iteration.evaluator.conclusion} />
          ) : (
            <div className="dim">(no evaluator snapshot)</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Structured evaluator conclusion (058 shape: verdict + unmet + suggestions). */
function EvaluationBlock({ conclusion }: { conclusion: GoalReviewConclusion }) {
  return (
    <div className={`goal-review goal-review-${conclusion.verdict}`}>
      <div className="goal-review-verdict">{goalVerdictDisplay(conclusion.verdict)}</div>
      {conclusion.reason && <div className="goal-review-reason dim">{conclusion.reason}</div>}
      {conclusion.unmet.length > 0 && (
        <ul className="goal-review-list">
          {conclusion.unmet.map((u) => (
            <li key={u}>unmet: {u}</li>
          ))}
        </ul>
      )}
      {conclusion.suggestions.length > 0 && (
        <ul className="goal-review-list">
          {conclusion.suggestions.map((s) => (
            <li key={s}>suggest: {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}