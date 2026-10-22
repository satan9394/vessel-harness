import { describe, expect, it } from 'vitest';
import { ActivityRoutes, type ActivitySources } from './activityRoutes.js';

describe('ActivityRoutes (ARCH-01 / UI-02 Truthful Status)', () => {
  const emptySources: ActivitySources = {
    sessions: async () => [], live: () => undefined, approvals: () => [],
    subagents: async () => [], teamStages: () => [], goalTasks: () => [],
  };

  it.each([
    ['approved', undefined, 'unknown', 'queued'],
    ['rejected', undefined, 'failed', 'cancelled'],
    ['finished', [{ status: 'cancelled' }], 'failed', 'cancelled'],
    ['finished', [{ status: 'completed' }, { status: 'cancelled' }], 'failed', 'cancelled'],
    ['finished', [{ status: 'failed' }, { status: 'cancelled' }], 'failed', 'failed'],
    ['finished', undefined, 'unknown', 'unknown'],
    ['finished', [], 'unknown', 'unknown'],
    ['finished', [{ status: 'pending' }], 'unknown', 'unknown'],
    ['finished', [{ status: 'unexpected' }], 'unknown', 'unknown'],
    ['finished', [{ status: 'completed' }, { status: 'running' }], 'unknown', 'unknown'],
    ['finished', [{ status: 'completed' }], 'completed', 'completed'],
    ['staged', undefined, 'needs_attention', 'waiting_approval'],
    ['running', undefined, 'running', 'running'],
    [undefined, undefined, 'unknown', 'unknown'],
    ['unexpected', undefined, 'unknown', 'unknown'],
  ] as const)('projects team %s / %j as %s / %s', async (status, tasks, expected, outcome) => {
    const routes = new ActivityRoutes({ ...emptySources,
      teamStages: () => [{ id: 'team', status, createdAt: 1, tasks }] as unknown as ReturnType<ActivitySources['teamStages']>,
    });
    expect((await routes.list()).runs[0]).toMatchObject({ status: expected, outcome, statusSource: 'inferred' });
  });

  it.each([
    ['idle', 'unknown', 'queued'], ['running', 'running', 'running'],
    ['completed', 'completed', 'completed'], ['failed', 'failed', 'failed'],
    ['cancelled', 'failed', 'cancelled'], [undefined, 'unknown', 'unknown'],
    ['unexpected', 'unknown', 'unknown'],
  ] as const)('projects subagent %s as %s / %s', async (status, expected, outcome) => {
    const routes = new ActivityRoutes({ ...emptySources,
      subagents: async () => [{ id: 'idle', name: 'idle', status, startedAt: '2026-10-22T00:00:00Z' }] as Awaited<ReturnType<ActivitySources['subagents']>>,
    });
    expect((await routes.list()).runs[0]).toMatchObject({ status: expected, outcome, statusSource: 'inferred' });
  });

  it.each(['live', 'event_log'] as const)('preserves an explicitly successful session from %s', async source => {
    const routes = new ActivityRoutes({ ...emptySources,
      sessions: async () => [{ id: 'success', workspaceRoot: '/workspace', ...(source === 'event_log' ? { lastRunStatus: 'completed' as const } : {}) }],
      live: () => source === 'live' ? { turnActive: false, lastRunStatus: 'completed' } : undefined,
    });
    expect((await routes.list()).runs[0]).toMatchObject({ status: 'completed', outcome: 'completed', statusSource: source });
  });

  it.each([
    ['pending', 'unknown'], ['in-progress', 'running'], ['paused', 'needs_attention'],
    ['met', 'completed'], ['not_met', 'failed'], ['cancelled', 'failed'],
  ] as const)('maps goal %s to %s', async (status, expected) => {
    const routes = new ActivityRoutes({
      sessions: async () => [], live: () => undefined, approvals: () => [], subagents: async () => [], teamStages: () => [],
      goalTasks: () => [{ id: 'goal', projectRoot: '/workspace', goal: 'Do work', status }],
    });
    expect((await routes.list()).runs[0]?.status).toBe(expected);
  });
  it('does not falsely mark empty or unknown sessions as completed', async () => {
    const sources: ActivitySources = {
      sessions: async () => [
        { id: 's-empty', workspaceRoot: '/workspace', recordCount: 0 },
        { id: 's-no-data', workspaceRoot: '/workspace' },
      ],
      live: () => undefined,
      approvals: () => [],
      subagents: async () => [],
      teamStages: () => [],
      goalTasks: () => [],
    };

    const routes = new ActivityRoutes(sources);
    const { runs } = await routes.list();

    const emptyRun = runs.find((r) => r.id === 's-empty');
    expect(emptyRun).toBeDefined();
    expect(emptyRun?.status).toBe('unknown');
    expect(emptyRun?.outcome).toBe('queued');

    const noDataRun = runs.find((r) => r.id === 's-no-data');
    expect(noDataRun).toBeDefined();
    expect(noDataRun?.status).toBe('unknown');
    expect(noDataRun?.outcome).toBe('unknown');
  });

  it('reflects failed, interrupted and running outcomes truthfully', async () => {
    const sources: ActivitySources = {
      sessions: async () => [
        { id: 's-failed', workspaceRoot: '/workspace', lastRunStatus: 'failed', recordCount: 5 },
        { id: 's-interrupted', workspaceRoot: '/workspace', lastRunStatus: 'interrupted', recordCount: 3 },
        { id: 's-completed', workspaceRoot: '/workspace', lastRunStatus: 'completed', recordCount: 10 },
        { id: 's-running', workspaceRoot: '/workspace', recordCount: 2 },
      ],
      live: (id) => (id === 's-running' ? { turnActive: true } : undefined),
      approvals: () => [],
      subagents: async () => [],
      teamStages: () => [],
      goalTasks: () => [],
    };

    const routes = new ActivityRoutes(sources);
    const { runs } = await routes.list();

    expect(runs.find((r) => r.id === 's-failed')?.status).toBe('failed');
    expect(runs.find((r) => r.id === 's-failed')?.outcome).toBe('failed');

    expect(runs.find((r) => r.id === 's-interrupted')?.status).toBe('failed');
    expect(runs.find((r) => r.id === 's-interrupted')?.outcome).toBe('interrupted');

    expect(runs.find((r) => r.id === 's-running')?.status).toBe('running');
    expect(runs.find((r) => r.id === 's-running')?.outcome).toBe('running');

    expect(runs.find((r) => r.id === 's-completed')?.status).toBe('completed');
    expect(runs.find((r) => r.id === 's-completed')?.outcome).toBe('completed');
  });

  it('orders by needs_attention -> failed -> running -> unknown -> completed', async () => {
    const sources: ActivitySources = {
      sessions: async () => [
        { id: 's-completed', workspaceRoot: '/workspace', recordCount: 10, lastRunStatus: 'completed' },
        { id: 's-empty', workspaceRoot: '/workspace', recordCount: 0 },
        { id: 's-failed', workspaceRoot: '/workspace', recordCount: 4, lastRunStatus: 'failed' },
        { id: 's-need-approval', workspaceRoot: '/workspace', recordCount: 1 },
      ],
      live: () => undefined,
      approvals: () => [
        {
          sessionId: 's-need-approval',
          widgetId: 'w-1',
          actionType: 'fs_write',
          description: 'Approval needed',
          requestedAt: '2026-10-20T00:00:00Z',
          options: [{ id: 'opt-ok', label: 'Allow', tone: 'primary' }],
        },
      ],
      subagents: async () => [],
      teamStages: () => [],
      goalTasks: () => [],
    };

    const routes = new ActivityRoutes(sources);
    const { runs } = await routes.list();

    const order = runs.map((r) => r.status);
    expect(order).toEqual(['needs_attention', 'failed', 'unknown', 'completed']);
  });
});
