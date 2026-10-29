import { useI18n } from './LanguageProvider';
import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, SessionMeta } from '../api';
import { projectName } from './TaskComposer';
import { ROUTE_MODES, routeLabel, type RouteMode, type RouteState } from '../team';
import type { UsageTotals } from './UsageBar';
import type { TalkingMetrics } from './TalkingMetricsBar';
import './composerMeters.css';

/** Permission tier → dictionary key (B16 status dictionary reuse, no new words). */
export function permissionLabelKey(permission: unknown): 'permissionReadOnly' | 'permissionWorkspaceWrite' | 'permissionDangerFull' | null {
  return permission === 'read-only' ? 'permissionReadOnly'
    : permission === 'workspace-write' ? 'permissionWorkspaceWrite'
    : permission === 'danger-full-access' ? 'permissionDangerFull'
    : null;
}

/** Context-window fill ratio from real capability + usage (undefined when unknown). */
export function contextOccupancy(usage: UsageTotals, contextWindow?: number): number | undefined {
  if (!contextWindow || contextWindow <= 0) return undefined;
  const used = usage.inputTokens + usage.cacheReadTokens;
  return Math.max(0, Math.min(1, used / contextWindow));
}

/** Approval tier the capsules show: the session's real permission, else the pending default. */
export function approvalTier(session: SessionMeta | undefined, fallback?: string): string | undefined {
  const value = session?.permission ?? fallback;
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Model-capsule label. `session.model` is often a placeholder (`default`) that
 * says nothing to a user, so:
 *  - the offline demo provider reads as the localized "demo model" wording;
 *  - real sessions read as `provider / model`;
 *  - placeholders fall back to the provider alone, and only a fully empty
 *    session renders the em dash (never a bare `default`).
 */
export const PLACEHOLDER_MODELS: ReadonlySet<string> = new Set(['default', 'unknown', 'n/a', 'none', '-', '—', '']);

export type ModelLabel =
  | { kind: 'offline' }
  | { kind: 'named'; text: string }
  | { kind: 'unknown' };

export function resolveModelLabel(provider?: string | null, model?: string | null): ModelLabel {
  const providerText = typeof provider === 'string' ? provider.trim() : '';
  const modelText = typeof model === 'string' ? model.trim() : '';
  if (!providerText && !modelText) return { kind: 'unknown' };
  if (providerText === 'mock') return { kind: 'offline' };
  const real = modelText && !PLACEHOLDER_MODELS.has(modelText.toLowerCase()) ? modelText : '';
  if (providerText && real) return { kind: 'named', text: `${providerText} / ${real}` };
  if (real) return { kind: 'named', text: real };
  if (providerText) return { kind: 'named', text: providerText };
  return { kind: 'unknown' };
}

export interface ComposerCapsulesProps {
  api: ApiClient;
  sessionId: string;
  /** Default permission for a not-yet-materialised session (workbench composer). */
  fallbackPermission?: string;
  /** Default route mode before the server snapshot resolves. */
  fallbackMode?: RouteMode;
  onModeChange?: (mode: RouteMode) => void;
}

/**
 * Resolve the session model's declared context window from `/api/models`
 * (B2 capability negotiation). Returns undefined when unknown — the meter then
 * shows `—` rather than a fabricated number.
 */
export function useContextWindow(api: ApiClient, sessionId: string, revision = 0): number | undefined {
  const [contextWindow, setContextWindow] = useState<number | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(api.getSession?.(sessionId))
      .then(({ session }) => {
        if (!session?.model) return undefined;
        return api.listModels().then((catalog) => catalog.models.find((m) => m.id === session.model || m.name === session.model));
      })
      .then((model) => {
        const cap = model?.capabilities?.contextWindow;
        if (alive) setContextWindow(cap && cap.status !== 'unknown' ? cap.value : undefined);
      })
      .catch(() => { if (alive) setContextWindow(undefined); });
    return () => { alive = false; };
  }, [api, sessionId, revision]);
  return contextWindow;
}

/**
 * Input-area capsule row (P5, DESIGN.md §4.2): Project / Model / Approval tier /
 * Mode. Every capsule reads real state — project name from the session meta,
 * model + capability from `ModelSelector`, approval tier from the session
 * permission, and the Auto/Fast/Pro route mode from `GET /api/sessions/:id/route`.
 * Nothing here invents a value it cannot source.
 */
