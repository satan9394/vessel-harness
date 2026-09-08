/**
 * Test fixtures (task 060) — TeamRunState / RouteView / ReviewRecord samples
 * shaped like 057 TeamProjection + 056 AutoRoute + 059 handoff records. Shared
 * by the pure-selector tests and the component render tests.
 */
import type { ReviewRecord, RouteView, TeamRunState } from './team';

/** A completed medium run (developer + reviewer, review not_met) — 057/058 shape. */
export function mediumTeamFixture(): TeamRunState {
  const now = Date.now();
  return {
    runId: 'team_1',
    task: '实现一个导出功能',
    complexity: 'medium',
    roster: [
      { memberId: 'developer', presetId: 'developer', role: 'generator', tier: 'pro', model: 'mock-pro', providerId: 'mock' },
      { memberId: 'reviewer', presetId: 'reviewer', role: 'evaluator', tier: 'review', model: 'mock-review', providerId: 'mock' },
    ],
    status: 'done',
    outcome: 'completed',
    startedAt: now - 5000,
    endedAt: now,
    durationMs: 5000,
    phases: [
      {
        ordinal: 1,
        phase: 'generate',
        memberId: 'developer',
        presetId: 'developer',
        role: 'generator',
        status: 'completed',
        promptPreview: 'DEV prompt…',
        outputPreview: '已实现导出（src/out.ts）',
        ts: now - 4000,
      },
      {
        ordinal: 2,
        phase: 'evaluate',
        memberId: 'reviewer',
        presetId: 'reviewer',
        role: 'evaluator',
        status: 'completed',
        outputPreview: '{"verdict":"not_met","unmet":["AC-2 无测试结果"],"suggestions":["补单测"],"reason":"缺证据"}',
        review: {
          verdict: 'not_met',
          reason: '缺测试证据',
          unmet: ['AC-2 无测试结果'],
          suggestions: ['补单测'],
          evidence: [],
        },
        ts: now - 1000,
      },
    ],
    turns: [
      { memberId: 'developer', role: 'generator', phase: 'generate', turnId: 't1', kind: 'success', promptPreview: 'DEV…', ts: now - 4000 },
      { memberId: 'reviewer', role: 'evaluator', phase: 'evaluate', turnId: 't2', kind: 'success', promptPreview: 'REV…', ts: now - 1000 },
    ],
    delegates: [],
    toolActivities: [
      { memberId: 'developer', role: 'generator', toolName: 'read_file', status: 'done', ts: now - 3500 },
      { memberId: 'developer', role: 'generator', toolName: 'write_file', status: 'done', ts: now - 2000 },
      { memberId: 'developer', role: 'generator', toolName: 'write_file', status: 'done', ts: now - 1800 },
    ],
  };
}

/** A running complex run (lead done, developer delegate phase live) — 057 delegate shape. */
export function complexRunningFixture(): TeamRunState {
  const now = Date.now();
  return {
    runId: 'team_2',
    task: '做一个复杂架构重构',
    complexity: 'complex',
    roster: [
      { memberId: 'lead', presetId: 'lead', role: 'orchestrator', tier: 'pro', model: 'mock-pro', providerId: 'mock' },
      { memberId: 'developer', presetId: 'developer', role: 'generator', tier: 'pro', model: 'mock-pro', providerId: 'mock' },
      { memberId: 'reviewer', presetId: 'reviewer', role: 'evaluator', tier: 'review', model: 'mock-review', providerId: 'mock' },
    ],
    status: 'running',
    startedAt: now,
    phases: [
      { ordinal: 1, phase: 'orchestrate', memberId: 'lead', presetId: 'lead', role: 'orchestrator', status: 'completed', outputPreview: 'PLAN…', ts: now },
      {
        ordinal: 2,
        phase: 'generate',
        memberId: 'developer',
        presetId: 'developer',
        role: 'generator',
        status: 'running',
        delegateOf: 'lead',
        promptPreview: 'IMPL…',
        ts: now,
      },
    ],
    turns: [
      { memberId: 'lead', role: 'orchestrator', phase: 'orchestrate', turnId: 't1', kind: 'success', promptPreview: 'PLAN…', ts: now },
    ],
    delegates: [
      {
        delegateId: 'del_1',
        parentMemberId: 'lead',
        childSessionId: 's2',
        preset: 'developer',
        status: 'running',
        ts: now,
      },
    ],
    toolActivities: [{ memberId: 'lead', role: 'orchestrator', toolName: 'plan', status: 'done', ts: now }],
  };
}

export function routeFixture(overrides: Partial<RouteView> = {}): RouteView {
  return {
    mode: 'auto',
    category: 'implementation',
    complexity: 'medium',
    roles: ['developer', 'reviewer'],
    roleModels: [
      { role: 'developer', tier: 'pro', providerId: 'mock', model: 'mock-pro', configured: true },
      { role: 'reviewer', tier: 'review', providerId: 'mock', model: 'mock-review', configured: true },
    ],
    primary: { role: 'developer', tier: 'pro', providerId: 'mock', model: 'mock-pro', configured: true },
    hints: [],
    pinned: false,
    ...overrides,
  };
}

export function reviewFixture(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'review_1',
    status: 'pending',
    source: 'external',
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    workspaceRoot: '/tmp/ws',
    task: '实现一个导出功能',
    acceptance: ['AC-1 导出 run'],
    changedFiles: ['src/out.ts'],
    diffSummary: '新增导出函数',
    testResults: '',
    constraints: [],
    checklist: [],
    outputSchema: '{"verdict": …}',
    results: [],
    ...overrides,
  };
}
