import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
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

describe('GoalPanel (task 065 panel rendering)', () => {
  it('renders a friendly empty state when there are no tasks', () => {
    const html = render(<GoalPanel tasks={[]} selectedId={null} iterations={[]} running={false} busy={false} onSelect={noop} onRun={noop} enqueueCancelled={false} />);
    expect(html).toContain('No tasks yet');
    expect(html).toContain('0 tasks');
    expect(html).not.toContain('goal-task-row-active');
  });

  it('renders the queue with status labels + goal text and highlights the selected row', () => {
    const tasks: GoalTask[] = [goalTaskFixture({ id: 'a' }), goalTaskMetFixture()];
    const html = render(<GoalPanel tasks={tasks} selectedId="a" iterations={[]} running={false} busy={false} onSelect={noop} onRun={noop} enqueueCancelled={false} />);
    expect(html).toContain('2 tasks');
    expect(html).toContain('Pending');
    expect(html).toContain('Met');
    expect(html).toContain('goal-task-row-active');
    // queue rows are buttons (selectable)
    expect(html).toContain('<button');
  });

  it('selected task detail shows the run trigger + terminal-task hint + 066 placeholders', () => {
    // a met (terminal) task: Run disabled + "not available" hint + pause/resume/budget placeholders
    const html = render(<GoalPanel tasks={[goalTaskMetFixture()]} selectedId="task_2" iterations={[]} running={false} busy={false} onSelect={noop} onRun={noop} enqueueCancelled={false} />);
    expect(html).toContain('goal-detail');
    expect(html).toContain('Met');
    expect(html).toContain('Run task');
    expect(html).toContain('not available on a terminal task');
    // 066 reserved control seam labels present and disabled
    expect(html).toContain('Pause');
    expect(html).toContain('Resume');
    expect(html).toContain('Budget');
    expect(html).toContain('disabled');
    expect(html).toContain('066');
  });

  it('renders a pending selected task with an enabled Run button', () => {
    const html = render(<GoalPanel tasks={[goalTaskFixture()]} selectedId="task_1" iterations={[]} running={false} busy={false} onSelect={noop} onRun={noop} enqueueCancelled={false} />);
    expect(html).toContain('Pending');
    expect(html).toContain('Run task');
    expect(html).not.toContain('not available on a terminal task');
  });

  it('iteration replay shows generator output summary + evaluator verdict/reason (met + not_met)', () => {
    const html = render(
      <GoalPanel
        tasks={[goalTaskFixture(), goalTaskMetFixture()]}
        selectedId="task_1"
        iterations={[goalIterationNotMetFixture(), goalIterationMetFixture()]}
        running={false}
        busy={false}
        onSelect={noop}
        onRun={noop}
       
        enqueueCancelled={false}
      />,
    );
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
    const html = render(<GoalPanel tasks={[goalTaskFixture()]} selectedId="task_1" iterations={[]} running={false} busy={false} onSelect={noop} onRun={noop} enqueueCancelled={false} />);
    expect(html).toContain('No iterations yet');
    expect(html).toContain('goal-iterations-empty');
  });

  it('running=true renders the Running… label on the trigger button', () => {
    const html = render(<GoalPanel tasks={[goalTaskFixture({ status: 'in-progress' })]} selectedId="task_1" iterations={[]} running busy={false} onSelect={noop} onRun={noop} enqueueCancelled={false} />);
    expect(html).toContain('Running…');
    expect((html.match(/disabled/g) ?? []).length).toBeGreaterThan(0);
  });

  it('renders acceptance criteria for a selected task', () => {
    const html = render(<GoalPanel tasks={[goalTaskFixture()]} selectedId="task_1" iterations={[]} running={false} busy={false} onSelect={noop} onRun={noop} enqueueCancelled={false} />);
    expect(html).toContain('Acceptance');
    expect(html).toContain('AC-1 导出 run');
  });
});