export default function ComposerCapsules({ api, sessionId, fallbackPermission, fallbackMode = 'auto', onModeChange }: ComposerCapsulesProps) {
  const { t } = useI18n();
  const [session, setSession] = useState<SessionMeta>();
  const [route, setRoute] = useState<RouteState | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(api.getSession?.(sessionId)).then(({ session: meta }) => { if (alive) setSession(meta); }).catch(() => { /* capsule shows the fallback */ });
    void Promise.resolve(api.getRoute?.(sessionId)).then((state) => { if (alive) setRoute(state); }).catch(() => { /* mode falls back to auto */ });
    return () => { alive = false; };
  }, [api, sessionId]);
  const mode = route?.mode ?? fallbackMode;
  const permission = approvalTier(session, fallbackPermission);
  const permissionKey = permissionLabelKey(permission);
  const modelLabel = resolveModelLabel(session?.provider, session?.model);
  const resolved = routeLabel(route?.route);
  // B1: set mode / resolve the actual model / lock (pin) the resolution for the session.
  const changeMode = useCallback(async (next: RouteMode) => {
    onModeChange?.(next);
    if (!api.setRouteMode) return;
    try { setRoute(await api.setRouteMode(sessionId, next)); } catch { /* keep the previous value */ }
  }, [api, sessionId, onModeChange]);
  const resolve = useCallback(async () => {
    if (!api.resolveRoute) return;
    setRouteBusy(true);
    try { setRoute(await api.resolveRoute(sessionId)); } catch { /* best effort */ } finally { setRouteBusy(false); }
  }, [api, sessionId]);
  const togglePin = useCallback(async () => {
    const fn = route?.pinned ? api.unpinRoute : api.pinRoute;
    if (!fn) return;
    setRouteBusy(true);
    try { setRoute(await fn(sessionId)); } catch { /* best effort */ } finally { setRouteBusy(false); }
  }, [api, sessionId, route?.pinned]);
  return (
    <div className="composer-capsules" role="group" aria-label={t('uiMode')}>
      <span className="capsule"><span className="capsule-k">{t('uiProject')}</span><b>{session ? projectName(session.workspaceRoot) : '—'}</b></span>
      <span className="capsule"><span className="capsule-k">{t('uiModel')}</span><b title={modelLabel.kind === 'named' ? modelLabel.text : undefined}>{modelLabel.kind === 'offline' ? t('modelOffline') : modelLabel.kind === 'named' ? modelLabel.text : '—'}</b></span>
      <span className="capsule capsule-solid"><span className="capsule-k">{t('uiApprovalTier')}</span><b>{permissionKey ? t(permissionKey) : '—'}</b></span>
      <span className="capsule capsule-modes">
        <span className="capsule-k">{t('uiMode')}</span>
        {ROUTE_MODES.map((value) => (
          <button key={value} type="button" className={`mode-pill${mode === value ? ' mode-pill-active' : ''}`} aria-pressed={mode === value} onClick={() => void changeMode(value)}>{t(value === 'auto' ? 'modelAuto' : value === 'fast' ? 'modelFast' : 'modelPro')}</button>
        ))}
        <button type="button" className="mode-pill mode-resolve" disabled={routeBusy} title={t('uiResolveTheActualModelForThisMode')} onClick={() => void resolve()}>{t('uiResolve')}</button>
        <button type="button" className={`mode-pill mode-pin${route?.pinned ? ' mode-pill-active' : ''}`} disabled={routeBusy} aria-pressed={Boolean(route?.pinned)} title={route?.pinned ? t('uiUnpinTheNextAutoResolutionReJudges') : t('uiPinForThisSession')} onClick={() => void togglePin()}>{route?.pinned ? t('uiPinnedUnpin') : t('uiPinForThisSession')}</button>
        {resolved && <span className="capsule-resolved" title={t('uiResolvedActualModel')}>{resolved}</span>}
      </span>
    </div>
  );
}

/** Compact `mm:ss` used by the plan/cost hint row (kept pure for tests). */
export function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export interface MetersRowProps {
  usage: UsageTotals;
  metrics: TalkingMetrics;
  contextWindow?: number;
  plan?: { done: number; total: number };
}

/**
 * Always-on meter row at the bottom of the composer (P5, DESIGN.md §4.2):
 * context occupancy bar, cache hit rate, cost, plan progress and key hints.
 * Reuses the real `UsageBar`/`TalkingMetricsBar` accumulators, no new math.
 */
export function MetersRow({ usage, metrics, contextWindow, plan }: MetersRowProps) {
  const { t } = useI18n();
  const ratio = contextOccupancy(usage, contextWindow);
  const cacheRate = metrics.cacheMetrics?.billedHitRate ?? usage.overallCacheHitRate;
  return (
    <div className="meters" aria-label={t('uiContextOccupancy')}>
      <span className="meter">
        <b>{t('uiContextOccupancy')}</b>
        {ratio === undefined ? <span className="meter-unknown">—</span> : <><span className="cbar" aria-hidden="true"><i style={{ width: `${Math.round(ratio * 100)}%` }} /></span>{Math.round(ratio * 100)}%</>}
      </span>
      <span className="meter"><b>{t('uiCache')}</b>{cacheRate === undefined ? <span className="meter-unknown">—</span> : `${Math.round(cacheRate * 100)}%`}</span>
      <span className="meter"><b>{t('uiCost')}</b>${usage.costUsd.toFixed(4)}</span>
      {plan && <span className="meter"><b>{t('uiPlan')}</b>{plan.done}/{plan.total}</span>}
      <span className="meter meter-keys"><b>{t('uiKeyHints')}</b><kbd>{t('uiCommandsCtrlCmdK')}</kbd><kbd>{t('uiToggleInspectorCtrlCmdI')}</kbd><span>{t('uiSendHint')}</span><kbd>⏎</kbd><span>{t('uiNewlineHint')}</span></span>
    </div>
  );
}
