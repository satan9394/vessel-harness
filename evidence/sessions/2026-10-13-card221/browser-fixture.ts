import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-card221-browser-'));
for (const key of ['VESSEL_PROVIDER_ROOT', 'VESSEL_USAGE_ROOT', 'VESSEL_SESSION_ROOT', 'VESSEL_REVIEW_ROOT', 'VESSEL_GOAL_ROOT', 'VESSEL_SETTINGS_ROOT']) process.env[key] = root;
const { createVesselServer } = await import('../../../apps/local-server/src/server.js');
const { SessionController, SessionRegistry, ProjectRegistry, ReviewHandoffStore } = await import('@vessel/application');
const { MockProvider } = await import('@vessel/llm');
const registry = new SessionRegistry({ vesselHome: root });
const server = await createVesselServer({ port: 32821, staticDir: path.resolve('apps/web/dist'),
  sessionRegistry: registry, projectRegistry: new ProjectRegistry({ vesselHome: root }), reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }),
  sessionFactory: async input => SessionController.create({ ...input, registry, model: 'mock', provider: new MockProvider([{ when: /.*/, response: { text: 'Behavior snapshot inspection fixture.' } }]),
    policySystemPath: path.resolve('configs/policy.default.yaml'), behaviorIRPath: path.resolve('configs/behavior.default.yaml'), memory: { enabled: false } }),
}).listen();
const url = `http://127.0.0.1:${server.port}`;
const post = async (route: string, body: unknown) => {
  const response = await fetch(url + '/api' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${route}: ${response.status}`);
  return response.json();
};
await post('/projects/open', { workspaceRoot: root });
const { session } = await post('/sessions', { workspaceRoot: root });
await post(`/sessions/${session.id}/turns`, { prompt: 'Inspect the active Behavior compilation chain.' });
fs.writeFileSync(path.resolve('evidence/sessions/2026-10-13-card221/browser-fixture-meta.json'), JSON.stringify({ root, url, sessionId: session.id }, null, 2));
console.log(JSON.stringify({ root, url, sessionId: session.id }));
process.on('SIGINT', () => { void server.close().then(() => process.exit(0)); });
