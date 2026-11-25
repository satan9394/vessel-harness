import { useEffect, useRef, useState } from 'react';
import type { ApiClient, CreateSessionInput, ModelOption, Project, SessionMeta } from '../api';
import { useI18n } from './LanguageProvider';
import { modelKey } from './NewSessionForm';
import { ModelQuickSwitcher } from './providers/ModelQuickSwitcher';
import { localizePreset, PROVIDER_PRESETS_CATALOG } from './providers/presetsData';
import { projectLabels, labelFor } from '../utils/projectLabels';

export { projectName, projectLabels, labelFor } from '../utils/projectLabels';

// Page-local drafts survive navigation without writing task text to disk.
const draftsByClient = new WeakMap<ApiClient, Map<string, string>>();
// Label map memoized on the projects array identity. A `useMemo` here would be
// consistent with Sidebar/App, but this component's test harness fakes
// useState/useRef/useEffect and calls it outside React, so a real hook throws
// "Invalid hook call"; the WeakMap gives the same one-map-per-project-list
// behaviour without touching hook order.
const labelsByProjects = new WeakMap<Project[], Map<string, string>>();
function labelsForProjects(projects: Project[]): Map<string, string> {
  const cached = labelsByProjects.get(projects);
  if (cached) return cached;
  const labels = projectLabels(projects.map(project => project.root));
  labelsByProjects.set(projects, labels);
  return labels;
}
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
  const { t, lang } = useI18n();
  const projectLabelMap = labelsForProjects(projects);
  const [path, setPath] = useState('');
  const root = selectedRoot || path.trim();
  const [drafts, setDrafts] = useState(() => new Map(draftsByClient.get(api)));
  const task = drafts.get(root) ?? '';
  function setTask(text: string) {
    const next = new Map(drafts);
    next.set(root, text);
    draftsByClient.set(api, next);
    setDrafts(next);
  }
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  useEffect(() => {
    if (!draftRequest) return;
    setTask(draftRequest.text);
    taskInput.current?.focus();
  }, [draftRequest]);
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
      setModels(catalog);
      const preferred = catalog.find(model => model.providerName !== 'mock') ?? catalog[0];
      setSelection(previous => previous || (preferred ? modelKey(preferred) : ''));
    }).catch(() => { if (live) setFailed(true); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, providerRevision, retry]);
  const selectedModel = models.find(model => modelKey(model) === selection);
  const unavailable = Boolean(selection && !models.some(model => modelKey(model) === selection));
  useEffect(() => {
    if (disabled || loading || failed || unavailable || !selectedModel || !root || typeof requestAnimationFrame !== 'function') return;
    // State-ready animation frame; paint timing is measured separately. No prompt data.
    const frame = requestAnimationFrame(() => {
      if (!performance.getEntriesByName('vessel:task-ready').length) performance.mark('vessel:task-ready');
    });
    return () => cancelAnimationFrame(frame);
  }, [disabled, loading, failed, unavailable, selectedModel, root]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (isComposingRef.current || !root || !task.trim() || busy || loading || failed || unavailable || disabled) return;
    setBusy(true); setError('');
    try {
      const model = models.find(item => modelKey(item) === selection);
      const session = await createTaskSession(api, { workspaceRoot: root, permission, ...(model ? { provider: model.providerName, model: model.id } : {}) }, task, onBusyChange);
      setTask('');
      onStarted(session, task.trim());
    } catch { setError(t('sessionCreateFailed')); } finally { setBusy(false); }
  }
  return <form className="task-composer" onSubmit={submit} aria-label={t('taskPrompt')}>
    <div className="composer-surface">
      <label htmlFor="taskInput" className="visually-hidden">{t('taskPrompt')}</label>
      <textarea ref={taskInput} id="taskInput" className="task-input" placeholder={t('taskPlaceholder')} value={task} onChange={event => setTask(event.target.value)} disabled={busy} autoFocus
        onCompositionStart={() => { isComposingRef.current = true; }}
        onCompositionEnd={() => { isComposingRef.current = false; }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            if (isComposingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault(); void submit(event);
          }
        }} />
      <div className="composer-options composer-pills">
        <span className="composer-chip" title={root}>
          <label htmlFor="taskProject" className="visually-hidden">{t('chooseProject')}</label>
          <select id="taskProject" className="composer-select" value={selectedRoot} disabled={busy} onChange={event => onSelectProject(event.target.value)}>
            <option value="">{t('openProjectPath')}</option>
            {projects.map(project => <option key={project.root} value={project.root}>{labelFor(projectLabelMap, project.root)}</option>)}
          </select>
        </span>
        <ModelQuickSwitcher models={models} current={selectedModel ? { provider: selectedModel.providerName, model: selectedModel.id } : null}
          disabled={busy || loading || failed || disabled} onSelect={model => setSelection(JSON.stringify([model.provider, model.model]))} onOpenSettings={() => onConfigureModels()} />
        <span className="composer-chip">
          <label htmlFor="taskPermission" className="visually-hidden">{t('permissionLabel')}</label>
          <select id="taskPermission" className="composer-select" aria-label={t('permissionLabel')} value={permission} disabled={busy} onChange={event => setPermission(event.target.value as typeof permission)}>
            <option value="read-only">{t('permissionReadOnly')}</option><option value="workspace-write">{t('permissionWorkspaceWrite')}</option><option value="danger-full-access">{t('permissionDangerFull')}</option>
          </select>
        </span>
        <button className="btn btn-primary composer-send" type="submit" disabled={busy || disabled || loading || failed || unavailable || !root || !task.trim()}>{busy ? t('creating') : t('startTask')}</button>
      </div>
    </div>
    {!selectedRoot && <input className="input composer-path" aria-label={t('workspacePath')} placeholder={t('workspacePlaceholder')} value={path} onChange={event => setPath(event.target.value)} disabled={busy} />}
    {unavailable && !loading && <p role="alert" className="error-text">{t('modelUnavailable')}</p>}
    {loading && <p role="status" className="composer-note">{t('loading')}</p>}
    {failed && <p role="alert" className="error-text">{t('modelLoadFailed')} <button className="btn" type="button" onClick={() => setRetry(value => value + 1)}>{t('modelRetry')}</button></p>}
    {!loading && !failed && !models.some(model => model.providerName !== 'mock') && <section className="task-composer-onboarding" aria-label={t('onboardingTitle')}>
      <h3>{t('onboardingTitle')}</h3><p className="dim">{t('onboardingSubtitle')}</p>
      <div className="onboarding-grid">{['deepseek', 'anthropic', 'openrouter', 'custom'].map(id => {
        const preset = PROVIDER_PRESETS_CATALOG.find(item => item.id === id);
        return <button type="button" key={id} className="onboarding-card" disabled={busy || disabled} onClick={() => onConfigureModels(id)}>
          <strong>{id === 'anthropic' ? 'Claude' : preset ? localizePreset(preset, lang).name : t('providerCustom')}</strong>
          <small>{preset?.defaultModel ? t('onboardingRecommendedModels', { models: preset.defaultModel }) : t('onboardingCustomHint')}</small>
        </button>;
      })}</div>
    </section>}
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="composer-secondary"><button className="btn" type="button" data-action="advanced-session" onClick={onAdvanced} disabled={busy}>{t('advancedSession')}</button><button className="btn" type="button" data-action="configure-models" onClick={() => onConfigureModels()} disabled={busy}>{t('configureModels')}</button></div>
  </form>;
}
