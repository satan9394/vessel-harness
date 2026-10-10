import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ImpactRadarWidget } from '@vessel/shared';
import type { ApiClient } from '../../api';
import type { CacheUsageMetrics } from '../../cacheUsage';
import type { InspectorObservation } from '../../inspector';
import SwarmTopologyView from '../SwarmTopologyView';
import CognitiveRulesDashboard from '../CognitiveRulesDashboard';
import AstImpactRadar from '../widgets/AstImpactRadar';
import './layout.css';

export const INSPECTOR_STORAGE_KEY = 'vessel.inspector';
export const INSPECTOR_TABS = ['swarm', 'cognition', 'cache', 'ast'] as const;
export type InspectorTab = typeof INSPECTOR_TABS[number];
export interface DualSurfaceLayoutProps {
  children: ReactNode;
  inspectorDefaultOpen?: boolean;
  sessionId: string;
  api?: Pick<ApiClient, 'meshPeers' | 'cognitiveRules'>;
  cacheHistory?: CacheUsageMetrics[];
  impacts?: ImpactRadarWidget[];
  observation?: InspectorObservation;
}
export function readInspectorState(storage: Pick<Storage, 'getItem'> | undefined, defaultOpen: boolean) {
  try {
    const value: unknown = JSON.parse(storage?.getItem(INSPECTOR_STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const state = value as { open?: unknown; tab?: unknown };
      return { open: typeof state.open === 'boolean' ? state.open : defaultOpen,
        tab: INSPECTOR_TABS.includes(state.tab as InspectorTab) ? state.tab as InspectorTab : 'swarm' as InspectorTab };
    }
  } catch { /* Storage may be disabled or contain an older value. */ }
  return { open: defaultOpen, tab: 'swarm' as InspectorTab };
}
function browserInspectorState(defaultOpen: boolean) {
  try { return readInspectorState(typeof window === 'undefined' ? undefined : window.localStorage, defaultOpen); }
  catch { return readInspectorState(undefined, defaultOpen); }
}
export function isInspectorShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, editable: boolean) {
  return !editable && !event.altKey && !event.shiftKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i';
}
export function appendCacheObservation(history: CacheUsageMetrics[], sample: CacheUsageMetrics): CacheUsageMetrics[] {
  return [...history.slice(-39), sample];
}

export function CacheEconomicsPanel({ history = [], observation }: { history?: CacheUsageMetrics[]; observation?: InspectorObservation }) {
  const latest = history.at(-1);
  const previousFingerprint = useRef<string | undefined>(undefined);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    setChanged(previousFingerprint.current !== undefined && observation?.workspace?.trackedFilesHash !== previousFingerprint.current);
    previousFingerprint.current = observation?.workspace?.trackedFilesHash;
  }, [observation?.workspace?.trackedFilesHash]);
  return <section className="dashboard-panel" aria-label="KV Cache economics">
    <h2>KV Cache economics</h2>
    {latest ? <>
      <p>Billed cache hit rate <strong>{(latest.billedHitRate * 100).toFixed(1)}%</strong> · {latest.provider} / {latest.model}</p>
      <p>{latest.cachedTokens} cached / {latest.promptTokens} prompt tokens · {latest.creationTokens} created</p>
      <p>Estimated savings ${latest.estimatedSavingsUsd.toFixed(4)}{latest.estimated && ' · Estimated usage'}</p>
      {history.length > 1 && <svg viewBox="0 0 300 80" className="cache-waveform" role="img" aria-label="Observed billed cache hit rate history"><title>{history.map(sample => `${(sample.billedHitRate * 100).toFixed(1)}%`).join(', ')}</title><polyline fill="none" stroke="currentColor" strokeWidth="2" points={history.map((sample, index) => `${2 + index * 296 / (history.length - 1)},${78 - Math.max(0, Math.min(1, sample.billedHitRate)) * 76}`).join(' ')} /></svg>}
      <p className="dim">Last {history.length} observed model calls in this session.</p>
    </> : <p className="dim">No cache usage observed in this session.</p>}
    <h3>Workspace fingerprint</h3>
    {observation?.workspace ? <><code className="workspace-fingerprint">{observation.workspace.trackedFilesHash}</code><p role="status">{changed ? 'Fingerprint changed since the previous observation.' : 'Observed workspace fingerprint.'}</p><p>{observation.workspace.fileCount} tracked files · {observation.workspace.uncommittedDiffBytes} uncommitted diff bytes</p></> : <p className="dim">No workspace fingerprint observed.</p>}
    <h3>Prompt prefix segments</h3>
    {observation?.prefix ? <><ol className="prefix-segments"><li>Stable · {observation.prefix.stableBytes} bytes</li><li>Scoped · {observation.prefix.scopedBytes} bytes</li><li>Volatile · {observation.prefix.volatileBytes} bytes</li></ol><p>Prefix SHA-256</p><code className="workspace-fingerprint">{observation.prefix.sha256}</code></> : <p className="dim">No prompt prefix segments observed.</p>}
  </section>;
}

