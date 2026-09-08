import { describe, it, expect } from 'vitest';
import {
  evaluatorConclusionText,
  generatorArtifactCount,
  generatorOutputSummary,
  goalRunnable,
  goalStatusClass,
  goalTaskSummary,
  goalVerdictDisplay,
  GOAL_CONTROL_SEAM,
  normalizeGoalTasks,
  sortGoalTasks,
  sortIterations,
} from './goal';
import { goalIterationMetFixture, goalIterationNotMetFixture, goalTaskFixture, goalTaskMetFixture } from './goal.fixtures';

describe('goal pure selectors (task 065 data consumption)', () => {
  it('sortGoalTasks orders newest first even when the server list is shuffled', () => {
    const newest = goalTaskFixture({ id: 't2', createdAt: '2026-09-09T00:00:00.000Z' });
    const middle = goalTaskFixture({ id: 't1', createdAt: '2026-09-08T00:00:00.000Z' });
    const oldest = goalTaskFixture({ id: 't0', createdAt: '2026-09-07T00:00:00.000Z' });
    expect(sortGoalTasks([oldest, newest, middle]).map((t) => t.id)).toEqual(['t2', 't1', 't0']);
  });

  it('sortIterations returns 1..n order regardless of input order', () => {
    const a = goalIterationNotMetFixture();
    const b = goalIterationMetFixture();
    expect(sortIterations([b, a]).map((i) => i.iteration)).toEqual([1, 2]);
  });

  it('goalVerdictDisplay maps met/not_met/impossible/error to friendly labels', () => {
    expect(goalVerdictDisplay('met')).toBe('Met');
    expect(goalVerdictDisplay('not_met')).toBe('Not met');
    expect(goalVerdictDisplay('impossible')).toBe('Impossible');
    expect(goalVerdictDisplay('error')).toBe('Error');
  });

  it('goalTaskSummary mixes status label + settled outcome', () => {
    expect(goalTaskSummary(goalTaskFixture())).toContain('Pending');
    expect(goalTaskSummary({ ...goalTaskFixture(), status: 'in-progress' })).toContain('running');
    expect(goalTaskSummary(goalTaskMetFixture())).toContain('met');
  });

  it('goalStatusClass + goalRunnable gate the Run trigger by queue status', () => {
    expect(goalStatusClass('pending')).toBe('goal-status-pending');
    expect(goalStatusClass('not_met')).toBe('goal-status-not_met');
    expect(goalRunnable('pending')).toBe(true);
    expect(goalRunnable('in-progress')).toBe(true);
    expect(goalRunnable('met')).toBe(false);
    expect(goalRunnable('not_met')).toBe(false);
    expect(goalRunnable('cancelled')).toBe(false);
  });

  it('generator helpers produce a readable output summary + artifact count', () => {
    const it = goalIterationMetFixture();
    expect(generatorArtifactCount(it.generator)).toBe(2);
    expect(generatorOutputSummary(it.generator)).toBe('重构完成，单测通过');
    expect(generatorOutputSummary(undefined)).toBe('');
    expect(generatorOutputSummary({ output: 'first line\nsecond', artifactPaths: [] })).toBe('first line');
  });

  it('evaluatorConclusionText prefixes the verdict with the reason', () => {
    expect(evaluatorConclusionText(goalIterationNotMetFixture().evaluator)).toBe('Not met — 缺测试证据');
    expect(evaluatorConclusionText(goalIterationMetFixture().evaluator)).toBe('Met — 验收标准满足');
    expect(evaluatorConclusionText(undefined)).toBe('');
  });

  it('normalizeGoalTasks drops junk entries and keeps well-formed ones', () => {
    const good = goalTaskFixture();
    const bad = { nope: true };
    expect(normalizeGoalTasks([bad, good, 42, null])).toEqual([good]);
    expect(normalizeGoalTasks(null)).toEqual([]);
  });

  it('GOAL_CONTROL_SEAM is the reserved 066 placeholder set (never enabled)', () => {
    expect(GOAL_CONTROL_SEAM.map((c) => c.id)).toEqual(['pause', 'resume', 'budget']);
    expect(GOAL_CONTROL_SEAM.every((c) => c.enabled === false)).toBe(true);
    expect(GOAL_CONTROL_SEAM.every((c) => c.reservedText.includes('066'))).toBe(true);
  });
});