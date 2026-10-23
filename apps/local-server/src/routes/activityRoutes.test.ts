import { describe, expect, it } from 'vitest';
import { ActivityRoutes, type ActivitySources } from './activityRoutes.js';

describe('ActivityRoutes (ARCH-01 / UI-02 Truthful Status)', () => {
  const emptySources: ActivitySources = {
    sessions: async () => [], live: () => undefined, approvals: () => [],
    subagents: async () => [], teamStages: () => [], goalTasks: () => [],
  };

  it('projects actual team tasks, subagent execution and goal acceptance into distinct details', async () => {
    const routes = new ActivityRoutes({ ...emptySources,
      teamStages: () => [{ id: 'team', status: 'staged', projectRoot: '/team-project', createdAt: 1, tasks: [{ id: 't', title: 'Review change', status: 'pending' }] }],
      subagents: async () => [{ id: 'agent', name: 'Reviewer', status: 'failed', provider: 'fixture', startedAt: '2026-10-23', lastError: 'exit failure' }],
      goalTasks: () => [{ id: 'goal', projectRoot: '/fixture', goal: 'Ship', status: 'paused', acceptance: ['Tests pass'] }],
    });
    const { runs } = await routes.list();
    expect(runs.find(run => run.id === 'team')?.projectRoot).toBe('/team-project');
    expect(runs.find(run => run.id === 'team')?.entity).toEqual({ status: 'staged', tasks: [{ id: 't', title: 'Review change', status: 'pending' }] });
    expect(runs.find(run => run.id === 'agent')?.entity).toMatchObject({ status: 'failed', provider: 'fixture', error: 'exit failure' });
    expect(runs.find(run => run.id === 'goal')?.entity).toEqual({ status: 'paused', acceptance: ['Tests pass'] });
  });

  it.each(['queued', 'running', 'waiting_approval', 'completed', 'failed', 'interrupted', 'cancelled', 'unknown'] as const)(
    'projects the eight-state contract: %s with separate session/run identity', async outcome => {
      const observation = { runId: 'run-123', observedAt: 10, revision: 4, reasonCode: 'fixture', lastRunStatus: outcome === 'running' || outcome === 'waiting_approval' ? 'completed' as const : outcome };
      const routes = new ActivityRoutes({ ...emptySources,
        sessions: async () => [{ id: 'session-123', workspaceRoot: '/workspace', ...observation }],
        live: () => outcome === 'running' || outcome === 'waiting_approval' ? { ...observation, turnActive: true } : undefined,
        approvals: () => outcome === 'waiting_approval' ? [{ sessionId: 'session-123', widgetId: 'approval', actionType: 'write', description: 'fixture', requestedAt: '2026-10-23T00:00:00Z', options: [] }] : [],
      });
      const status = outcome === 'queued' ? 'unknown' : outcome === 'waiting_approval' ? 'needs_attention' : outcome;
      expect((await routes.list()).runs[0]).toMatchObject({ id: 'session-123', runId: 'run-123', status, outcome, observedAt: 10, revision: 4,
        statusSource: outcome === 'running' ? 'live' : outcome === 'waiting_approval' ? 'approval_queue' : 'event_log' });
    },
  );

  it.each([
    ['approved', undefined, 'unknown', 'queued'],
    ['rejected', undefined, 'cancelled', 'cancelled'],
    ['finished', [{ status: 'cancelled' }], 'cancelled', 'cancelled'],
    ['finished', [{ status: 'completed' }, { status: 'cancelled' }], 'cancelled', 'cancelled'],
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
    ['cancelled', 'cancelled', 'cancelled'], [undefined, 'unknown', 'unknown'],
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

  it.each(['live', 'event_log'] as const)('distinguishes failure, cancellation and interruption from %s', async source => {
    const outcomes = ['failed', 'cancelled', 'interrupted'] as const;
    const routes = new ActivityRoutes({ ...emptySources,
      sessions: async () => outcomes.map(outcome => ({ id: outcome, workspaceRoot: '/workspace',
        ...(source === 'event_log' ? { lastRunStatus: outcome } : {}) })),
      live: id => source === 'live' ? { turnActive: false, lastRunStatus: outcomes.find(outcome => outcome === id) } : undefined,
    });
    const { runs } = await routes.list();
    for (const outcome of outcomes) expect(runs.find(run => run.id === outcome)).toMatchObject({ status: outcome, outcome, statusSource: source });
  });

  it.each([
    ['pending', 'unknown'], ['in-progress', 'running'], ['paused', 'needs_attention'],
    ['met', 'completed'], ['not_met', 'failed'], ['cancelled', 'cancelled'],
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

    expect(runs.find((r) => r.id === 's-interrupted')?.status).toBe('interrupted');
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