export function AstTopologyPanel({ impacts = [] }: { impacts?: ImpactRadarWidget[] }) {
  return <section className="dashboard-panel" aria-label="AST symbol dependencies"><h2>AST symbol dependencies</h2>
    <p className="dim">Observed impact reports for this session.</p>
    {impacts.length ? impacts.map(widget => <div key={widget.id}>
      <svg className="impact-topology" viewBox={`0 0 400 ${Math.max(70, widget.payload.blastRadius.affectedCallers.length * 45 + 25)}`} role="img" aria-label={`Observed callers of ${widget.payload.targetSymbol}`}>
        <title>{`${widget.payload.blastRadius.affectedCallers.length} reported callers of ${widget.payload.targetSymbol}`}</title>
        <text x="8" y="20">{widget.payload.targetSymbol}</text>
        {widget.payload.blastRadius.affectedCallers.map((caller, index) => <g key={`${caller.filePath}:${caller.symbolName}:${index}`}><path d={`M 20 28 V ${index * 45 + 50} H 60`} fill="none" stroke="currentColor" /><text x="65" y={index * 45 + 55}>{caller.symbolName}</text></g>)}
      </svg><AstImpactRadar widget={widget} /></div>) : <p className="dim">No AST impact reports observed.</p>}
  </section>;
}

const labels: Record<InspectorTab, string> = { swarm: 'Swarm', cognition: 'Cognition', cache: 'KV Cache', ast: 'AST' };
export function DualSurfaceLayout({ children, inspectorDefaultOpen = false, sessionId, api, cacheHistory, impacts, observation }: DualSurfaceLayoutProps) {
  const [state, setState] = useState(() => browserInspectorState(inspectorDefaultOpen));
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const modal = state.open && narrow;
  useEffect(() => {
    try { window.localStorage.setItem(INSPECTOR_STORAGE_KEY, JSON.stringify(state)); } catch { /* Optional persistence. */ }
  }, [state]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const resize = () => setNarrow(media.matches);
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isInspectorShortcut(event, Boolean(target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')))) {
        event.preventDefault(); setState(previous => ({ ...previous, open: !previous.open }));
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = panel.current;
    dialog?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setState(value => ({ ...value, open: false })); }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); (previous?.isConnected ? previous : toggle.current)?.focus(); };
  }, [modal]);
  return <div className={`dual-surface${state.open ? ' inspector-open' : ''}`} data-session-id={sessionId}>
    <div className="chat-surface" inert={modal}>
      <div className="inspector-toolbar"><button ref={toggle} className="btn" aria-expanded={state.open} aria-controls={`${id}-inspector`} title="Toggle Inspector (Ctrl/Cmd+I)" onClick={() => setState(value => ({ ...value, open: !value.open }))}>{state.open ? 'Collapse Inspector' : 'Open Inspector'}</button></div>
      {children}
    </div>
    {state.open && <>
      {modal && <div className="inspector-backdrop" onClick={() => setState(value => ({ ...value, open: false }))} />}
      <div className="docked-inspector" id={`${id}-inspector`} ref={panel} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-label="Session Inspector" tabIndex={-1}>
        <header className="inspector-heading"><strong>Inspector</strong><button className="btn" onClick={() => setState(value => ({ ...value, open: false }))} aria-label="Close Inspector">Close</button></header>
        <div className="inspector-tabs" role="tablist" aria-label="Inspector panels">{INSPECTOR_TABS.map((tab, index) => <button key={tab} id={`${id}-${tab}`} className="btn" role="tab" aria-selected={state.tab === tab} aria-controls={`${id}-panel`} tabIndex={state.tab === tab ? 0 : -1} onClick={() => setState(value => ({ ...value, tab }))} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % 4 : event.key === 'ArrowLeft' ? (index + 3) % 4 : event.key === 'Home' ? 0 : event.key === 'End' ? 3 : -1;
          if (next < 0) return; event.preventDefault(); setState(value => ({ ...value, tab: INSPECTOR_TABS[next] })); document.getElementById(`${id}-${INSPECTOR_TABS[next]}`)?.focus();
        }}>{labels[tab]}</button>)}</div>
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${state.tab}`} className="inspector-content" key={sessionId}>
          {state.tab === 'swarm' && <SwarmTopologyView api={api} />}
          {state.tab === 'cognition' && <CognitiveRulesDashboard api={api} />}
          {state.tab === 'cache' && <CacheEconomicsPanel history={cacheHistory} observation={observation} />}
          {state.tab === 'ast' && <AstTopologyPanel impacts={impacts} />}
        </div>
      </div>
    </>}
  </div>;
}
