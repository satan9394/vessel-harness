// Isolated browser fixture: real HTTP deletion handler, one injected index failure.
// Browser mode creates no session directories. Probe mode uses junctions rejected
// by the real recycle guard, so neither mode performs OS recycling or deletion.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-task259-browser-'));
for (const kind of ['SESSION', 'PROVIDER', 'USAGE', 'REVIEWS', 'HANDOFFS', 'ITERATIONS', 'TASKQUEUE', 'DAEMON', 'SETTINGS', 'MCP']) {
  process.env[`VESSEL_${kind}_ROOT`] = path.join(root, kind.toLowerCase());
}
const { SessionRegistry, ProjectRegistry } = await import('../../packages/application/dist/index.js');
const { createVesselServer } = await import('../../apps/local-server/dist/server.js');
const workspace = path.join(root, 'workspace');
fs.mkdirSync(workspace);
const calls = [];
const probe = process.argv.includes('--probe');
class FixtureRegistry extends SessionRegistry {
  failed = false;
  remove(id) {
    calls.push(id);
    console.log(JSON.stringify({ deletion: id, attempt: calls.filter(value => value === id).length }));
    if (id === 'task259-b' && !this.failed) { this.failed = true; throw new Error('injected index unavailable'); }
    return super.remove(id);
  }
  restore(meta) {
    if (meta.id !== 'task259-stale') return super.restore(meta);
    const persist = this.persist;
    this.persist = () => { throw new Error('injected rollback unavailable'); };
    try { return super.restore(meta); } finally { this.persist = persist; }
  }
}
const registry = new FixtureRegistry({ vesselHome: path.join(root, 'registry'), index: false });
for (const id of probe ? ['task259-b', 'task259-recycle', 'task259-stale'] : ['task259-a', 'task259-b', 'task259-c']) {
  registry.put({ id, workspaceRoot: workspace, provider: 'mock', model: 'mock', permission: 'read-only',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    topic: { topicId: 'task259-shared', title: 'Task 259 partial deletion fixture', createdAt: Date.now(), updatedAt: Date.now(), isArchived: false } });
}
if (probe) {
  const target = path.join(root, 'preserved-history');
  fs.mkdirSync(target);
  const sessions = path.join(workspace, '.harness', 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  for (const id of ['task259-recycle', 'task259-stale']) fs.symlinkSync(target, path.join(sessions, id), 'junction');
}
const server = createVesselServer({ port: 3001, workspace, sessionRegistry: registry,
  projectRegistry: new ProjectRegistry({ vesselHome: path.join(root, 'projects') }),
  staticDir: path.resolve('apps/web/dist') });
await server.listen();
console.log(JSON.stringify({ url: `http://127.0.0.1:${server.port}`, root }));
if (probe) {
  const responses = [];
  for (const id of ['task259-b', 'task259-recycle', 'task259-stale']) {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/sessions/${id}`, { method: 'DELETE' });
    responses.push({ status: response.status, body: await response.json(), visible: !!registry.get(id),
      visibleAfterRestart: !!new SessionRegistry({ vesselHome: path.join(root, 'registry'), index: false }).get(id) });
  }
  fs.writeFileSync('evidence/sessions/2026-10-22-task259-responses.json', JSON.stringify({ root, responses }, null, 2));
  console.log(JSON.stringify(responses));
  await server.close();
  assert.deepEqual(responses.map(({ status, body, visible, visibleAfterRestart }) => [status, body.error, body.stage, visible, visibleAfterRestart]), [
    [500, 'session_index_failed', 'index', true, true],
    [500, 'session_recycle_failed', 'recycle', true, true],
    [500, 'session_index_stale', 'rollback', true, false],
  ]);
}
process.on('SIGINT', async () => { await server.close(); process.exit(0); });
