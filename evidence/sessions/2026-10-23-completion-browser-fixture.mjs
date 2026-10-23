// Isolated real-provider fixture. Credentials stay in memory; all state is under tmpdir.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const root = process.env.VESSEL_COMPLETION_FIXTURE_ROOT ? path.resolve(process.env.VESSEL_COMPLETION_FIXTURE_ROOT) : fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-doc-completion-'));
if (path.relative(os.tmpdir(), root).startsWith('..') || path.isAbsolute(path.relative(os.tmpdir(), root))) throw new Error('fixture_root_must_be_temporary');
for (const kind of ['SESSION', 'PROVIDER', 'USAGE', 'REVIEWS', 'HANDOFFS', 'ITERATIONS', 'TASKQUEUE', 'DAEMON', 'SETTINGS', 'MCP']) process.env[`VESSEL_${kind}_ROOT`] = path.join(root, kind.toLowerCase());
const { ProjectRegistry, SessionRegistry, SessionController, ReviewHandoffStore } = await import('../../packages/application/dist/index.js');
const { createProvider } = await import('../../packages/llm/dist/index.js');
const { SubagentSeam } = await import('../../apps/local-server/dist/subagentSeam.js');
const { ProviderStore } = await import('../../apps/local-server/dist/providers/ProviderStore.js');
const { createVesselServer } = await import('../../apps/local-server/dist/server.js');
const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'README.md'), '# Disposable Vessel acceptance workspace\n');
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/opencode/opencode.json'), 'utf8'));
const endpoint = config.providers?.commandgota?.settings?.baseURL;
if (!endpoint || !process.env.OPENCODE_TOKEN) throw new Error('fixture_credentials_unavailable');
const secrets = new Map([['vessel/commandgota-real', process.env.OPENCODE_TOKEN]]);
const store = new ProviderStore({ rootDir: path.join(root, 'provider'), credentialStore: {
  backend: 'memory', setSync: (service, account, secret) => secrets.set(`${service}/${account}`, secret),
  getSync: (service, account) => secrets.get(`${service}/${account}`) ?? null,
  deleteSync: (service, account) => secrets.delete(`${service}/${account}`),
} });
if (!store.get('commandgota-real')) store.add({ id: 'commandgota-real', name: 'commandgota-real', protocol: 'openai-compatible', baseUrl: endpoint, apiKey: process.env.OPENCODE_TOKEN,
  model: 'deepseek/deepseek-v4.1-flash', models: ['deepseek/deepseek-v4.1-flash'] });
class FixtureRegistry extends SessionRegistry {
  failed = false;
  remove(id) {
    if (id === 'completion-group-b' && !this.failed) { this.failed = true; throw new Error('injected index failure'); }
    return super.remove(id);
  }
}
const sessions = new FixtureRegistry({ vesselHome: path.join(root, 'registry'), index: true });
const provider = createProvider('openai-compatible', { baseUrl: endpoint, apiKey: process.env.OPENCODE_TOKEN, model: 'deepseek/deepseek-v4.1-flash' });
for (const id of !process.env.VESSEL_COMPLETION_FIXTURE_ROOT || process.env.VESSEL_COMPLETION_SEED_BATCH === '1' ? ['completion-group-a', 'completion-group-b', 'completion-group-c'] : []) {
  if (sessions.get(id)) continue;
  const controller = await SessionController.create({ sessionId: id, workspaceRoot: workspace, provider, providerId: 'commandgota-real', model: 'deepseek/deepseek-v4.1-flash',
    policySystemPath: path.resolve('configs/policy.default.yaml'), behaviorIRPath: path.resolve('configs/behavior.default.yaml'), registry: sessions, permission: 'read-only' });
  await controller.close();
  sessions.put({ ...sessions.get(id), topic: { topicId: 'completion-batch', title: 'Disposable batch deletion fixture', createdAt: Date.now(), updatedAt: Date.now(), isArchived: false } });
}
const subagents = new SubagentSeam();
subagents.registerRun({ id: 'fixture-subagent', name: 'Fixture subagent failure (no child CLI)', provider: 'commandgota-real', status: 'failed', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), lastError: 'Injected source fixture failure; no external agent executed', worktreePath: workspace });
let discoveryCalls = 0;
const server = await createVesselServer({ port: 3017, workspace, providerStore: store, sessionRegistry: sessions,
  providerFetch: async (...args) => { discoveryCalls++; return process.env.VESSEL_COMPLETION_PROBE_FAILURE === '1' && discoveryCalls === 2 ? new Response('', { status: 503 }) : fetch(...args); },
  subagentSeam: subagents, teamProviders: { 'commandgota-real': provider }, tierBindings: Object.fromEntries(['pro', 'fast', 'review'].map(tier => [tier, { providerId: 'commandgota-real', model: 'deepseek/deepseek-v4.1-flash' }])),
  projectRegistry: new ProjectRegistry({ vesselHome: path.join(root, 'projects') }), reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }),
  staticDir: path.resolve('apps/web/dist') }).listen();
const metadata = { root, workspace, port: server.port, provider: 'commandgota-real', model: 'deepseek/deepseek-v4.1-flash' };
fs.writeFileSync('evidence/sessions/2026-10-23-completion-browser-meta.json', JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata));
const original = sessions.list().find(session => session.id.startsWith('sess_'));
if (original) {
  const base = `http://127.0.0.1:${server.port}/api`;
  const post = async (route, body) => { const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error('fixture_seed_failed'); return response.json(); };
  await fetch(base + `/sessions/${original.id}/messages`);
  const { stage } = await post(`/sessions/${original.id}/team-stages`, { task: 'Fixture team plan — reject without execution' });
  const oldTasks = await (await fetch(base + '/goal/tasks')).json();
  const task = oldTasks.tasks.find(task => task.goal === 'Fixture goal details') ?? (await post('/goal/tasks', { projectRoot: workspace, goal: 'Fixture goal details', acceptance: ['Preserve source references', 'Do not launch external agents'] })).task;
  const widget = { id: 'completion-approval', kind: 'permission_action', turnIndex: 0, timestamp: new Date().toISOString(), status: 'pending', payload: { actionType: 'filesystem_write', description: 'Fixture approval only; no file write is dispatched', options: [{ id: 'allow', label: 'Allow fixture', tone: 'primary' }, { id: 'deny', label: 'Deny fixture', tone: 'danger' }] } };
  void server.widgets.request(original.id, widget, 3600000);
  if (!fs.existsSync(path.join(workspace, 'review-fixture.txt'))) fs.writeFileSync(path.join(workspace, 'review-fixture.txt'), 'before\n');
  server.widgets.publish(original.id, { id: 'completion-diff', kind: 'diff_inspector', turnIndex: 0, timestamp: new Date().toISOString(), status: 'pending', payload: { filePath: 'review-fixture.txt', additions: 1, deletions: 1, patch: '--- a/review-fixture.txt\n+++ b/review-fixture.txt\n@@ -1 +1 @@\n-before\n+after\n' } });
  fs.writeFileSync('evidence/sessions/2026-10-23-doc-completion/seed-entities.json', JSON.stringify({ sessionId: original.id, teamId: stage.id, goalId: task.id, subagentId: 'fixture-subagent', provenance: 'Team/goal/widget source fixtures on real server; subagent summary injected, no child CLI' }, null, 2));
}
process.on('SIGINT', async () => { await server.close(); process.exit(0); });
