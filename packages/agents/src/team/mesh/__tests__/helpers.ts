import * as http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { authMiddleware } from '../../../../../../apps/local-server/src/daemon/authMiddleware.js';
import { NativeMeshEventBus } from '../NativeMeshEventBus.js';
import type { MeshExecution, MeshNodeDescriptor } from '../types.js';
import { resolveRoster } from '../../roster.js';
import { createDefaultPresetRegistry } from '../../../presets/defaults.js';

export const roster = () => resolveRoster([
  { presetId: 'developer', model: 'mock', providerId: 'mock' },
  { presetId: 'reviewer', model: 'mock', providerId: 'mock' },
], createDefaultPresetRegistry());
export async function startNode(execution?: MeshExecution) {
  const descriptor: MeshNodeDescriptor = { nodeId: randomUUID(), token: randomBytes(24).toString('hex'), endpoint: 'http://127.0.0.1:1', roleCapabilities: ['generator', 'evaluator'], status: 'online', latencyMs: 0 };
  const mesh = new NativeMeshEventBus(descriptor, execution, 20);
  const server = http.createServer((req, res) => { if (authMiddleware(req, res, descriptor.token, new URL(req.url!, descriptor.endpoint).pathname)) void mesh.handleRequest(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  descriptor.endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { mesh, descriptor, server, async close() { await mesh.close(); server.closeAllConnections(); if (server.listening) { server.close(); await once(server, 'close'); } } };
}
export async function connect(a: Awaited<ReturnType<typeof startNode>>, b: Awaited<ReturnType<typeof startNode>>) {
  a.mesh.trustPeer(b.descriptor); b.mesh.trustPeer(a.descriptor);
  await a.mesh.registerPeer(b.descriptor); await b.mesh.registerPeer(a.descriptor);
}


