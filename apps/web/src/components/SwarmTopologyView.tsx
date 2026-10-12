import { localizedValue } from '../i18n';
import { useI18n } from './LanguageProvider';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient, type ApiClient } from '../api';
import { appendRttSamples, pollDashboard, type MeshNodeView, type MeshSnapshot } from '../dashboard';
import './dashboard.css';

function NodeDetails({ node, local = false, samples = [] }: { node: MeshNodeView; local?: boolean; samples?: number[] }) {
  const { t } = useI18n();
  const peak = Math.max(1, ...samples);
  return <li className={`mesh-node mesh-${node.status}`}>
    <strong>{node.nodeId}</strong> {local && <span className="dashboard-tag">{t('uiLocal')}</span>}
    <span className={`dashboard-status mesh-${node.status}`}>{localizedValue(node.status, t)}</span>
    <dl><dt>{t('uiEndpoint')}</dt><dd>{node.endpoint}</dd><dt>{t('uiRoles')}</dt><dd>{node.roleCapabilities.length ? node.roleCapabilities.map(role => localizedValue(role, t)).join(', ') : t('uiNoRolesAdvertised')}</dd>
      <dt>{t('uiHeartbeatRTT')}</dt><dd>{local ? t('uiLocalNode') : node.status === 'offline' ? t('uiUnavailable') : t('timeMilliseconds', { value: String(node.latencyMs) })}</dd>
      {!local && <><dt>{t('uiRemoteTaskActivity')}</dt><dd>{node.remoteTasks === undefined ? t('uiNoDAGSnapshotObservedSelectADAGTo')
        : <>{node.remoteTasks.filter(task => ['running', 'claimed'].includes(task.status)).length}  {t('uiActive')} {node.remoteTasks.length}  {t('uiObserved')} <ul>{node.remoteTasks.map(task => <li key={task.id}>{task.title} · {localizedValue(task.assignedRole, t)} · {localizedValue(task.status, t)}</li>)}</ul></>}</dd></>}
    </dl>
    {!local && samples.length > 1 && <svg className="mesh-waveform" viewBox="0 0 120 32" role="img" aria-label={t('heartbeatHistory', { node: node.nodeId })}>
      <title>{t('heartbeatSamples', { count: String(samples.length), samples: samples.join(', ') })}</title>
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={samples.map((rtt, index) => `${2 + index * 116 / (samples.length - 1)},${30 - rtt / peak * 28}`).join(' ')} />
    </svg>}
  </li>;
}

/** SVG is a connection overview; the adjacent list exposes every full node field. */
export function SwarmTopologyPanel({ snapshot, samples = {} }: { snapshot: MeshSnapshot; samples?: Record<string, number[]> }) {
  const { t } = useI18n();
  if (!snapshot.configured) return <p className="dashboard-empty">{t('uiMeshIsNotConfigured')}</p>;
  const height = Math.max(160, snapshot.peers.length * 84 + 40);
  const centerY = height / 2;
  return <>
    <p className="dashboard-meta">{snapshot.peers.length}  {t('uiPeersObserved')} <time dateTime={new Date(snapshot.observedAt).toISOString()}>{new Date(snapshot.observedAt).toLocaleString()}</time></p>
    <svg className="mesh-graph" viewBox={`0 0 640 ${height}`} role="img" aria-label={t('uiSwarmPeerConnections')}>
      <title>{t('localConnections', { count: String(snapshot.peers.length) })}</title>
      {snapshot.peers.map((peer, index) => <g key={peer.nodeId} className={`mesh-${peer.status}`}>
        <line x1="130" y1={centerY} x2="460" y2={index * 84 + 60} className={`mesh-link${peer.status === 'offline' ? ' mesh-link-offline' : ''}`} />
        <circle cx="460" cy={index * 84 + 60} r="12" className="mesh-dot" />
        <text x="480" y={index * 84 + 55}>{peer.nodeId.length > 18 ? `${peer.nodeId.slice(0, 18)}…` : peer.nodeId}</text>
        <text x="480" y={index * 84 + 75} className="mesh-rtt">{localizedValue(peer.status, t)} · {peer.status === 'offline' ? t('uiRTTUnavailable') : t('timeMilliseconds', { value: String(peer.latencyMs) })}</text>
        <title>{`${peer.nodeId}: ${peer.endpoint}, ${localizedValue(peer.status, t)}`}</title>
      </g>)}
      <circle cx="130" cy={centerY} r="20" className="mesh-local" />
      <text x="24" y={centerY - 32}>{snapshot.local?.nodeId ?? t('uiLocalNode')}</text>
    </svg>
    {snapshot.peers.length === 0 && <p className="dashboard-empty">{t('uiNoConnectedPeers')}</p>}
    <ul className="dashboard-cards" aria-label={t('uiMeshNodes')}>
      {snapshot.local && <NodeDetails node={snapshot.local} local />}
      {snapshot.peers.map((peer) => <NodeDetails key={peer.nodeId} node={peer} samples={samples[peer.nodeId]} />)}
    </ul>
  </>;
}

export function SwarmTopologyView({ api: suppliedApi, refreshMs = 5000 }: { api?: Pick<ApiClient, 'meshPeers'>; refreshMs?: number }) {
  const { t } = useI18n();
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
  return <section className="dashboard-panel" aria-label={t('uiSwarmTopology')} aria-busy={busy}>
    <header className="dashboard-heading"><h2>{t('uiSwarmTopology')}</h2><button className="btn" disabled={busy} onClick={() => { void refresh.current(); }}>{error ? t('retry') : t('uiRefresh')}</button></header>
    <p className="dashboard-meta">{t('uiHeartbeatStateRefreshesEvery')} {refreshMs / 1000}  {t('uiSeconds')}</p>
    <form className="dashboard-filters" onSubmit={event => { event.preventDefault(); setDagId(draftDagId.trim()); }}>
      <label>{t('uiDAGID')} <input value={draftDagId} maxLength={128} placeholder={t('uiInspectObservedRemoteTasks')} onChange={event => setDraftDagId(event.target.value)} /></label>
      <button type="submit" className="btn">{t('uiInspectDAG')}</button>
    </form>
    {error && <p role="alert" className="error-text">{error}</p>}
    {!snapshot && busy && <p role="status">{t('uiLoadingMeshNodes')}</p>}
    {snapshot && <SwarmTopologyPanel snapshot={snapshot} samples={samples} />}
  </section>;
}
export default SwarmTopologyView;
