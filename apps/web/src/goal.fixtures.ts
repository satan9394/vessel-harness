/**
 * Test fixtures (task 065) — GoalTask / GoalIteration samples shaped like 063
 * ProjectTaskQueue + IterationStore (with 061 generator + 062 evaluator
 * snapshots). Shared by the pure-selector tests and the component render tests.
 */
import type { GoalIteration, GoalTask } from './goal';

export function goalTaskFixture(overrides: Partial<GoalTask> = {}): GoalTask {
  return {
    id: 'task_1',
    projectRoot: '/tmp/ws',
    goal: '实现一个导出功能',
    acceptance: ['AC-1 导出 run'],
    status: 'pending',
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  };
}

export function goalTaskMetFixture(): GoalTask {
  return goalTaskFixture({
    id: 'task_2',
    goal: '重构模块并补测试',
    status: 'met',
    settledAt: '2026-09-08T01:00:00.000Z',
    outcome: {
      status: 'met',
      verdict: 'met',
      reason: '验收标准满足',
      iteration: 1,
      settledAt: '2026-09-08T01:00:00.000Z',
    },
  });
}

export function goalIterationNotMetFixture(): GoalIteration {
  return {
    id: 'iter_1',
    iteration: 1,
    taskId: 'task_1',
    createdAt: '2026-09-08T00:05:00.000Z',
    verdict: 'not_met',
    reason: '缺测试证据',
    evidence: [],
    outputPath: '/tmp/ws-out',
    retryCount: 1,
    transition: { from: 'in-progress', to: 'not_met' },
    generator: {
      output: '已实现导出（src/out.ts）\n补充了文档',
      artifactPaths: ['src/out.ts'],
      developer: { memberId: 'developer', status: 'completed' },
    },
    evaluator: {
      conclusion: {
        verdict: 'not_met',
        reason: '缺测试证据',
        unmet: ['AC-2 无测试结果'],
        suggestions: ['补单测'],
        evidence: [],
      },
    },
  };
}

export function goalIterationMetFixture(): GoalIteration {
  return {
    id: 'iter_2',
    iteration: 2,
    taskId: 'task_2',
    createdAt: '2026-09-08T01:00:00.000Z',
    verdict: 'met',
    reason: '验收标准满足',
    evidence: ['AC-1'],
    retryCount: 1,
    metAfterRetries: true,
    transition: { from: 'in-progress', to: 'met' },
    generator: {
      output: '重构完成，单测通过',
      artifactPaths: ['src/refactored.ts', 'src/refactored.test.ts'],
    },
    evaluator: {
      conclusion: { verdict: 'met', reason: '验收标准满足', unmet: [], suggestions: [], evidence: ['AC-1'] },
    },
  };
}