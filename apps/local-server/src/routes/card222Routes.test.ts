import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectRegistry, ReviewHandoffStore, SessionController, SessionRegistry, TaskTreeRegistry, TaskTreeScheduler } from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import type { AgentInstanceSpec, PolicyArtifacts, SessionRecord } from '@vessel/shared';
import { createVesselServer } from '../server.js';
import { TaskTreeRoutes } from './taskTrees.js';
import { ActivityRoutes, type ActivitySources } from './activityRoutes.js';
import { BehaviorComposeRoutes } from './behaviorCompose.js';
import { TraceRoutes } from './traceRoutes.js';

const budget = { maxModelSteps: 4, maxToolCalls: 8, maxElapsedMs: 30_000, maxConsecutiveErrors: 2 };
const spec = (instanceId: string, parentInstanceId?: string): AgentInstanceSpec => ({
  instanceId, parentInstanceId, modelProfileRef: 'model:mock', behaviorSnapshotRef: 'sha256:s',
  policyScopeRef: 'policy:workspace-write', contextScopeRef: 'context:default', toolScopeRef: 'tools:read', budget,
});

async function seedRegistry(): Promise<TaskTreeRegistry> {
  const registry = new TaskTreeRegistry();
  const scheduler = new TaskTreeScheduler({
    projectRoot: '/repo', rootInstanceId: 'root', registry, maxConcurrency: 1,
    tasks: [
      { spec: spec('root'), title: 'coordinate' },
      { spec: spec('read-a', 'root'), title: 'read a' },
      { spec: spec('read-b', 'root'), title: 'read b' },
    ],
    executor: async (node) => node.instanceId === 'read-b'
      ? { status: 'failed', error: 'fixture failure' }
      : { status: 'completed', result: { output: `${node.instanceId}-done` } },
  });
  await scheduler.run();
  return registry;
}

