import type { MessageKey } from '../../i18n';
import { useI18n } from '../LanguageProvider';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ImpactRadarWidget, DiffInspectorWidget } from '@vessel/shared';
import { createApiClient } from '../../api';
import type { ApiClient } from '../../api';
import type { CacheUsageMetrics } from '../../cacheUsage';
import type { InspectorObservation } from '../../inspector';
import SwarmTopologyView from '../SwarmTopologyView';
import CognitiveRulesDashboard from '../CognitiveRulesDashboard';
import AstImpactRadar from '../widgets/AstImpactRadar';
import InlineDiffInspector from '../widgets/InlineDiffInspector';
import './layout.css';

export const INSPECTOR_STORAGE_KEY = 'vessel.inspector';
export const INSPECTOR_TABS = ['swarm', 'cognition', 'cache', 'ast', 'patch'] as const;
export type InspectorTab = typeof INSPECTOR_TABS[number];
export interface DualSurfaceLayoutProps {
  children: ReactNode;
  inspectorDefaultOpen?: boolean;
  sessionId: string;
  api?: Pick<ApiClient, 'meshPeers' | 'cognitiveRules'> & Partial<Pick<ApiClient, 'applyPatch'>>;
  cacheHistory?: CacheUsageMetrics[];
  impacts?: ImpactRadarWidget[];
  patches?: DiffInspectorWidget[];
  observation?: InspectorObservation;
  tabRequest?: { tab: InspectorTab; serial: number };
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
  const { t } = useI18n();
  const latest = history.at(-1);
  const previousFingerprint = useRef<string | undefined>(undefined);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    setChanged(previousFingerprint.current !== undefined && observation?.workspace?.trackedFilesHash !== previousFingerprint.current);
    previousFingerprint.current = observation?.workspace?.trackedFilesHash;
  }, [observation?.workspace?.trackedFilesHash]);
  return <section className="dashboard-panel" aria-label={t('uiKVCacheEconomics')}>
    <h2>{t('uiKVCacheEconomics')}</h2>
    {latest ? <>
      <p>{t('uiBilledCacheHitRate')} <strong>{(latest.billedHitRate * 100).toFixed(1)}%</strong> · {latest.provider} / {latest.model}</p>
      <p>{latest.cachedTokens}  {t('uiCached')} {latest.promptTokens}  {t('uiPromptTokens')} {latest.creationTokens}  {t('uiCreated')}</p>
      <p>{t('uiEstimatedSavings')}{latest.estimatedSavingsUsd.toFixed(4)}{latest.estimated && t('estimatedUsage')}</p>
      {history.length > 1 && <svg viewBox="0 0 300 80" className="cache-waveform" role="img" aria-label={t('uiObservedBilledCacheHitRateHistory')}><title>{history.map(sample => `${(sample.billedHitRate * 100).toFixed(1)}%`).join(', ')}</title><polyline fill="none" stroke="currentColor" strokeWidth="2" points={history.map((sample, index) => `${2 + index * 296 / (history.length - 1)},${78 - Math.max(0, Math.min(1, sample.billedHitRate)) * 76}`).join(' ')} /></svg>}
      <p className="dim">{t('uiLast')} {history.length}  {t('uiObservedModelCallsInThisSession')}</p>
    </> : <p className="dim">{t('uiNoCacheUsageObservedInThisSession')}</p>}
    <h3>{t('uiWorkspaceFingerprint')}</h3>
    {observation?.workspace ? <><code className="workspace-fingerprint">{observation.workspace.trackedFilesHash}</code><p role="status">{changed ? t('uiFingerprintChangedSinceThePreviousObservation') : t('uiObservedWorkspaceFingerprint')}</p><p>{observation.workspace.fileCount}  {t('uiTrackedFiles')} {observation.workspace.uncommittedDiffBytes}  {t('uiUncommittedDiffBytes')}</p></> : <p className="dim">{t('uiNoWorkspaceFingerprintObserved')}</p>}
    <h3>{t('uiPromptPrefixSegments')}</h3>
    {observation?.prefix ? <><ol className="prefix-segments"><li>{t('uiStable')} {observation.prefix.stableBytes}  {t('uiBytes')}</li><li>{t('uiScoped')} {observation.prefix.scopedBytes}  {t('uiBytes')}</li><li>{t('uiVolatile')} {observation.prefix.volatileBytes}  {t('uiBytes')}</li></ol><p>{t('uiPrefixSHA256')}</p><code className="workspace-fingerprint">{observation.prefix.sha256}</code></> : <p className="dim">{t('uiNoPromptPrefixSegmentsObserved')}</p>}
  </section>;
}

