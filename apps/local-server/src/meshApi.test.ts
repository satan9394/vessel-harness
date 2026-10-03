import { it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NativeMeshEventBus, type MeshNodeDescriptor } from '@vessel/agents';
import { ProjectRegistry, SessionRegistry, ReviewHandoffStore } from '@vessel/application';
import { createVesselServer } from './server.js';

it('mounts mesh behind daemon auth, pins identity, and keeps remote bind opt-in', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mesh-api-'));
  const local: MeshNodeDescriptor = { nodeId: randomUUID(), endpoint: 'http://127.0.0.1:0', token: 'ab'.repeat(24), roleCapabilities: ['generator'], status: 'online', latencyMs: 0 };
  const peer: MeshNodeDescriptor = { ...local, nodeId: randomUUID(), token: 'cd'.repeat(24) };
  const mesh = new NativeMeshEventBus(local); const client = new NativeMeshEventBus(peer);
  const server = createVesselServer({ port: 0, mesh, authToken: local.token,
    projectRegistry: new ProjectRegistry({ vesselHome: root }), sessionRegistry: new SessionRegistry({ vesselHome: root }), reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }),
  });
  try {
    expect(() => createVesselServer({ mesh })).toThrow('identity');
    expect(() => createVesselServer({ host: '0.0.0.0' })).toThrow('launch token');
    expect(() => createVesselServer({ mesh, authToken: 'ef'.repeat(24) })).toThrow('identity');
    await server.listen(); mesh.trustPeer(peer); client.trustPeer(local);
    await client.registerPeer(local);
    expect((await fetch(`${local.endpoint}/api/mesh/events`)).status).toBe(401);
    expect((await fetch(`${local.endpoint}/api/mesh/events`, { headers: { Authorization: `Bearer ${local.token}` } })).status).toBe(401);
    await client.reconcilePeer(local.nodeId);
    expect((await fetch(`${local.endpoint}/api/control/mesh/status`)).status).toBe(401);
    const headers = { Authorization: `Bearer ${local.token}` };
    const status = await (await fetch(`${local.endpoint}/api/control/mesh/status`, { headers })).json() as { nodeId: string; peers: unknown[] };
    expect(status.nodeId).toBe(local.nodeId); expect(status.peers).toHaveLength(1);
    expect(JSON.stringify(status)).not.toContain(peer.token); expect(JSON.stringify(status)).not.toContain(local.token);
    const probe = vi.spyOn(mesh, 'probePeer').mockResolvedValue();
    expect((await fetch(`${local.endpoint}/api/control/mesh/ping/${peer.nodeId}`, { method: 'POST', headers })).status).toBe(200);
    expect(probe).toHaveBeenCalledWith(peer.nodeId);
    expect((await fetch(`${local.endpoint}/api/control/mesh/ping/missing`, { method: 'POST', headers })).status).toBe(404);
    expect((await fetch(`${local.endpoint}/api/control/mesh/ping/%`, { method: 'POST', headers })).status).toBe(400);
    probe.mockRejectedValue(new Error('secret'));
    const failed = await fetch(`${local.endpoint}/api/control/mesh/ping/${peer.nodeId}`, { method: 'POST', headers });
    expect(failed.status).toBe(502); expect(await failed.text()).not.toContain('secret'); probe.mockRestore();
  } finally { await client.close(); await server.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
