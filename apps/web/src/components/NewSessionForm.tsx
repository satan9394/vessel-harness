import { useI18n } from './LanguageProvider';
import { useEffect, useState } from 'react';
import type { ApiClient, CreateSessionInput, ModelOption } from '../api';

export interface NewSessionResult {
  sessionId: string;
  projectRoot: string;
}

interface Props {
  api: ApiClient;
  onCreated: (result: NewSessionResult) => void;
  onClose: () => void;
  providerRevision?: number;
  onConfigureModels?: () => void;
  hidden?: boolean;
  initialPermission?: CreateSessionInput['permission'];
}

/** New Session flow: prompt workspaceRoot → open project → create session. */
export default function NewSessionForm({ api, onCreated, onClose, initialPermission = 'workspace-write', providerRevision = 0, onConfigureModels, hidden = false }: Props) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selection, setSelection] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let live = true; setLoading(true); setLoadFailed(false);
    Promise.resolve().then(() => api.listModels()).then(({ models: catalog }) => {
      if (!live) return;
      const real = catalog.filter(model => model.providerName !== 'mock');
      setModels(real);
      setSelection(previous => real.some(model => modelKey(model) === previous) ? previous : real[0] ? modelKey(real[0]) : '');
    }).catch(() => { if (live) setLoadFailed(true); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, providerRevision]);
  const [permission, setPermission] = useState(initialPermission);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ws = value.trim();
    if (!ws || busy || loading || loadFailed) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = models.find(model => modelKey(model) === selection);
      await api.openProject(ws);
      const { session } = await api.createSession({ workspaceRoot: ws, permission, ...(chosen ? { provider: chosen.providerName, model: chosen.id } : {}) });
      onCreated({ sessionId: session.id, projectRoot: session.workspaceRoot });
      onClose();
    } catch {
      setError(t('sessionCreateFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div hidden={hidden} style={hidden ? { display: 'none' } : undefined} className="overlay" role="dialog" aria-label={t('newSessionTitle')}>
      <form className="modal" onSubmit={submit}>
        <h3>{t('newSessionTitle')}</h3>
        <label className="field-label" htmlFor="sessionModel">{t('selectModel')}</label>
        <select id="sessionModel" className="input" value={selection} disabled={busy || loading} onChange={event => setSelection(event.target.value)}>
          {!models.length && <option value="">{t('modelOffline')}</option>}
          {models.map(model => <option key={modelKey(model)} value={modelKey(model)}>{model.providerName} / {model.id}</option>)}
        </select>
        {loading && <p className="dim" role="status">{t('loading')}</p>}
        {loadFailed && <p className="error-text" role="alert">{t('modelLoadFailed')}</p>}
        {!loading && !models.length && <p className="dim">{t('noModelsConfigured')}</p>}
        {onConfigureModels && <button className="btn" type="button" disabled={busy} onClick={onConfigureModels}>{t('configureModels')}</button>}
        <label className="field-label" htmlFor="sessionPermission">{t('permissionLabel')}</label>
        <select id="sessionPermission" className="input" value={permission} onChange={event => setPermission(event.target.value as NonNullable<CreateSessionInput['permission']>)} disabled={busy}>
          <option value="read-only">{t('permissionReadOnly')}</option>
          <option value="workspace-write">{t('permissionWorkspaceWrite')}</option>
        </select>
        <label className="field-label" htmlFor="workspaceRoot">
          {t('workspacePath')} </label>
        <input
          id="workspaceRoot"
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('workspacePlaceholder')}
          autoFocus
        />
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('cancel')} </button>
          <button type="submit" className="btn btn-primary" disabled={busy || loading || loadFailed || !value.trim()}>
            {busy ? t('creating') : t('create')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function modelKey(model: ModelOption): string { return JSON.stringify([model.providerName, model.id]); }
