import { useEffect, useRef, useState } from 'react';
import type { ApiClient, CreateSessionInput, ModelOption, Project, SessionMeta } from '../api';
import { useI18n } from './LanguageProvider';
import { modelKey } from './NewSessionForm';
import { ModelQuickSwitcher } from './providers/ModelQuickSwitcher';
import { PROVIDER_PRESETS_CATALOG } from './providers/presetsData';

export function projectName(root: string): string { return root.split(/[\\/]/).filter(Boolean).at(-1) || root; }
export function readableSessionTitle(session: SessionMeta, fallback: string): string {
  const title = session.topic?.title?.trim();
  return title && !/^sess_|^untitled topic$|^未命名主题$/i.test(title) ? title : fallback;
}
/** Create a session only; its first turn goes through the existing conversation stream. */
export async function createTaskSession(api: ApiClient, input: CreateSessionInput, task: string, onBusyChange?: (busy: boolean) => void): Promise<SessionMeta> {
  if (!input.workspaceRoot.trim() || !task.trim()) throw new Error('Project and task are required');
  onBusyChange?.(true);
  try {
  await api.openProject(input.workspaceRoot.trim());
  const { session } = await api.createSession({ ...input, workspaceRoot: input.workspaceRoot.trim() });
  // ponytail: Titles are deterministic task summaries, never a second model call.
  try { await api.updateSessionTopic(session.id, { title: task.trim().replace(/\s+/g, ' ').slice(0, 80) }); } catch { /* Creation remains usable when metadata cannot be saved. */ }
  return session;
  } finally { onBusyChange?.(false); }
}
export default function TaskComposer({ api, projects, selectedRoot, onSelectProject, providerRevision, disabled, onConfigureModels, onAdvanced, onStarted, onBusyChange, draftRequest }: {
  api: ApiClient; projects: Project[]; selectedRoot: string; onSelectProject: (root: string) => void;
  providerRevision: number; disabled: boolean; onConfigureModels: (presetId?: string) => void; onAdvanced: () => void;
  onBusyChange?: (busy: boolean) => void;
  draftRequest?: { text: string; serial: number };
  onStarted: (session: SessionMeta, task: string) => void;
}) {
  const { t } = useI18n();
  const [task, setTask] = useState('');
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  useEffect(() => {
    if (!draftRequest) return;
    setTask(draftRequest.text);
    taskInput.current?.focus();
  }, [draftRequest]);
  const [path, setPath] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selection, setSelection] = useState('');
  const [permission, setPermission] = useState<NonNullable<CreateSessionInput['permission']>>('workspace-write');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true; setLoading(true); setFailed(false);
    void api.listModels().then(({ models: catalog }) => {
      if (!live) return;
      const real = catalog.filter(model => model.providerName !== 'mock'); setModels(real);
      setSelection(previous => previous || (real[0] ? modelKey(real[0]) : ''));
    }).catch(() => { if (live) setFailed(true); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, providerRevision, retry]);
  const selectedModel = models.find(model => modelKey(model) === selection);
  const root = selectedRoot || path.trim();
  const unavailable = Boolean(selection && !models.some(model => modelKey(model) === selection));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (isComposingRef.current || !root || !task.trim() || busy || loading || failed || unavailable || disabled) return;
    setBusy(true); setError('');
    try {
      const model = models.find(item => modelKey(item) === selection);
      const session = await createTaskSession(api, { workspaceRoot: root, permission, ...(model ? { provider: model.providerName, model: model.id } : {}) }, task, onBusyChange);
      onStarted(session, task.trim());
    } catch { setError(t('sessionCreateFailed')); } finally { setBusy(false); }
  }
  return <form className="task-composer" onSubmit={submit}>
    <h2>{t('taskPrompt')}</h2>
    <label htmlFor="taskProject">{t('chooseProject')}</label>
    <div className="capsule-select">
    <select id="taskProject" className="input" value={selectedRoot} disabled={busy} onChange={event => onSelectProject(event.target.value)}>
      <option value="">{t('openProjectPath')}</option>
      {projects.map(project => <option key={project.root} value={project.root}>{projectName(project.root)}</option>)}
    </select>
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </div>
    {selectedRoot ? <p className="composer-root dim" title={root}>{root}</p> : <input className="input" aria-label={t('workspacePath')} placeholder={t('workspacePlaceholder')} value={path} onChange={event => setPath(event.target.value)} disabled={busy} />}
    <div className="composer-surface">
    <label htmlFor="taskInput">{t('taskPrompt')}</label>
    <textarea ref={taskInput} id="taskInput" className="input task-input" placeholder={t('taskPlaceholder')} value={task} onChange={event => setTask(event.target.value)} disabled={busy}
      onCompositionStart={() => { isComposingRef.current = true; }}
      onCompositionEnd={() => { isComposingRef.current = false; }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey) {
          if (isComposingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault(); void submit(event);
        }
      }} />
    <div className="composer-options composer-pills">
      <ModelQuickSwitcher models={models} current={selectedModel ? { provider: selectedModel.providerName, model: selectedModel.id } : null}
        disabled={busy || loading || failed || disabled} onSelect={model => setSelection(JSON.stringify([model.provider, model.model]))} onOpenSettings={() => onConfigureModels()} />
      <label>{t('permissionLabel')}<span className="capsule-select"><select className="input" aria-label={t('permissionLabel')} value={permission} disabled={busy} onChange={event => setPermission(event.target.value as typeof permission)}>
        <option value="read-only">{t('permissionReadOnly')}</option><option value="workspace-write">{t('permissionWorkspaceWrite')}</option>
      </select><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></span></label>
      <button className="btn btn-primary composer-send" type="submit" disabled={busy || disabled || loading || failed || unavailable || !root || !task.trim()}>{busy ? t('creating') : t('startTask')}</button>
    </div>
    </div>
    {unavailable && !loading && <p role="alert" className="error-text">{t('modelUnavailable')}</p>}
    {loading && <p role="status" className="dim">{t('loading')}</p>}
    {failed && <p role="alert" className="error-text">{t('modelLoadFailed')} <button className="btn" type="button" onClick={() => setRetry(value => value + 1)}>{t('modelRetry')}</button></p>}
    {!loading && !failed && !models.length && <section className="task-composer-onboarding" aria-label={t('onboardingTitle')}>
      <h3>{t('onboardingTitle')}</h3><p className="dim">{t('onboardingSubtitle')}</p>
      <div className="onboarding-grid">{['deepseek', 'anthropic', 'openrouter', 'custom'].map(id => {
        const preset = PROVIDER_PRESETS_CATALOG.find(item => item.id === id);
        return <button type="button" key={id} className="onboarding-card" disabled={busy || disabled} onClick={() => onConfigureModels(id)}>
          <strong>{id === 'anthropic' ? 'Claude' : preset?.name ?? t('providerCustom')}</strong>
          <small>{preset?.defaultModel ? t('onboardingRecommendedModels', { models: preset.defaultModel }) : t('onboardingCustomHint')}</small>
        </button>;
      })}</div>
    </section>}
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="composer-secondary"><button className="btn" type="button" data-action="advanced-session" onClick={onAdvanced} disabled={busy}>{t('advancedSession')}</button><button className="btn" type="button" data-action="configure-models" onClick={() => onConfigureModels()} disabled={busy}>{t('configureModels')}</button></div>
  </form>;
}
