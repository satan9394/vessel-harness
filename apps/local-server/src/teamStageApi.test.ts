import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { ProjectRegistry, ReviewHandoffStore, SessionRegistry } from '@vessel/application';
import { TeamRuntime, type TeamDagTask, type TeamPlanStage } from '@vessel/agents';
import { loadPolicyArtifacts } from '@vessel/policy';
import { createVesselServer, type VesselServer } from './server.js';
import { TeamStageRoutes } from './teamRoutes.js';

vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>() }));

describe('team stage HTTP API', () => {
  let root: string;
  let server: VesselServer;
  let base: string;
  let sessionId: string;
  let stages: TeamStageRoutes;
  let provider: MockProvider;
  const status = vi.fn();
  async function request(url: string, body?: unknown) {
    return fetch(`${base}/api${url}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function create(body: object = {}) {
    const res = await request(`/sessions/${sessionId}/team-stages`, { task: 'Write a greeting', ...body });
    expect(res.status).toBe(201);
    return (await res.json() as { stage: TeamPlanStage }).stage;
  }
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-stage-api-'));
    provider = new MockProvider([
      { when: /CREATE_ARTIFACT/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'generated.txt', content: 'actual tool artifact\n' } }] } },
      { when: /.*/, response: { text: 'OFFLINE DAG RESULT' } },
    ], { model: 'mock' });
    status.mockClear();
    stages = new TeamStageRoutes(status);
    server = createVesselServer({ port: 0, staticDir: root, teamStages: stages, teamProviders: { mock: provider },
      projectRegistry: new ProjectRegistry({ vesselHome: root }),
      sessionRegistry: new SessionRegistry({ vesselHome: root }),
      reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }),
    });
    await server.listen(); base = `http://127.0.0.1:${server.port}`;
    const res = await request('/sessions', { workspaceRoot: root });
    sessionId = (await res.json() as { session: { id: string } }).session.id;
  });
  afterEach(async () => { vi.restoreAllMocks(); await server.close(); fs.rmSync(root, { recursive: true, force: true }); });

  it('previews roster and route snapshots without running; lists and retrieves the actual stage', async () => {
    const spy = vi.spyOn(provider, 'stream');
    const stage = await create();
    expect(stage.status).toBe('staged');
    expect(spy).not.toHaveBeenCalled();
    expect(stage.roster[0]?.routeSnapshot).toMatchObject({ providerId: 'mock' });
    const list = await (await request('/team/stages')).json() as { stages: TeamPlanStage[] };
    expect(list.stages.map(s => s.id)).toEqual([stage.id]);
    const detail = await (await request(`/team/stages/${stage.id}`)).json() as { stage: TeamPlanStage };
    expect(detail.stage.tasks).toEqual(stage.tasks);
    const other = await request('/sessions', { workspaceRoot: root });
    const otherId = (await other.json() as { session: { id: string } }).session.id;
    expect(await (await request(`/sessions/${otherId}/team-stages`)).json()).toEqual({ stages: [] });
  });

  it('approves once, executes through TeamRuntime and exposes finished node output', async () => {
    const stage = await create();
    const approval = await request(`/team/stages/${stage.id}/approve`, {});
    expect(approval.status).toBe(200);
    expect(await approval.json()).toEqual({ ok: true, status: 'running' });
    expect((await request(`/team/stages/${stage.id}/approve`, {})).status).toBe(409);
    await stages.close();
    const detail = await (await request(`/team/stages/${stage.id}`)).json() as { stage: TeamPlanStage };
    expect(detail.stage.status).toBe('finished');
    expect(detail.stage.tasks[0]).toMatchObject({ status: 'completed', result: { output: 'OFFLINE DAG RESULT' } });
    expect(status).toHaveBeenCalledWith(stage.id, 'staged');
    expect(status).toHaveBeenCalledWith(stage.id, 'finished');
    expect((await request(`/team/stages/${stage.id}/reject`, {})).status).toBe(409);
  });

  it('rejects without model calls; rejects repeat actions and returns 404 for unknown ids', async () => {
    const spy = vi.spyOn(provider, 'stream');
    const stage = await create();
    expect(await (await request(`/team/stages/${stage.id}/reject`, {})).json()).toEqual({ ok: true, status: 'rejected' });
    expect(spy).not.toHaveBeenCalled();
    expect((await request(`/team/stages/${stage.id}/approve`, {})).status).toBe(409);
    expect((await request('/team/stages/missing')).status).toBe(404);
    expect((await request('/team/stages/missing/approve', {})).status).toBe(404);
    expect(() => stages.approve('missing')).toThrow('unknown stage');
    expect(() => stages.reject('missing')).toThrow('unknown stage');
  });

  it('rejects malformed, empty, cyclic, missing and duplicate dependency DAGs', async () => {
    const node: TeamDagTask = { id: 'a', title: 'A', description: 'A', assignedRole: 'generator', status: 'pending', dependencies: [] };
    for (const tasks of [null, [], [{}], [{ ...node, dependencies: ['a'] }], [{ ...node, dependencies: ['missing'] }], [node, node], [{ ...node, dependencies: ['x', 'x'] }]]) {
      expect((await request(`/sessions/${sessionId}/team-stages`, { task: 'build', tasks })).status).toBe(400);
    }
    for (const body of [{ task: '' }, { task: 3 }, { task: 'x', mode: 'invalid' }, { task: 'x', acceptance: [3] }]) {
      expect((await request(`/sessions/${sessionId}/team-stages`, body)).status).toBe(400);
    }
    expect(stages.list()).toEqual([]);
  });

  it('records asynchronous execution failures instead of losing them', async () => {
    const runtime = new TeamRuntime({ workspaceRoot: root, providers: { mock: provider }, tools: [], policyArtifacts: loadPolicyArtifacts({ systemPath: path.resolve('configs/policy.default.yaml') }) });
    const stage = stages.stage(sessionId, runtime, { task: 'fixture', roster: [{ presetId: 'developer', providerId: 'mock', model: 'm' }], tasks: [{ id: 'a', title: 'A', description: 'A', assignedRole: 'generator', dependencies: [], status: 'pending' }] });
    vi.spyOn(runtime, 'approve').mockRejectedValueOnce(new Error('fixture failure'));
    stages.approve(stage.id); await stages.close();
    expect(stages.get(stage.id)?.error).toBe('fixture failure');
  });

  it('serves recorded artifacts and an actual new-file diff, denying path escapes and oversized files', async () => {
    const workspace = path.join(root, 'artifact-workspace'); fs.mkdirSync(workspace);
    execFileSync('git', ['init', workspace], { windowsHide: true, stdio: 'ignore' });
    fs.writeFileSync(path.join(workspace, 'output.txt'), 'verified artifact\nsecond line\n');
    fs.writeFileSync(path.join(root, 'outside.txt'), 'private sibling');
    const runtime = new TeamRuntime({ workspaceRoot: workspace, providers: { mock: provider }, tools: [], policyArtifacts: loadPolicyArtifacts({ systemPath: path.resolve('configs/policy.default.yaml') }) });
    const stage = stages.stage(sessionId, runtime, { task: 'fixture', roster: [{ presetId: 'developer', providerId: 'mock', model: 'm' }], tasks: [{ id: 'a', title: 'A', description: 'A', assignedRole: 'generator', dependencies: [], status: 'pending' }] }, workspace);
    const snapshot = runtime.getStage(stage.id);
    snapshot.tasks[0]!.result = { output: 'done', artifacts: ['output.txt', '../outside.txt'] };
    vi.spyOn(runtime, 'getStage').mockImplementation(() => structuredClone(snapshot));
    const artifactUrl = `/team/stages/${stage.id}/tasks/a/artifacts/0`;
    const detail = await request(artifactUrl);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ content: 'verified artifact\nsecond line\n', diff: expect.stringContaining('+verified artifact'), comparison: 'Current workspace against Git HEAD' });
    expect(await (await request(`${artifactUrl}/content`)).text()).toBe('verified artifact\nsecond line\n');
    expect((await request(`/team/stages/${stage.id}/tasks/a/artifacts/1`)).status).toBe(400);
    expect((await request(`/team/stages/${stage.id}/tasks/a/artifacts/-1`)).status).toBe(400);
    fs.writeFileSync(path.join(workspace, 'output.txt'), 'x'.repeat(65537));
    expect((await request(artifactUrl)).status).toBe(400);
  });
  it('captures actual Write tool evidence from the member session and serves its diff', async () => {
    execFileSync('git', ['init', root], { windowsHide: true, stdio: 'ignore' });
    const stage = await create({ task: 'CREATE_ARTIFACT', mode: 'fast' });
    expect((await request(`/team/stages/${stage.id}/approve`, {})).status).toBe(200);
    await stages.close();
    const done = stages.get(stage.id)!;
    expect(done.tasks[0]!.result?.artifacts).toEqual(['generated.txt']);
    expect(fs.readFileSync(path.join(root, 'generated.txt'), 'utf8')).toBe('actual tool artifact\n');
    const res = await request(`/team/stages/${stage.id}/tasks/${done.tasks[0]!.id}/artifacts/0`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ diff: expect.stringContaining('+actual tool artifact') });
  });
  it('inherits read-only session policy when the member attempts Write', async () => {
    const created = await request('/sessions', { workspaceRoot: root, permission: 'read-only' });
    sessionId = (await created.json() as { session: { id: string } }).session.id;
    const stage = await create({ task: 'CREATE_ARTIFACT', mode: 'fast' });
    await request(`/team/stages/${stage.id}/approve`, {}); await stages.close();
    expect(stages.get(stage.id)!.tasks[0]!.result?.artifacts ?? []).toEqual([]);
    expect(fs.existsSync(path.join(root, 'generated.txt'))).toBe(false);
  });
  it('preserves a parent plugin runtime deny in the child policy', async () => {
    const plugin = path.join(root, '.claude', 'plugins', 'deny-write');
    fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true }); fs.mkdirSync(path.join(plugin, 'hooks'));
    fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'deny-write' }));
    fs.writeFileSync(path.join(plugin, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'opaque plugin declaration' }] }] } }));
    const created = await request('/sessions', { workspaceRoot: root });
    sessionId = (await created.json() as { session: { id: string } }).session.id;
    const stage = await create({ task: 'CREATE_ARTIFACT', mode: 'fast' });
    await request(`/team/stages/${stage.id}/approve`, {}); await stages.close();
    expect(fs.existsSync(path.join(root, 'generated.txt'))).toBe(false);
    const records = fs.readdirSync(path.join(root, '.harness', 'sessions')).filter(id => id.startsWith('sub_')).flatMap(id => fs.readFileSync(path.join(root, '.harness', 'sessions', id, 'session.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { type: string; error?: { errorClass: string }; toolName?: string }));
    expect(records.some(record => record.type === 'tool/result' && record.toolName === 'Write' && record.error?.errorClass === 'DENIED')).toBe(true);
  });

  it('validates replacement previews atomically and uses the edited frozen model route on approval', async () => {
    const spy = vi.spyOn(provider, 'stream');
    const stage = await create({ mode: 'fast' });
    const roster = stage.roster.map(member => ({ memberId: member.memberId, presetId: member.presetId, ...member.routeSnapshot, model: 'chosen-model', reasoningEffort: 'high', temperature: 0.7 }));
    for (const changes of [{ roster, tasks: [{ ...stage.tasks[0], dependencies: ['missing'] }] }, { roster, tasks: [{ ...stage.tasks[0], assignedRole: 'evaluator' }] }, { roster: [{ ...roster[0], providerId: 'missing' }], tasks: stage.tasks }, { roster: [{ ...roster[0], temperature: 3 }], tasks: stage.tasks }, { roster: [{ ...roster[0], reasoningEffort: 'bad' }], tasks: stage.tasks }]) {
      expect((await request(`/team/stages/${stage.id}/revise`, changes)).status).toBe(400);
      expect(stages.get(stage.id)!.status).toBe('staged'); expect(stages.list()).toHaveLength(1);
    }
    const revised = await request(`/team/stages/${stage.id}/revise`, { roster, tasks: [{ ...stage.tasks[0], description: 'edited parameters' }] });
    expect(revised.status).toBe(201);
    const replacement = (await revised.json() as { stage: TeamPlanStage }).stage;
    expect(replacement.id).not.toBe(stage.id); expect(stages.get(stage.id)!.status).toBe('rejected');
    expect(replacement.roster[0]!.routeSnapshot).toMatchObject({ model: 'chosen-model', reasoningEffort: 'high', temperature: 0.7 });
    expect(spy).not.toHaveBeenCalled();
    await request(`/team/stages/${replacement.id}/approve`, {}); await stages.close();
    expect(spy.mock.calls[0]![0]).toMatchObject({ model: 'chosen-model', reasoningEffort: 'high', temperature: 0.7 });
    expect(spy.mock.calls[0]![0].messages.some(message => message.content.includes('edited parameters'))).toBe(true);
    expect((await request(`/team/stages/${replacement.id}/revise`, { roster, tasks: stage.tasks })).status).toBe(409);
    expect(stages.get(replacement.id)!.roster[0]!.routeSnapshot.model).toBe('chosen-model');
  });

  it('checks the opened descriptor identity before reading to reject a path swap', async () => {
    const workspace = path.join(root, 'safe'); fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, 'artifact.txt'), 'public'); fs.writeFileSync(path.join(root, 'secret.txt'), 'private');
    const runtime = new TeamRuntime({ workspaceRoot: workspace, providers: { mock: provider }, tools: [], policyArtifacts: loadPolicyArtifacts({ systemPath: path.resolve('configs/policy.default.yaml') }) });
    const stage = stages.stage(sessionId, runtime, { task: 'fixture', roster: [{ presetId: 'developer', providerId: 'mock', model: 'm' }], tasks: [{ id: 'a', title: 'A', description: 'A', assignedRole: 'generator', dependencies: [], status: 'pending' }] }, workspace);
    const snapshot = runtime.getStage(stage.id); snapshot.tasks[0]!.result = { output: 'done', artifacts: ['artifact.txt'] };
    vi.spyOn(runtime, 'getStage').mockImplementation(() => structuredClone(snapshot));
    const open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementationOnce(() => open(path.join(root, 'secret.txt'), 'r'));
    expect(() => stages.artifact(stage.id, 'a', 0)).toThrow('artifact changed during open');
  });
});
