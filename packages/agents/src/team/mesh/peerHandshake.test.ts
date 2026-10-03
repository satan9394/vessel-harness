import { describe, it, expect } from 'vitest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as http from 'node:http';
import { connect, startNode } from './__tests__/helpers.js';

describe('mesh peer handshake', () => {
  it('verifies fragmented Unicode JSON bytes and rejects replayed proofs', async () => {
    const a = await startNode(); const b = await startNode();
    try {
      await connect(a, b);
      const body = JSON.stringify({ nonce: randomUUID(), label: '中文上下文' }); const nonce = `${Date.now()}:${randomUUID()}`;
      const proof = createHmac('sha256', a.descriptor.token).update(`POST:/api/mesh/handshake:${nonce}:${body}`).digest('hex');
      const send = () => new Promise<number>(resolve => {
        const req = http.request(`${b.descriptor.endpoint}/api/mesh/handshake`, { method: 'POST', headers: { Authorization: `Bearer ${b.descriptor.token}`, 'x-mesh-node': a.descriptor.nodeId, 'x-mesh-nonce': nonce, 'x-mesh-proof': proof } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
        const bytes = Buffer.from(body); const split = bytes.indexOf(Buffer.from('中')) + 1;
        req.write(bytes.subarray(0, split)); setTimeout(() => req.end(bytes.subarray(split)), 5);
      });
      expect(await send()).toBe(200); expect(await send()).toBe(401);
    } finally { await a.close(); await b.close(); }
  });
  it('authenticates both pinned UUIDs/tokens and measures heartbeat, then marks unavailable peer offline', async () => {
    const a = await startNode(); const b = await startNode();
    try { await connect(a, b); await a.mesh.probePeer(b.descriptor.nodeId); expect(a.mesh.peer(b.descriptor.nodeId)).toMatchObject({ status: 'online' }); expect(a.mesh.peer(b.descriptor.nodeId)!.latencyMs).toBeGreaterThanOrEqual(0); await b.close(); await expect(a.mesh.probePeer(b.descriptor.nodeId)).rejects.toThrow(); expect(a.mesh.peer(b.descriptor.nodeId)!.status).toBe('offline'); }
    finally { await a.close(); await b.close(); }
  });
  it('rejects wrong receiver token, unprovisioned sender, and spoofed UUID', async () => {
    const a = await startNode(); const b = await startNode(); const impostor = await startNode();
    try {
      await expect(a.mesh.registerPeer(b.descriptor)).rejects.toThrow('401');
      b.mesh.trustPeer(a.descriptor);
      await expect(impostor.mesh.registerPeer({ ...b.descriptor, token: randomBytes(24).toString('hex') })).rejects.toThrow('401');
      await expect(a.mesh.registerPeer({ ...b.descriptor, nodeId: randomUUID() })).rejects.toThrow('handshake');
      await connect(a, b);
      const response = await fetch(`${b.descriptor.endpoint}/api/mesh/events`, { headers: { Authorization: `Bearer ${b.descriptor.token}`, 'x-mesh-node': a.descriptor.nodeId } });
      expect(response.status).toBe(401);
      expect((await fetch(`${b.descriptor.endpoint}/api/mesh/events?token=${b.descriptor.token}`)).status).toBe(401);
    } finally { await a.close(); await b.close(); await impostor.close(); }
  });
});


