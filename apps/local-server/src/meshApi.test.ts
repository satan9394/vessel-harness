import { it, expect } from 'vitest';
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
  } finally { await client.close(); await server.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
