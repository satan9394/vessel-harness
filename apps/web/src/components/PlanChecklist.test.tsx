// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageProvider } from './LanguageProvider';
import { LANG_STORAGE_KEY } from '../i18n';
import type { ReactNode } from 'react';
import PlanChecklist, { derivePlanSteps, elapsedText, planStepState, PlanStrip } from './PlanChecklist';
import type { GoalTask } from '../goal';

// 语言必须由测试自己钉住：LanguageProvider 的种子是 navigator.language，
// 在 CI（en-US）下会渲染英文，本地 zh 机器上则通过 —— 这条断言不能依赖宿主 locale。
beforeEach(() => { localStorage.setItem(LANG_STORAGE_KEY, 'zh'); });

function render(node: ReactNode): string {
  return renderToStaticMarkup(<LanguageProvider>{node}</LanguageProvider>);
}

const task = (id: string, status: GoalTask['status'], goal: string, extra: Partial<GoalTask> = {}): GoalTask => ({
  id, projectRoot: 'E:/repo', goal, acceptance: [], status,
  createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', ...extra,
});

describe('P4 persistent plan checklist', () => {
  it('maps queue status onto the three checklist states', () => {
    expect(planStepState('met')).toBe('done');
    expect(planStepState('not_met')).toBe('done');
    expect(planStepState('cancelled')).toBe('done');
    expect(planStepState('in-progress')).toBe('current');
    expect(planStepState('paused')).toBe('current');
    expect(planStepState('pending')).toBe('todo');
  });

  it('derives steps from real queue tasks (newest first) with elapsed time', () => {
    const steps = derivePlanSteps([
      task('a', 'met', 'first', { startedAt: '2026-10-15T00:00:00.000Z', settledAt: '2026-10-15T00:01:30.000Z' }),
      task('b', 'in-progress', 'second', { createdAt: '2026-10-15T00:02:00.000Z' }),
    ]);
    expect(steps.map((s) => s.id)).toEqual(['b', 'a']);
    expect(steps[0]!.state).toBe('current');
    expect(steps[1]!.state).toBe('done');
    expect(steps[1]!.meta).toBe('01:30');
  });

  it('formats elapsed time in mm:ss / h:mm:ss and rejects junk', () => {
    expect(elapsedText('2026-10-15T00:00:00.000Z', '2026-10-15T00:00:05.000Z')).toBe('00:05');
    expect(elapsedText('2026-10-15T00:00:00.000Z', '2026-10-15T01:02:03.000Z')).toBe('1:02:03');
    expect(elapsedText(undefined)).toBeUndefined();
    expect(elapsedText('not-a-date', '2026-10-15T00:00:00.000Z')).toBeUndefined();
  });

  it('renders the persistent plan header with done/total and three-glyph rows', () => {
    const html = render(<PlanStrip tasks={[
      task('a', 'met', 'Already done'),
      task('b', 'in-progress', 'Working now'),
      task('c', 'pending', 'Not started'),
    ]} />);
    expect(html).toContain('plan-checklist');
    expect(html).toContain('data-plan-steps="3"');
    expect(html).toContain('data-step-state="done"');
    expect(html).toContain('data-step-state="current"');
    expect(html).toContain('data-step-state="todo"');
    expect(html).toContain('Already done');
    expect(html).toContain('Working now');
    // done count / total from the i18n template
    expect(html).toMatch(/1\s*\/\s*3/);
  });

  it('shows the next-step hint instead of a fabricated plan when empty', () => {
    const html = render(<PlanStrip tasks={[]} />);
    expect(html).toContain('data-plan-steps="0"');
    expect(html).toContain('plan-empty');
    expect(html).not.toContain('plan-step-');
  });

  it('exposes an i18n-driven accessible name (no hardcoded copy)', () => {
    const en = render(<PlanStrip tasks={[]} />);
    expect(en).toMatch(/aria-label="[^"]+"/);
    // default provider language is zh in this repo's dictionary; assert the plan label is localized.
    expect(en).toContain('计划');
  });

  it('mounts the data-driven checklist without a session (empty, no throw)', () => {
    const api = { sessions: async () => ({ sessions: [] }), listGoalTasks: async () => ({ tasks: [] }) } as never;
    const html = renderToStaticMarkup(<LanguageProvider><PlanChecklist api={api} sessionId={null} /></LanguageProvider>);
    expect(html).toContain('plan-checklist');
  });
});
