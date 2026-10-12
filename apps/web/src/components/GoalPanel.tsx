import { localizedValue } from '../i18n';
import { useI18n } from './LanguageProvider';
import {
  generatorArtifactCount,
  generatorOutputSummary,
  goalControlEnabled,
  goalStatusClass,
  GOAL_CONTROL_SEAM,
  sortIterations,
  type GoalIteration,
  type GoalReviewConclusion,
  type GoalTask,
} from '../goal';

/**
 * Goal panel (task 065) — renders a task queue + the selected task's iteration
 * replay (generator output summary / evaluator met·not_met·reason). Presentational
 * only: all data mounts come from <GoalModule>. Friendly empty states + the
 * 066 run-control seam (pause/resume/budget, wired via onPause/onResume/onBudget).
 */
export default function GoalPanel({
  tasks,
  selectedId,
  iterations,
  running,
  busy,
  onSelect,
  onRun,
  onPause,
  onResume,
  onBudget,
  budget,
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
  /** task 066: control the selected task's live run */
  onPause: () => void;
  onResume: () => void;
  onBudget: () => void;
  /** current budget (maxIterations/maxRetries) of the selected task */
  budget?: { maxIterations: number; maxRetries: number };
  enqueueCancelled: boolean;
}) {
  const { t } = useI18n();
  const selected = tasks.find((t) => t.id === selectedId) ?? null;
  const controls = selected
    ? goalControlEnabled(GOAL_CONTROL_SEAM, selected.status, running)
    : GOAL_CONTROL_SEAM;

  return (
    <div className="goal-panel" data-testid="goal-panel">
      <div className="goal-queue">
        <div className="goal-queue-head">
          <span className="goal-label">{t('uiTaskQueue')}</span>
          <span className="dim">{t('taskCount', { count: String(tasks.length), plural: tasks.length === 1 ? '' : 's' })}</span>
        </div>
        {enqueueCancelled && (
          <div className="dim goal-note">{t('uiTerminalTasksCanTBeRunRequeueThem')}</div>
        )}
        {tasks.length === 0 ? (
          <div className="goal-empty dim">
            <div className="goal-empty-title">{t('uiNoTasksYet')}</div>
            <div>{t('uiEnqueueAGoalAndRunItEachIteration')}</div>
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
                <span className={`goal-status ${goalStatusClass(task.status)}`}>{localizedValue(task.status, t)}</span>
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
            <span className={`goal-status ${goalStatusClass(selected.status)}`}>{localizedValue(selected.status, t)}</span>
          </div>
          {selected.outcome?.reason && <div className="dim goal-outcome-reason">{selected.outcome.reason}</div>}
          <div className="goal-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || running || !runnable(selected.status)}
              onClick={onRun}
            >
              {running ? t('uiRunning') : t('uiRunTask')}
            </button>
            {!runnable(selected.status) && (
              <span className="dim goal-run-hint">&#8226; {localizedValue(selected.status, t)} — {t('terminalTask')}</span>
            )}
            {/* 066 run control — pause/resume/budget wired to the API */}
            <span className="goal-controls">
              {controls.map((ctl) => {
                const handler = ctl.id === 'pause' ? onPause : ctl.id === 'resume' ? onResume : onBudget;
                return (
                  <button
                    key={ctl.id}
                    type="button"
                    className="btn goal-control-btn"
                    disabled={busy || !ctl.enabled}
                    onClick={handler}
                    title={t(({ pause: 'pauseHint', resume: 'resumeHint', budget: 'budgetHint' } as const)[ctl.id])}
                  >
                    {t(ctl.id)}
                    {ctl.id === 'budget' && budget ? (
                      <span className="goal-budget-line"> {budget.maxIterations}/{budget.maxRetries}</span>
                    ) : null}
                  </button>
                );
              })}
            </span>
          </div>

          <div className="goal-iterations">
            <div className="goal-label">{t('uiIterations')}</div>
            {iterations.length === 0 ? (
              <div className="goal-empty dim" data-testid="goal-iterations-empty">
                <div className="goal-empty-title">{t('uiNoIterationsYet')}</div>
                <div>{t('uiRunThisTaskToProduceTheFirstIteration')}</div>
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
              <span className="goal-label">{t('uiAcceptance')}</span>
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
  const { t } = useI18n();
  return (
    <div className="goal-iteration" data-testid="goal-iteration">
      <div className="goal-iteration-head">
        <span className="goal-iteration-num">#{iteration.iteration}</span>
        <span className={`goal-verdict goal-verdict-${iteration.verdict}`}>{localizedValue(iteration.verdict, t)}</span>
        {iteration.metAfterRetries && <span className="dim">{t('uiAfterRetries')}</span>}
        {iteration.transition && (
          <span className="dim">· {localizedValue(iteration.transition.from, t)} &rarr; {localizedValue(iteration.transition.to, t)}</span>
        )}
      </div>
      {iteration.reason && <div className="goal-iteration-reason dim">{iteration.reason}</div>}

      <div className="goal-gen-eval">
        <div className="goal-gen">
          <span className="goal-label">{t('uiGenerator')}</span>
          {iteration.generator ? (
            <div className="goal-pre" title={t('uiGeneratorOutputSummary')}>
              {generatorOutputSummary(iteration.generator)}
            </div>
          ) : (
            <div className="dim">{t('uiNoGeneratorSnapshot')}</div>
          )}
          {iteration.generator && (
            <div className="goal-artifact-count dim">
              {t('artifactCount', { count: String(generatorArtifactCount(iteration.generator)), plural: generatorArtifactCount(iteration.generator) === 1 ? '' : 's' })} </div>
          )}
        </div>
        <div className="goal-eval">
          <span className="goal-label">{t('uiEvaluator')}</span>
          {iteration.evaluator ? (
            <EvaluationBlock conclusion={iteration.evaluator.conclusion} />
          ) : (
            <div className="dim">{t('uiNoEvaluatorSnapshot')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Structured evaluator conclusion (058 shape: verdict + unmet + suggestions). */
function EvaluationBlock({ conclusion }: { conclusion: GoalReviewConclusion }) {
  const { t } = useI18n();
  return (
    <div className={`goal-review goal-review-${conclusion.verdict}`}>
      <div className="goal-review-verdict">{localizedValue(conclusion.verdict, t)}</div>
      {conclusion.reason && <div className="goal-review-reason dim">{conclusion.reason}</div>}
      {conclusion.unmet.length > 0 && (
        <ul className="goal-review-list">
          {conclusion.unmet.map((u) => (
            <li key={u}>{t('uiUnmet')} {u}</li>
          ))}
        </ul>
      )}
      {conclusion.suggestions.length > 0 && (
        <ul className="goal-review-list">
          {conclusion.suggestions.map((s) => (
            <li key={s}>{t('uiSuggest')} {s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}