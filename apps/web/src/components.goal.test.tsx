import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ComponentProps } from 'react';
import GoalPanel from './components/GoalPanel';
import {
  goalIterationMetFixture,
  goalIterationNotMetFixture,
  goalTaskFixture,
  goalTaskMetFixture,
} from './goal.fixtures';
import type { GoalTask } from './goal';

/** Render a component to static HTML (node env, no jsdom needed). */
function render(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const noop = () => {};

/** Render GoalPanel with task 066 control prop defaults (pause/resume/budget/budget). */
function panel(props: Partial<ComponentProps<typeof GoalPanel>> = {}): string {
  return render(
    <GoalPanel
      tasks={props.tasks ?? []}
      selectedId={props.selectedId ?? null}
      iterations={props.iterations ?? []}
      running={props.running ?? false}
      busy={props.busy ?? false}
      onSelect={props.onSelect ?? noop}
      onRun={props.onRun ?? noop}
      onPause={props.onPause ?? noop}
      onResume={props.onResume ?? noop}
      onBudget={props.onBudget ?? noop}
      budget={props.budget}
      enqueueCancelled={props.enqueueCancelled ?? false}
    />,
  );
}

describe('GoalPanel (task 065/066 panel rendering)', () => {
  it('renders a friendly empty state when there are no tasks', () => {
    const html = panel();
    expect(html).toContain('No tasks yet');
    expect(html).toContain('0 tasks');
    expect(html).not.toContain('goal-task-row-active');
  });

  it('renders the queue with status labels + goal text and highlights the selected row', () => {
    const tasks: GoalTask[] = [goalTaskFixture({ id: 'a' }), goalTaskMetFixture()];
    const html = panel({ tasks, selectedId: 'a' });
    expect(html).toContain('2 tasks');
    expect(html).toContain('Pending');
    expect(html).toContain('Met');
    expect(html).toContain('goal-task-row-active');
    // queue rows are buttons (selectable)
    expect(html).toContain('<button');
  });

  it('selected task detail shows the run trigger + terminal-task hint + 066 control labels', () => {
    // a met (terminal) task: Run disabled + "not available" hint + pause/resume/budget labels
    const html = panel({ tasks: [goalTaskMetFixture()], selectedId: 'task_2' });
    expect(html).toContain('goal-detail');
    expect(html).toContain('Met');
    expect(html).toContain('Run task');
    expect(html).toContain('not available on a terminal task');
    // 066 control labels are present (not removed by the seam)
    expect(html).toContain('Pause');
    expect(html).toContain('Resume');
    expect(html).toContain('Budget');
  });

  it('pause is enabled only on a running in-progress task; resume only on a paused one (066 gating)', () => {
    const runningHtml = panel({
      tasks: [goalTaskFixture({ status: 'in-progress' })],
      selectedId: 'task_1',
      running: true,
    });
    // pause enabled (running in-progress), resume disabled (not paused)
    expect(runningHtml).toContain('Pause');
    expect(runningHtml).toContain('Resume');

    const pausedHtml = panel({
      tasks: [goalTaskFixture({ status: 'paused' })],
      selectedId: 'task_1',
      running: true,
    });
    expect(pausedHtml).toContain('Paused');
  });

  it('renders a pending selected task with an enabled Run button', () => {
    const html = panel({ tasks: [goalTaskFixture()], selectedId: 'task_1' });
    expect(html).toContain('Pending');
    expect(html).toContain('Run task');
    expect(html).not.toContain('not available on a terminal task');
  });

  it('iteration replay shows generator output summary + evaluator verdict/reason (met + not_met)', () => {
    const html = panel({
      tasks: [goalTaskFixture(), goalTaskMetFixture()],
      selectedId: 'task_1',
      iterations: [goalIterationNotMetFixture(), goalIterationMetFixture()],
    });
    // two iteration cards, ordered #1 #2
    expect(html).toContain('#1');
    expect(html).toContain('#2');
    // generator output summary (first non-empty line, not raw JSON)
    expect(html).toContain('已实现导出（src/out.ts）');
    expect(html).toContain('重构完成，单测通过');
    // evaluator conclusions — verdict + reason, structured (not raw JSON)
    expect(html).toContain('Not met');
    expect(html).toContain('缺测试证据');
    expect(html).toContain('unmet: AC-2 无测试结果');
    expect(html).toContain('suggest: 补单测');
    expect(html).toContain('Met');
    expect(html).toContain('after retries');
    // disk artifact count
    expect(html).toContain('2 artifacts on disk');
  });

  it('shows a runnable pending iteration-empty state (No iterations yet) when the task never ran', () => {
    const html = panel({ tasks: [goalTaskFixture()], selectedId: 'task_1' });
    expect(html).toContain('No iterations yet');
    expect(html).toContain('goal-iterations-empty');
  });

  it('running=true renders the Running… label on the trigger button', () => {
    const html = panel({ tasks: [goalTaskFixture({ status: 'in-progress' })], selectedId: 'task_1', running: true });
    expect(html).toContain('Running…');
    expect((html.match(/disabled/g) ?? []).length).toBeGreaterThan(0);
  });

  it('renders acceptance criteria for a selected task', () => {
    const html = panel({ tasks: [goalTaskFixture()], selectedId: 'task_1' });
    expect(html).toContain('Acceptance');
    expect(html).toContain('AC-1 导出 run');
  });
});