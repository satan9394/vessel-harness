import { useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient, type ApiClient } from '../api';
import { appendRttSamples, pollDashboard, type MeshNodeView, type MeshSnapshot } from '../dashboard';
import './dashboard.css';

function NodeDetails({ node, local = false, samples = [] }: { node: MeshNodeView; local?: boolean; samples?: number[] }) {
  const peak = Math.max(1, ...samples);
  return <li className={`mesh-node mesh-${node.status}`}>
    <strong>{node.nodeId}</strong> {local && <span className="dashboard-tag">Local</span>}
    <span className={`dashboard-status mesh-${node.status}`}>{node.status}</span>
    <dl><dt>Endpoint</dt><dd>{node.endpoint}</dd><dt>Roles</dt><dd>{node.roleCapabilities.length ? node.roleCapabilities.join(', ') : 'No roles advertised'}</dd>
      <dt>Heartbeat RTT</dt><dd>{local ? 'Local node' : node.status === 'offline' ? 'Unavailable' : `${node.latencyMs} ms`}</dd>
      {!local && <><dt>Remote task activity</dt><dd>{node.remoteTasks === undefined ? 'No DAG snapshot observed. Select a DAG to inspect tasks.'
        : <>{node.remoteTasks.filter(task => ['running', 'claimed'].includes(task.status)).length} active / {node.remoteTasks.length} observed
          <ul>{node.remoteTasks.map(task => <li key={task.id}>{task.title} · {task.assignedRole} · {task.status}</li>)}</ul></>}</dd></>}
    </dl>
    {!local && samples.length > 1 && <svg className="mesh-waveform" viewBox="0 0 120 32" role="img" aria-label={`Recent heartbeat RTT for ${node.nodeId}`}>
      <title>{`Last ${samples.length} successful observations: ${samples.join(', ')} ms`}</title>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={samples.map((rtt, index) => `${2 + index * 116 / (samples.length - 1)},${30 - rtt / peak * 28}`).join(' ')} />
    </svg>}
  </li>;
}

/** SVG is a connection overview; the adjacent list exposes every full node field. */
export function SwarmTopologyPanel({ snapshot, samples = {} }: { snapshot: MeshSnapshot; samples?: Record<string, number[]> }) {
  if (!snapshot.configured) return <p className="dashboard-empty">Mesh is not configured.</p>;
  const height = Math.max(160, snapshot.peers.length * 84 + 40);
  const centerY = height / 2;
  return <>
    <p className="dashboard-meta">{snapshot.peers.length} peers · Observed <time dateTime={new Date(snapshot.observedAt).toISOString()}>{new Date(snapshot.observedAt).toLocaleString()}</time></p>
    <svg className="mesh-graph" viewBox={`0 0 640 ${height}`} role="img" aria-label="Swarm peer connections">
      <title>{`Local node connected to ${snapshot.peers.length} peers`}</title>
      {snapshot.peers.map((peer, index) => <g key={peer.nodeId} className={`mesh-${peer.status}`}>
        <line x1="130" y1={centerY} x2="460" y2={index * 84 + 60} className={`mesh-link${peer.status === 'offline' ? ' mesh-link-offline' : ''}`} />
        <circle cx="460" cy={index * 84 + 60} r="12" className="mesh-dot" />
        <text x="480" y={index * 84 + 55}>{peer.nodeId.length > 18 ? `${peer.nodeId.slice(0, 18)}…` : peer.nodeId}</text>
        <text x="480" y={index * 84 + 75} className="mesh-rtt">{peer.status} · {peer.status === 'offline' ? 'RTT unavailable' : `${peer.latencyMs} ms`}</text>
        <title>{`${peer.nodeId}: ${peer.endpoint}, ${peer.status}`}</title>
      </g>)}
      <circle cx="130" cy={centerY} r="20" className="mesh-local" />
      <text x="24" y={centerY - 32}>{snapshot.local?.nodeId ?? 'Local node'}</text>
    </svg>
    {snapshot.peers.length === 0 && <p className="dashboard-empty">No connected peers.</p>}
    <ul className="dashboard-cards" aria-label="Mesh nodes">
      {snapshot.local && <NodeDetails node={snapshot.local} local />}
      {snapshot.peers.map((peer) => <NodeDetails key={peer.nodeId} node={peer} samples={samples[peer.nodeId]} />)}
    </ul>
  </>;
}

export function SwarmTopologyView({ api: suppliedApi, refreshMs = 5000 }: { api?: Pick<ApiClient, 'meshPeers'>; refreshMs?: number }) {
  const api = useMemo(() => suppliedApi ?? createApiClient(), [suppliedApi]);
  const [snapshot, setSnapshot] = useState<MeshSnapshot | null>(null);
  const [samples, setSamples] = useState<Record<string, number[]>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [dagId, setDagId] = useState('');
  const [draftDagId, setDraftDagId] = useState('');
  const refresh = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    setSnapshot(null);
    setSamples({});
    setError('');
    const poll = pollDashboard(() => api.meshPeers(dagId || undefined), (value) => {
      setSnapshot(value); setSamples((previous) => appendRttSamples(previous, value.peers)); setError('');
    }, setError, refreshMs, setBusy);
    refresh.current = poll.refresh;
    return () => { poll.close(); refresh.current = () => Promise.resolve(); };
  }, [api, refreshMs, dagId]);
  return <section className="dashboard-panel" aria-label="Swarm topology" aria-busy={busy}>
    <header className="dashboard-heading"><h2>Swarm topology</h2><button className="btn" disabled={busy} onClick={() => { void refresh.current(); }}>{error ? 'Retry' : 'Refresh'}</button></header>
    <p className="dashboard-meta">Heartbeat state refreshes every {refreshMs / 1000} seconds.</p>
    <form className="dashboard-filters" onSubmit={event => { event.preventDefault(); setDagId(draftDagId.trim()); }}>
      <label>DAG ID <input value={draftDagId} maxLength={128} placeholder="Inspect observed remote tasks" onChange={event => setDraftDagId(event.target.value)} /></label>
      <button type="submit" className="btn">Inspect DAG</button>
    </form>
    {error && <p role="alert" className="error-text">{error}</p>}
    {!snapshot && busy && <p role="status">Loading mesh nodes…</p>}
    {snapshot && <SwarmTopologyPanel snapshot={snapshot} samples={samples} />}
  </section>;
}
export default SwarmTopologyView;
