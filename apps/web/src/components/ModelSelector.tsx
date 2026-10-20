import { useEffect, useRef, useState } from 'react';
import { ApiError, type ApiClient, type ModelOption, type SessionMeta } from '../api';
import { useI18n } from './LanguageProvider';
import CapabilityStatus from './providers/CapabilityStatus';
import { modelKey } from './NewSessionForm';
import { ModelQuickSwitcher } from './providers/ModelQuickSwitcher';

export interface ModelSelectorProps {
  api: ApiClient;
  sessionId: string;
  providerRevision?: number;
  busy?: boolean;
  onConfigureModels?: () => void;
  onUpdated?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export default function ModelSelector({ api, sessionId, providerRevision = 0, busy = false, onConfigureModels, onUpdated, onBusyChange }: ModelSelectorProps) {
  const { t } = useI18n();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [session, setSession] = useState<SessionMeta>();
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [failure, setFailure] = useState<'load' | 'switch' | 'busy'>();
  const generation = useRef(0);
  const busyOwned = useRef(false);
  useEffect(() => {
    let live = true;
    setLoading(true); setFailure(undefined);
    Promise.resolve().then(() => api.listModels()).then(catalog => {
      if (live) setModels(catalog.models.filter(model => model.providerName !== 'mock'));
    }).catch(() => { if (live) setFailure('load'); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, providerRevision]);
  useEffect(() => {
    const current = ++generation.current;
    setSession(undefined); setSwitching(false);
    Promise.resolve().then(() => api.getSession(sessionId)).then(result => {
      if (current === generation.current) setSession(result.session);
    }).catch(() => { if (current === generation.current) setFailure('load'); });
    return () => {
      generation.current += 1;
      if (busyOwned.current) { busyOwned.current = false; onBusyChange?.(false); }
    };
  }, [api, sessionId, onBusyChange]);

  async function select(key: string) {
    const chosen = models.find(model => modelKey(model) === key);
    if (!chosen || busy || switching || loading || !session) return;
    const current = generation.current;
    busyOwned.current = true; setSwitching(true); onBusyChange?.(true); setFailure(undefined);
    try {
      const result = await api.switchSessionModel(sessionId, { provider: chosen.providerName, model: chosen.id });
      if (current === generation.current) { setSession(result.session); onUpdated?.(); }
    } catch (error) {
      if (current === generation.current) setFailure(error instanceof ApiError && error.status === 409 && (error.body as { error?: string } | null)?.error === 'session_busy' ? 'busy' : 'switch');
    } finally {
      if (current === generation.current) { busyOwned.current = false; setSwitching(false); onBusyChange?.(false); }
    }
  }
  const selected = session?.provider && session.model ? JSON.stringify([session.provider, session.model]) : '';
  const listed = models.some(model => modelKey(model) === selected);
  const label = session?.provider === 'mock' ? t('modelOffline') : session?.model ? `${session.provider} / ${session.model}` : '—';
  return <div className="model-selector">
    <label htmlFor="activeSessionModel">{t('currentModel')}</label>
    <select hidden aria-hidden="true" tabIndex={-1} id="activeSessionModel" className="input" value={selected} disabled={busy || switching || loading || !session || failure === 'load'} onChange={event => void select(event.target.value)}>
      {!listed && <option value={selected}>{label}</option>}
      {models.map(model => <option key={modelKey(model)} value={modelKey(model)}>{model.providerName} / {model.id}</option>)}
    </select>
    <ModelQuickSwitcher models={models} current={session?.provider && session.model ? { provider: session.provider, model: session.model } : null} disabled={busy || switching || loading || !session || failure === 'load'} onSelect={model => void select(JSON.stringify([model.provider, model.model]))} onOpenSettings={onConfigureModels} compact />
    {session && <details className="model-capabilities"><summary>{t('capabilitiesTitle')}</summary><CapabilityStatus capabilities={models.find(model => modelKey(model) === selected)?.capabilities} /></details>}
    {session && <span className="dim effective-permission" title={session.workspaceRoot}>{t('permissionLabel')}: {session.permission === 'read-only' ? t('permissionReadOnly') : session.permission === 'workspace-write' ? t('permissionWorkspaceWrite') : session.permission === 'danger-full-access' ? t('permissionDangerFull') : '—'}</span>}
    {loading || switching ? <span role="status" className="dim">{t('loading')}</span> : null}
    {!loading && !models.length && <span className="dim">{t('noModelsConfigured')}</span>}
    {onConfigureModels && <button type="button" className="btn" disabled={busy || switching} onClick={onConfigureModels}>{t('configureModels')}</button>}
    {failure && <span role="alert" className="error-text">{t(failure === 'load' ? 'modelLoadFailed' : failure === 'busy' ? 'modelSwitchBusy' : 'modelSwitchFailed')}</span>}
  </div>;
}
