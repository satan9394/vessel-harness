import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient } from '../../api';
import { appendRttSamples, pollDashboard, type MeshSnapshot } from '../../dashboard';
import { SwarmTopologyPanel, SwarmTopologyView } from '../SwarmTopologyView';

const snapshot: MeshSnapshot = { configured: true, observedAt: 1000,
  local: { nodeId: 'local', endpoint: 'http://127.0.0.1:5678', roleCapabilities: ['planner'], status: 'online', latencyMs: 0 },
  peers: [
    { nodeId: 'peer-online', endpoint: 'http://peer:3000', roleCapabilities: ['worker', 'reviewer'], status: 'online', latencyMs: 23 },
    { nodeId: 'peer-busy', endpoint: 'http://busy:3000', roleCapabilities: ['worker'], status: 'busy', latencyMs: 50 },
    { nodeId: 'peer-offline', endpoint: 'http://offline:3000', roleCapabilities: [], status: 'offline', latencyMs: 12 },
  ] };
afterEach(() => { vi.useRealTimers(); });

describe('SwarmTopologyView', () => {
  it('shows observed remote task activity without inventing load for absent snapshots', async () => {
    const html = renderToStaticMarkup(<SwarmTopologyPanel snapshot={{ ...snapshot, peers: [{ ...snapshot.peers[0]!, remoteTasks: [{ id: 't', title: 'Review patch', assignedRole: 'evaluator', status: 'running' }] }, snapshot.peers[1]!] }} />);
    expect(html).toContain('1 active / 1 observed');
    expect(html).toContain('Review patch');
    expect(html).toContain('No DAG snapshot observed');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(snapshot)));
    await createApiClient({ fetch: fetcher }).meshPeers('dag/1');
    expect(fetcher.mock.calls[0]![0]).toBe('/api/mesh/peers?dagId=dag%2F1');
  });
  it('renders SVG connections and complete local/peer details with explicit connectivity and RTT', () => {
    const html = renderToStaticMarkup(<SwarmTopologyPanel snapshot={snapshot} />);
    expect(html).toContain('role="img"');
    expect(html.match(/<line /g)).toHaveLength(3);
    for (const node of [snapshot.local!, ...snapshot.peers]) {
      expect(html).toContain(node.nodeId);
      expect(html).toContain(node.endpoint);
      expect(html).toContain(node.status);
      for (const role of node.roleCapabilities) expect(html).toContain(role);
    }
    expect(html).toContain('23 ms');
    expect(html).toContain('RTT unavailable');
    expect(html).not.toContain('12 ms'); // stale latency must not imply offline connectivity
    expect(html).toContain('mesh-link-offline');
    expect(html).toContain('Local node');
  });

  it('distinguishes unconfigured mesh, no peers and initial loading', () => {
    expect(renderToStaticMarkup(<SwarmTopologyPanel snapshot={{ ...snapshot, configured: false, local: null, peers: [] }} />)).toContain('Mesh is not configured');
    expect(renderToStaticMarkup(<SwarmTopologyPanel snapshot={{ ...snapshot, peers: [] }} />)).toContain('No connected peers');
    const html = renderToStaticMarkup(<SwarmTopologyView api={{ meshPeers: async () => snapshot }} />);
    expect(html).toContain('Loading mesh nodes');
    expect(html).toContain('aria-busy="true"');
  });

  it('renders bounded RTT waveforms without recording offline values or removed peers', () => {
    const samples = appendRttSamples({ 'peer-online': Array.from({ length: 20 }, (_, i) => i), 'removed': [99] }, snapshot.peers);
    expect(samples['peer-online']).toHaveLength(20);
    expect(samples['peer-online']![0]).toBe(1);
    expect(samples['peer-online']![19]).toBe(23);
    expect(samples['peer-offline']).toEqual([]);
    expect(samples['removed']).toBeUndefined();
    const html = renderToStaticMarkup(<SwarmTopologyPanel snapshot={snapshot} samples={samples} />);
    expect(html).toContain('<polyline');
    expect(html).toContain('Recent heartbeat RTT for peer-online');
    expect(html).not.toContain('Recent heartbeat RTT for peer-offline');
  });

  it('refreshes heartbeat RTT/status from authenticated read-only snapshots', async () => {
    vi.useFakeTimers();
    const updated = { ...snapshot, peers: [{ ...snapshot.peers[0]!, status: 'busy' as const, latencyMs: 75 }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated)));
    const api = createApiClient({ fetch: fetcher, token: () => 'fixture-token' });
    const receive = vi.fn();
    const poll = pollDashboard(() => api.meshPeers(), receive, vi.fn(), 5000);
    await poll.ready;
    await vi.advanceTimersByTimeAsync(5000);
    expect(receive.mock.lastCall?.[0].peers[0]).toMatchObject({ status: 'busy', latencyMs: 75 });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/mesh/peers', '/api/mesh/peers']);
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });
    expect(fetcher.mock.calls[0]![1]?.method).toBeUndefined();
    poll.close();
  });

  it('does not overlap slow reads or deliver late snapshots after teardown', async () => {
    vi.useFakeTimers();
    let resolve!: (value: MeshSnapshot) => void;
    const read = vi.fn(() => new Promise<MeshSnapshot>((done) => { resolve = done; }));
    const receive = vi.fn();
    const busy = vi.fn();
    const poll = pollDashboard(read, receive, vi.fn(), 5000, busy);
    await Promise.resolve();
    expect(poll.refresh()).toBe(poll.ready);
    await vi.advanceTimersByTimeAsync(15000);
    expect(read).toHaveBeenCalledOnce();
    poll.close();
    resolve(snapshot);
    await poll.ready;
    await vi.advanceTimersByTimeAsync(15000);
    expect(receive).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
    expect(busy.mock.calls).toEqual([[true]]);
  });

  it('surfaces read failures, supports retry, and clears scheduled refresh on close', async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<MeshSnapshot>>().mockRejectedValueOnce(new Error('Unauthorized')).mockResolvedValue(snapshot);
    const fail = vi.fn();
    const receive = vi.fn();
    const poll = pollDashboard(read, receive, fail, 5000);
    await poll.ready;
    expect(fail).toHaveBeenCalledWith('Unauthorized');
    await poll.refresh();
    expect(receive).toHaveBeenCalledWith(snapshot);
    poll.close();
    await vi.advanceTimersByTimeAsync(5000);
    await poll.refresh();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
