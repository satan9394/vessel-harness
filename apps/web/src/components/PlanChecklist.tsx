import { useI18n } from './LanguageProvider';
import { useEffect, useState } from 'react';
import { sortGoalTasks, type GoalTask } from '../goal';
import type { ApiClient } from '../api';

/**
 * Central-process plan checklist (P4, DESIGN.md §4.1).
 *
 * The always-on "where are we now" strip above the message stream — borrowed
 * from Claude Code's persistent todo list. Data source is the real Goal/task
 * queue (`GET /api/goal/tasks`, mirrored by `goal.ts`), so nothing here invents
 * state: every row is a real queue task.
 */
export type PlanStepState = 'done' | 'current' | 'todo';

export interface PlanStep {
  id: string;
  label: string;
  state: PlanStepState;
  meta?: string;
}

/** Pure: map queue tasks → plan steps (newest activity first, like the queue). */
export function derivePlanSteps(tasks: GoalTask[]): PlanStep[] {
  return sortGoalTasks(tasks).map((task) => ({
    id: task.id,
    label: task.goal,
    state: planStepState(task.status),
    meta: elapsedText(task.startedAt ?? task.createdAt, task.settledAt),
  }));
}

/** Queue status → the checklist state (terminal states count as done). */
export function planStepState(status: GoalTask['status']): PlanStepState {
  switch (status) {
    case 'met':
    case 'not_met':
    case 'cancelled':
      return 'done';
    case 'in-progress':
    case 'paused':
      return 'current';
    default:
      return 'todo';
  }
}

/** `mm:ss` for sub-hour runs, `h:mm:ss` beyond — compact enough for a step row. */
export function elapsedText(start?: string, end?: string): string | undefined {
  if (!start) return undefined;
  const from = Date.parse(start);
  const to = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  const total = Math.max(0, Math.round((to - from) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const GLYPH: Record<PlanStepState, string> = { done: '✓', current: '●', todo: '·' };

/** `done / total` for the always-on meter row (P5). */
export function planProgress(tasks: GoalTask[]): { done: number; total: number } {
  const steps = derivePlanSteps(tasks);
  return { done: steps.filter((step) => step.state === 'done').length, total: steps.length };
}

/** Presentational strip — pure, so tests can render static markup. */
export function PlanStrip({ tasks }: { tasks: GoalTask[] }) {
  const { t } = useI18n();
  const steps = derivePlanSteps(tasks);
  const done = steps.filter((step) => step.state === 'done').length;
  return (
    <section className="plan-checklist" aria-label={t('uiPlan')} data-plan-steps={steps.length}>
      <div className="plan-head">
        <span className="plan-title">{t('uiPlanProgress', { done: String(done), total: String(steps.length) })}</span>
      </div>
      {steps.length === 0 ? (
        <p className="plan-empty dim">{t('uiPlanEmpty')}</p>
      ) : (
        <ol className="plan-steps">
          {steps.map((step) => (
            <li key={step.id} className={`plan-step plan-step-${step.state}`} data-step-state={step.state} title={step.label}>
              <span className="plan-glyph" aria-hidden="true">{GLYPH[step.state]}</span>
              <span className="plan-label">{step.label}</span>
              <span className="plan-meta dim">{step.meta}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Data hook for the plan strip. Reads the real Goal queue scoped to the
 * session's project workspace root, exactly like `GoalModule` — the same
 * `/api/goal/tasks` source, surfaced at the top of the process stream.
 */
export function usePlanTasks(api: ApiClient, sessionId?: string | null, revision?: number): GoalTask[] {
  const [tasks, setTasks] = useState<GoalTask[]>([]);
  useEffect(() => {
    if (!sessionId) { setTasks([]); return; }
    let alive = true;
    void Promise.resolve(api.sessions?.())
      .then(({ sessions }) => sessions.find((s) => s.id === sessionId)?.workspaceRoot)
      .then((root) => api.listGoalTasks?.(root ?? undefined))
      .then(({ tasks: list }) => { if (alive) setTasks(sortGoalTasks(list ?? [])); })
      .catch(() => { /* best effort: the empty plan renders the next-step hint */ });
    return () => { alive = false; };
  }, [api, sessionId, revision]);
  return tasks;
}

/** Data mount for the plan strip. */
export default function PlanChecklist({ sessionId, api, revision }: { sessionId?: string | null; api: ApiClient; revision?: number }) {
  return <PlanStrip tasks={usePlanTasks(api, sessionId, revision)} />;
}
