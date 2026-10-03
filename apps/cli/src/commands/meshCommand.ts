import * as fs from 'node:fs';
import * as path from 'node:path';
import { daemonRoot, processAlive } from '@vessel/local-server';

export interface MeshPeer { nodeId: string; endpoint: string; status: string; roleCapabilities: string[]; latencyMs: number }
export interface MeshStatus { nodeId: string; peers: MeshPeer[] }
export interface MeshControl { status(): Promise<MeshStatus>; ping(id: string): Promise<{ nodeId: string; latencyMs: number }> }

/** Control routes use the existing daemon bearer token; peer HMAC secrets never leave the daemon. */
export class DaemonMeshControl implements MeshControl {
  constructor(private readonly root = daemonRoot(), private readonly fetcher = globalThis.fetch) {}
  private async request(route: string, method = 'GET'): Promise<unknown> {
    const info = JSON.parse(fs.readFileSync(path.join(this.root, 'daemon.json'), 'utf8')) as { pid: number; port: number };
    if (!processAlive(info.pid) || !Number.isInteger(info.port) || info.port < 1 || info.port > 65535) throw new Error('Daemon is not running; use vessel daemon start.');
    const token = fs.readFileSync(path.join(this.root, 'daemon.token'), 'utf8');
    if (!/^[0-9a-f]{48}$/.test(token)) throw new Error('Daemon credentials unavailable; restart the daemon.');
    const response = await this.fetcher(`http://127.0.0.1:${info.port}/api/control/mesh/${route}`, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Mesh control unavailable (HTTP ${response.status}); check daemon mesh configuration.`);
    return response.json();
  }
  async status(): Promise<MeshStatus> { return await this.request('status') as MeshStatus; }
  async ping(id: string): Promise<{ nodeId: string; latencyMs: number }> { return await this.request(`ping/${encodeURIComponent(id)}`, 'POST') as { nodeId: string; latencyMs: number }; }
}

export async function meshCommand(args: string[], flags = new Map<string, string>(), control: MeshControl = new DaemonMeshControl()): Promise<number> {
  const sub = args[0] ?? 'status';
  if (!['status', 'peers', 'ping'].includes(sub) || sub === 'ping' && (!args[1] || args.length !== 2) || sub !== 'ping' && args.length > 1) {
    console.error('Usage: vessel mesh status | peers | ping <peer-id>'); return 2;
  }
  try {
    if (sub === 'ping') {
      const result = await control.ping(args[1]!);
      console.log(flags.has('json') ? JSON.stringify(result) : `${result.nodeId} RTT ${result.latencyMs} ms`);
    } else {
      const state = await control.status();
      const connected = state.peers.filter(peer => peer.status !== 'offline');
      const averageLatencyMs = connected.length ? connected.reduce((sum, peer) => sum + peer.latencyMs, 0) / connected.length : 0;
      console.log(flags.has('json') ? JSON.stringify({ ...state, connectedPeers: connected.length, averageLatencyMs }) : sub === 'status'
        ? `Node UUID: ${state.nodeId}\nDaemon: running\nConnected peers: ${connected.length}\nAverage latency: ${averageLatencyMs.toFixed(1)} ms`
        : ['Node ID | Endpoint | Status | Roles | RTT (ms)', ...state.peers.map(peer => `${peer.nodeId} | ${peer.endpoint} | ${peer.status} | ${peer.roleCapabilities.join(', ')} | ${peer.latencyMs}`)].join('\n'));
    }
    return 0;
  } catch { console.error('Mesh control unavailable. Check vessel daemon status and mesh configuration.'); return 1; }
}
