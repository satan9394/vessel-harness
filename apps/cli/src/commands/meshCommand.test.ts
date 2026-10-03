import { afterEach, expect, it, vi } from 'vitest';
import { meshCommand, DaemonMeshControl } from './meshCommand.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { main } from '../cli.js';

afterEach(() => vi.restoreAllMocks());
const control = { status: async () => ({ nodeId: 'local-uuid', peers: [
  { nodeId: 'peer-1', endpoint: 'http://localhost:30001', status: 'online', roleCapabilities: ['evaluator'], latencyMs: 12 },
  { nodeId: 'peer-2', endpoint: 'http://localhost:30002', status: 'offline', roleCapabilities: [], latencyMs: 80 },
] }), ping: vi.fn(async (nodeId: string) => ({ nodeId, latencyMs: 15 })) };
it('shows UUID, connected count and latency excluding offline peers; renders table and heartbeat RTT', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await meshCommand(['status'], new Map(), control)).toBe(0);
  expect(log.mock.calls[0]![0]).toContain('Connected peers: 1'); expect(log.mock.calls[0]![0]).toContain('12.0 ms');
  await meshCommand(['peers'], new Map(), control); expect(log.mock.calls[1]![0]).toContain('evaluator');
  await meshCommand(['ping', 'peer-1'], new Map(), control); expect(log.mock.calls[2]![0]).toContain('RTT 15 ms');
});
it('rejects malformed input before any control call and reports unreachable peers', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const status = vi.fn(control.status);
  expect(await meshCommand(['ping'], new Map(), { ...control, status })).toBe(2); expect(status).not.toHaveBeenCalled();
  expect(await meshCommand(['unknown'], new Map(), control)).toBe(2);
  expect(await meshCommand(['ping', 'missing'], new Map(), { ...control, ping: async () => { throw new Error('secret'); } })).toBe(1);
});
it('registers mesh and swarm aliases through the production CLI', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const status = vi.spyOn(DaemonMeshControl.prototype, 'status').mockImplementation(control.status);
  expect(await main(['mesh', 'status'])).toBe(0); expect(await main(['swarm', 'peers'])).toBe(0); expect(status).toHaveBeenCalledTimes(2);
});
it('uses authenticated loopback daemon control without starting an agent or leaking token', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-cli-'));
  try {
    fs.writeFileSync(path.join(root, 'daemon.json'), JSON.stringify({ pid: process.pid, port: 30001 }));
    fs.writeFileSync(path.join(root, 'daemon.token'), 'ab'.repeat(24));
    const fetcher = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => new Response(JSON.stringify(await control.status()), { status: 200 }));
    expect(await new DaemonMeshControl(root, fetcher).status()).toEqual(await control.status());
    expect(fetcher.mock.calls[0]![0]).toBe('http://127.0.0.1:30001/api/control/mesh/status');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
