import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Session } from '@vessel/core';
import { NativeMeshEventBus } from '@vessel/agents';
import { ProjectRegistry, SessionRegistry, ReviewHandoffStore } from '@vessel/application';
import { createVesselServer } from './server.js';

it('serves authenticated read-only mesh, persisted rules and actual execution audits without secrets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-dashboard-api-'));
  const registry = new SessionRegistry({ vesselHome: path.join(root, 'home'), index: true });
  const meta = registry.create({ workspaceRoot: root });
  const session = await Session.open({ workspaceRoot: root, sessionId: meta.id });
  await session.appendSync({ type: 'audit/denial', toolName: 'Shell', toolCallId: 'denial', reason: 'denied', stage: 'rule', surface: false });
  const constraints = { readOnlyPaths: ['/'], memoryLimitBytes: null, privilegeReduction: 'Fixture namespace confinement' };
  await session.appendSync({ type: 'audit/sandbox_enforced', isolationTier: 'bwrap-ns', sandboxed: true, outcome: 'enforced', allowedWritePaths: [root], constraints, surface: false });
  await session.close();
  const token = 'ab'.repeat(24);
  const mesh = new NativeMeshEventBus({ nodeId: randomUUID(), endpoint: 'http://127.0.0.1:0', token, roleCapabilities: ['generator'], status: 'online', latencyMs: 0 });
  const peer = { nodeId: randomUUID(), endpoint: 'http://127.0.0.1:1', token: 'cd'.repeat(24), roleCapabilities: ['evaluator'], status: 'offline' as const, latencyMs: 25 };
  mesh.trustPeer(peer);
  const server = createVesselServer({ port: 0, authToken: token, mesh, sessionRegistry: registry,
    projectRegistry: new ProjectRegistry({ vesselHome: root }), reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }) });
  try {
    await server.listen();
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { Authorization: `Bearer ${token}` };
    for (const route of ['/api/mesh/peers', '/api/memory/rules', '/api/system/sandbox-tier']) {
      expect((await fetch(base + route)).status).toBe(401);
      expect((await fetch(base + route, { method: 'POST', headers })).status).toBe(405);
    }
    const peers = await (await fetch(base + '/api/mesh/peers', { headers })).json();
    expect(peers).toMatchObject({ configured: true, local: { nodeId: mesh.local.nodeId }, peers: [{ nodeId: peer.nodeId, status: 'offline', latencyMs: 25 }] });
    expect(JSON.stringify(peers)).not.toContain(token); expect(JSON.stringify(peers)).not.toContain(peer.token);
    const snapshot = vi.spyOn(mesh, 'remoteSnapshot').mockReturnValue({ nodeId: peer.nodeId, dagId: 'fixture-dag', seq: 1,
      tasks: [{ id: 'task', title: 'Review change', description: 'private task prompt', assignedRole: 'evaluator', dependencies: [], status: 'running' }], artifactDiffs: [] });
    const activity = await (await fetch(base + '/api/mesh/peers?dagId=fixture-dag', { headers })).json() as { peers: { remoteTasks: unknown }[] };
    expect(activity.peers[0]?.remoteTasks).toEqual([{ id: 'task', title: 'Review change', assignedRole: 'evaluator', status: 'running' }]);
    expect(JSON.stringify(activity)).not.toContain('private task prompt');
    expect(snapshot).toHaveBeenCalledWith(peer.nodeId, 'fixture-dag');
    snapshot.mockRestore();
    expect((await fetch(base + '/api/mesh/peers?dagId=', { headers })).status).toBe(400);
    expect(await (await fetch(base + '/api/memory/rules?category=policy_denial', { headers })).json()).toMatchObject({ available: true, rules: [{ category: 'policy_denial', frequency: 1 }] });
    expect(await (await fetch(base + '/api/memory/rules?category=tool_failure', { headers })).json()).toMatchObject({ rules: [] });
    for (const query of ['category=unknown', 'limit=0', 'limit=1.5', 'limit=1001']) expect((await fetch(base + '/api/memory/rules?' + query, { headers })).status).toBe(400);
    expect(await (await fetch(base + `/api/system/sandbox-tier?sessionId=${meta.id}`, { headers })).json()).toMatchObject({ scope: 'execution', audits: [{ sessionId: meta.id, toolName: 'Shell', sandbox: { isolationTier: 'bwrap-ns', sandboxed: true, allowedWritePaths: [root], constraints } }] });
    expect((await fetch(base + '/api/system/sandbox-tier?sessionId=missing', { headers })).status).toBe(404);
    const revived = new SessionRegistry({ vesselHome: path.join(root, 'home') });
    expect(await revived.sandboxAudits(meta.id)).toMatchObject([{ sandbox: { constraints } }]);
    await revived.closeIndex();
  } finally { await server.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

it('reports mesh unconfigured and absent audits honestly on the offline server', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-dashboard-offline-'));
  const server = createVesselServer({ port: 0, sessionRegistry: new SessionRegistry({ vesselHome: root, index: false }),
    projectRegistry: new ProjectRegistry({ vesselHome: root }), reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }) });
  try {
    await server.listen(); const base = `http://127.0.0.1:${server.port}`;
    expect(await (await fetch(base + '/api/mesh/peers')).json()).toMatchObject({ configured: false, local: null, peers: [] });
    expect(await (await fetch(base + '/api/memory/rules')).json()).toEqual({ available: false, rules: [] });
    expect(await (await fetch(base + '/api/system/sandbox-tier')).json()).toMatchObject({ scope: 'execution', audits: [] });
  } finally { await server.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