export function AstTopologyPanel({ impacts = [] }: { impacts?: ImpactRadarWidget[] }) {
  const { t } = useI18n();
  return <section className="dashboard-panel" aria-label={t('uiASTSymbolDependencies')}><h2>{t('uiASTSymbolDependencies')}</h2>
    <p className="dim">{t('uiObservedImpactReportsForThisSession')}</p>
    {impacts.length ? impacts.map(widget => <div key={widget.id}>
      <svg className="impact-topology" viewBox={`0 0 400 ${Math.max(70, widget.payload.blastRadius.affectedCallers.length * 45 + 25)}`} role="img" aria-label={t('observedCallers', { symbol: widget.payload.targetSymbol })}>
        <title>{t('reportedCallers', { count: String(widget.payload.blastRadius.affectedCallers.length), symbol: widget.payload.targetSymbol })}</title>
        <text x="8" y="20">{widget.payload.targetSymbol}</text>
        {widget.payload.blastRadius.affectedCallers.map((caller, index) => <g key={`${caller.filePath}:${caller.symbolName}:${index}`}><path d={`M 20 28 V ${index * 45 + 50} H 60`} fill="none" stroke="currentColor" /><text x="65" y={index * 45 + 55}>{caller.symbolName}</text></g>)}
      </svg><AstImpactRadar widget={widget} /></div>) : <p className="dim">{t('uiNoASTImpactReportsObserved')}</p>}
  </section>;
}

export function PatchCanvasPanel({ sessionId, patches = [], api }: { sessionId: string; patches?: DiffInspectorWidget[]; api?: Pick<ApiClient, 'applyPatch'> }) {
  const { t } = useI18n();
  return <section className="dashboard-panel" aria-label={t('uiPatchWorkbench')}><h2>{t('uiPatchWorkbench')}</h2>
    <p className="dim">{t('uiReviewTextChangesOneHunkAtATime')}</p>
    {patches.length ? patches.map(widget => <InlineDiffInspector key={`${sessionId}:${widget.id}`} sessionId={sessionId}
      widget={{ ...widget, payload: { ...widget.payload, collapsedByDefault: false } }}
      onAction={async (hunkId, action) => { await (api ?? createApiClient()).applyPatch(sessionId, widget.id, hunkId, action); }} />)
      : <p className="dim">{t('uiNoPatchProposalsObservedInThisSession')}</p>}
  </section>;
}
export const INSPECTOR_LABELS: Record<InspectorTab, MessageKey> = { swarm: 'tabSwarm', cognition: 'tabRules', cache: 'tabCache', ast: 'tabImpact', patch: 'tabPatch' };
export function DualSurfaceLayout({ children, inspectorDefaultOpen = false, sessionId, api, cacheHistory, impacts, patches, observation, tabRequest }: DualSurfaceLayoutProps) {
  const { t } = useI18n();
  const [state, setState] = useState(() => browserInspectorState(inspectorDefaultOpen));
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const modal = state.open && narrow;
  useEffect(() => {
    if (tabRequest) setState({ open: true, tab: tabRequest.tab });
  }, [tabRequest?.tab, tabRequest?.serial]);
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
      if (!event.defaultPrevented && !document.querySelector('[role="dialog"]') && isInspectorShortcut(event, Boolean(target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')))) {
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
      <div className="inspector-toolbar"><button ref={toggle} className="btn" aria-expanded={state.open} aria-controls={`${id}-inspector`} title={t('uiToggleInspectorCtrlCmdI')} onClick={() => setState(value => ({ ...value, open: !value.open }))}>{state.open ? t('uiCollapseInspector') : t('uiOpenInspector')}</button></div>
      {children}
    </div>
    {state.open && <>
      {modal && <div className="inspector-backdrop" onClick={() => setState(value => ({ ...value, open: false }))} />}
      <div className="docked-inspector" id={`${id}-inspector`} ref={panel} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-label={t('uiSessionInspector')} tabIndex={-1}>
        <header className="inspector-heading"><strong>{t('inspectorTitle')}</strong><button className="btn" onClick={() => setState(value => ({ ...value, open: false }))} aria-label={t('uiCloseInspector')}>{t('close')}</button></header>
        <div className="inspector-tabs" role="tablist" aria-label={t('uiInspectorPanels')}>{INSPECTOR_TABS.map((tab, index) => <button key={tab} id={`${id}-${tab}`} className="btn" role="tab" aria-selected={state.tab === tab} aria-controls={`${id}-panel`} tabIndex={state.tab === tab ? 0 : -1} onClick={() => setState(value => ({ ...value, tab }))} onKeyDown={event => {
          const count = INSPECTOR_TABS.length;
          const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
          if (next < 0) return; event.preventDefault(); setState(value => ({ ...value, tab: INSPECTOR_TABS[next] })); document.getElementById(`${id}-${INSPECTOR_TABS[next]}`)?.focus();
        }}>{t(INSPECTOR_LABELS[tab])}</button>)}</div>
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${state.tab}`} className="inspector-content" key={sessionId}>
          {state.tab === 'swarm' && <SwarmTopologyView api={api} />}
          {state.tab === 'cognition' && <CognitiveRulesDashboard api={api} />}
          {state.tab === 'cache' && <CacheEconomicsPanel history={cacheHistory} observation={observation} />}
          {state.tab === 'ast' && <AstTopologyPanel impacts={impacts} />}
          {state.tab === 'patch' && <PatchCanvasPanel sessionId={sessionId} patches={patches} api={api?.applyPatch ? { applyPatch: api.applyPatch } : undefined} />}
        </div>
      </div>
    </>}
  </div>;
}