describe('card 222 read-side routes', () => {
  it('serves task trees with status filtering', async () => {
    const registry = await seedRegistry();
    const routes = new TaskTreeRoutes(registry);
    const all = routes.list();
    expect(all.trees).toHaveLength(1);
    expect(all.trees[0]!.projectRoot).toBe('/repo');
    expect(all.trees[0]!.nodes.map((node) => node.status)).toEqual(['completed', 'completed', 'failed']);
    const failed = routes.list({ status: 'failed' });
    expect(failed.trees[0]!.nodes.map((node) => node.instanceId)).toEqual(['read-b']);
    expect(routes.list({ rootInstanceId: 'nope' }).trees).toEqual([]);
  });

  it('aggregates sessions, team stages, subagents and goal tasks into one ordered queue', async () => {
    const sources: ActivitySources = {
      sessions: async () => [
        { id: 's-run', workspaceRoot: '/a', updatedAt: '2026-10-14T01:00:00Z' },
        { id: 's-approve', workspaceRoot: '/b', updatedAt: '2026-10-14T02:00:00Z' },
        { id: 's-archived', workspaceRoot: '/c', topic: { title: 'old', isArchived: true } },
      ],
      live: (id) => id === 's-run' ? { turnActive: true } : undefined,
      approvals: () => [{ sessionId: 's-approve', widgetId: 'w1', actionType: 'filesystem_write', description: 'write out.txt', requestedAt: '2026-10-14T02:00:00Z', options: [{ id: 'allow', label: 'Allow once', tone: 'primary' }] }],
      subagents: async () => [{ id: 'sub-1', name: 'explore', status: 'running', startedAt: '2026-10-14T00:00:00Z' }],
      teamStages: () => [{ id: 'stage-1', status: 'staged', createdAt: 5 }],
      goalTasks: () => [{ id: 'goal-1', projectRoot: '/d', goal: 'ship it', status: 'in-progress', updatedAt: '2026-10-14T03:00:00Z' }],
      defaultProjectRoot: '/repo',
    };
    const { runs } = await new ActivityRoutes(sources).list();
    expect(runs.map((run) => run.status)).toEqual(['needs_attention', 'needs_attention', 'running', 'running', 'running']);
    expect(runs.slice(0, 2).map((run) => run.id).sort()).toEqual(['s-approve', 'stage-1']);
    expect(runs.find((run) => run.id === 'stage-1')).toMatchObject({ status: 'needs_attention', needsApproval: true, kind: 'team' });
    expect(runs.find((run) => run.id === 's-run')).toMatchObject({ status: 'running' });
    expect(runs.find((run) => run.id === 's-approve')).toMatchObject({ status: 'needs_attention', needsApproval: true, approval: { widgetId: 'w1' } });
    expect(runs.some((run) => run.id === 's-archived')).toBe(false);
  });

  it('validates a behavior composition and rejects unenforceable constraints', () => {
    const policy: PolicyArtifacts = { promptGuidance: [], deniedTools: [], profile: 'workspace-write', approval: 'ask', rules: [] };
    const routes = new BehaviorComposeRoutes(() => policy);
    expect(routes.compose(null)).toMatchObject({ status: 400 });
    expect(routes.compose({ entries: [] })).toMatchObject({ status: 400 });
    expect(routes.compose({ entries: [{ id: 'x', class: 'c', channel: 'nope', render: 'r' }] })).toMatchObject({ status: 400 });
    const ok = routes.compose({ entries: [{ id: 'p1', class: 'style', channel: 'prompt_guidance', render: 'Be concise.' }] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ verdict: 'enforceable' });
    const bad = routes.compose({ entries: [{ id: 'r1', class: 'safety', channel: 'runtime_policy', policy_ref: 'network.deny_domains', render: 'No network.' }] });
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ verdict: 'rejected' });
    expect(new BehaviorComposeRoutes(() => undefined).compose({ entries: [{ id: 'p', class: 'c', channel: 'prompt_guidance', render: 'r' }] })).toMatchObject({ status: 404 });
  });

  it('exports a sanitized step trace that never leaks raw arguments', () => {
    const records = [
      { type: 'turn/start', seq: 0, ts: 't0', turnId: 'turn-1', source: 'user' },
      { type: 'step/start', seq: 1, ts: 't1', turnId: 'turn-1', step: 1 },
      { type: 'request/header', seq: 2, ts: 't2', turnId: 'turn-1', step: 1, model: 'mock', messages: [{ content: 'SECRET-KEY' }] },
      { type: 'tool/call', seq: 3, ts: 't3', turnId: 'turn-1', step: 1, toolName: 'Write', arguments: { path: 'SECRET-KEY', token: 'SECRET-KEY' } },
      { type: 'turn/end', seq: 4, ts: 't4', turnId: 'turn-1', kind: 'success' },
    ] as unknown as SessionRecord[];
    const report = new TraceRoutes((id) => id === 's1' ? records : undefined).report('s1')!;
    expect(report.turns).toHaveLength(1);
    expect(report.turns[0]!.steps.map((step) => step.type)).toEqual(['turn/start', 'step/start', 'request/header', 'tool/call', 'turn/end']);
    const json = JSON.stringify(report);
    expect(json).not.toContain('SECRET-KEY');
    expect(json).toContain('argumentKeys');
    expect(report.redactedFields).toContain('arguments');
    expect(new TraceRoutes(() => undefined).report('missing')).toBeUndefined();
  });

  it('serves the endpoints over HTTP with a seeded registry', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-card222-'));
    const registry = new SessionRegistry({ vesselHome: path.join(root, 'index') });
    const ctl = await SessionController.create({ workspaceRoot: root, model: 'mock',
      provider: new MockProvider([{ when: /.*/, response: { text: 'fixture' } }]),
      policySystemPath: path.resolve('configs/policy.default.yaml'), behaviorIRPath: path.resolve('configs/behavior.default.yaml'),
      memory: { enabled: false }, registry });
    const taskTrees = await seedRegistry();
    const server = await createVesselServer({ port: 0, sessionRegistry: registry, taskTrees,
      projectRegistry: new ProjectRegistry({ vesselHome: root }), reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }),
      sessionFactory: async () => ctl }).listen();
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: root }) });
      expect(server.taskTrees?.get('root')?.rootInstanceId).toBe('root');

      const tree = await (await fetch(`${base}/api/tasks/tree`)).json() as { trees: unknown[] };
      expect(tree.trees).toHaveLength(1);
      expect((await fetch(`${base}/api/tasks/tree?status=bogus`)).status).toBe(400);

      await ctl.runTurn('trace-me please');
      const activity = await (await fetch(`${base}/api/activity/runs`)).json() as { runs: { id: string }[] };
      expect(activity.runs.some((run) => run.id === ctl.sessionId)).toBe(true);

      const traceRes = await (await fetch(`${base}/api/sessions/${ctl.sessionId}/trace`)).json() as { trace: { turns: unknown[]; redactedFields: string[] } };
      expect(traceRes.trace.turns.length).toBeGreaterThan(0);
      expect(JSON.stringify(traceRes)).not.toContain('trace-me please');

      const library = await (await fetch(`${base}/api/behavior/library`)).json() as { entries: unknown[] };
      expect(library.entries.length).toBeGreaterThan(0);

      const composed = await (await fetch(`${base}/api/behavior/compose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [{ id: 'p1', class: 'style', channel: 'prompt_guidance', render: 'Be concise.' }] }) })).json() as { verdict: string };
      expect(composed.verdict).toBe('enforceable');
      expect((await fetch(`${base}/api/behavior/compose`, { method: 'GET' })).status).toBe(405);
      expect((await fetch(`${base}/api/sessions/nope/trace`)).status).toBe(404);
    } finally {
      await server.close(); await ctl.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
