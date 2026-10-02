import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { ProjectRegistry, SessionController, SessionRegistry, ReviewHandoffStore } from '@vessel/application';
import { createVesselServer, type VesselServer } from './server.js';

let root: string, home: string, server: VesselServer, base: string;
const repo = path.resolve(import.meta.dirname, '..', '..', '..');
async function start() {
  server = createVesselServer({ port: 0, staticDir: root, projectRegistry: new ProjectRegistry({ vesselHome: home }), sessionRegistry: new SessionRegistry({ vesselHome: home }),
    reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }), sessionFactory: input => SessionController.create({ ...input,
      provider: new MockProvider([{ when: /.*/, response: { text: 'SQLite resilience conclusion' } }], { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheCreationTokens: 4 } }),
      model: 'mock', policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') }) });
  await server.listen(); base = `http://127.0.0.1:${server.port}`;
}
const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(async () => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-index-http-')); home = path.join(root, 'home'); await start(); });
afterEach(async () => { await server.close(); fs.rmSync(root, { recursive: true, force: true }); });
describe('production indexed session HTTP routes', () => {
  it('projects a real offline controller, paginates metadata, searches and restores usage after missing-cache restart', async () => {
    const { session } = await (await post('/api/sessions', { workspaceRoot: root })).json() as { session: { id: string } };
    expect((await post(`/api/sessions/${session.id}/turns`, { prompt: 'Discuss SQLite resilient architecture' })).status).toBe(200);
    const renamed = await fetch(`${base}/api/sessions/${session.id}/topic`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Authoritative SQLite topic' }) }); expect(renamed.status).toBe(200);
    let response = await (await fetch(base + '/api/sessions?limit=1&offset=0')).json();
    expect(response).toMatchObject({ sessions: [{ id: session.id, topic: { title: 'Authoritative SQLite topic' }, totalTokens: 120, inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheCreationTokens: 4 }] });
    const search = await (await fetch(base + '/api/sessions/search?q=sqlite%20resil')).json() as { indexed: boolean; results: unknown[] }; expect(search.indexed).toBe(true); expect(search.results).not.toHaveLength(0);
    await server.close(); const db = path.join(home, 'cache', 'session_index.db'); fs.renameSync(db, db + '.retained'); await start();
    response = await (await fetch(base + '/api/sessions')).json(); expect(response).toMatchObject({ sessions: [{ id: session.id, totalTokens: 120, topic: { title: 'Authoritative SQLite topic' } }] });
    expect(((await (await fetch(base + '/api/sessions/search?q=concl')).json()) as { results: unknown[] }).results).toHaveLength(1);
  });
  it('validates pagination/search on the HTTP boundary', async () => {
    expect((await fetch(base + '/api/sessions?limit=-1')).status).toBe(400); expect((await fetch(base + '/api/sessions?offset=1.5')).status).toBe(400);
    expect((await fetch(base + '/api/sessions/search?q=x&limit=0')).status).toBe(400);
  });
});
