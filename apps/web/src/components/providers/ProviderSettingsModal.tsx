import { useEffect, useRef, useState } from 'react';
import { ApiError, type AddProviderInput, type ApiClient, type ProviderInfo, type TestProviderResult } from '../../api';
import type { ModelMessages } from '../../i18n';
import CapabilityStatus from './CapabilityStatus';
import { useI18n } from '../LanguageProvider';
import { ModelChips } from './ModelChips';
import { PresetsGallery } from './PresetsGallery';
import { localizePreset, PROVIDER_PRESETS_CATALOG, type PresetInfo } from './presetsData';

export const PROVIDER_PRESETS: Record<string, AddProviderInput> = {
  ...Object.fromEntries(PROVIDER_PRESETS_CATALOG.filter((preset): preset is PresetInfo & { protocol: AddProviderInput['protocol'] } => preset.protocol !== 'mock').map(preset => [preset.id, {
    name: preset.id, protocol: preset.protocol, baseUrl: preset.baseUrl, apiKey: '', models: preset.defaultModel ? [preset.defaultModel] : [],
  }])),
  DeepSeek: { name: 'deepseek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner'] },
  OpenAI: { name: 'openai', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: [] },
  Claude: { name: 'claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', models: [] },
  Ollama: { name: 'ollama', protocol: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', apiKey: '', models: [] },
  custom: { name: '', protocol: 'openai-compatible', baseUrl: '', apiKey: '', models: [] },
};

export function validateProvider(input: AddProviderInput, providers: ProviderInfo[], saving: boolean, requireKey = false): keyof ModelMessages | undefined {
  if (saving && (!/^[\p{L}\p{N}_.-]{1,80}$/u.test(input.name) || input.name === 'mock')) return 'providerInvalidName';
  if (saving && providers.some(provider => provider.name === input.name)) return 'providerDuplicate';
  let url: URL;
  try { url = new URL(input.baseUrl); } catch { return 'providerInvalidUrl'; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return 'providerInvalidUrl';
  const local = input.protocol === 'openai-compatible' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const hasSavedKey = !requireKey && providers.some(provider => provider.name === input.name);
  if ((!input.apiKey.trim() && !local && !hasSavedKey) || input.apiKey.length > 8192 || /[\x00-\x1f\x7f]/.test(input.apiKey)) return 'providerKeyRequired';
  if (saving && (!input.models.length || input.models.length > 256 || input.models.some(model => model.length > 256 || /[\x00-\x1f\x7f]/.test(model)))) return 'providerModelsRequired';
}

/**
 * 供应商操作失败的**具体**原因 → 本地化词条（task 215：杜绝千篇一律的「操作失败」）。
 *
 * 同时兼容两种输入：`ApiError`（保存/删除的 HTTP 失败，具体码在 `body.error`）与
 * 端点探测返回的裸错误字符串（`connection_timeout` 等）。未知原因才回落通用文案，
 * 且**绝不**把服务端或异常的自由文本当作界面文案渲染。
 */
export function providerFailure(error: unknown): { key: keyof ModelMessages; params?: Record<string, string> } {
  const body = error instanceof ApiError ? error.body : undefined;
  const fromBody = body && typeof body === 'object' && !Array.isArray(body) ? (body as { error?: unknown }).error : undefined;
  const raw = typeof error === 'string'
    ? error
    : fromBody ?? (error instanceof Error ? error.message : '');
  const code = typeof raw === 'string' ? raw.trim() : '';
  const http = /^http_(\d{3})$/.exec(code);
  if (http) return { key: 'providerHttp', params: { status: http[1]! } };
  switch (code) {
    case 'invalid_models': return { key: 'providerModelsRequired' };
    case 'invalid_base_url': return { key: 'providerInvalidUrl' };
    case 'invalid_api_key': return { key: 'providerKeyRequired' };
    case 'invalid_protocol': return { key: 'providerErrInvalidProtocol' };
    case 'invalid_provider_name': return { key: 'providerInvalidName' };
    case 'provider_not_found':
    case 'unknown_provider': return { key: 'providerErrNotFound' };
    case 'builtin_provider': return { key: 'providerErrBuiltin' };
    case 'secure_store_required': return { key: 'providerErrSecureStore' };
    case 'provider_store_corrupted': return { key: 'providerErrStoreCorrupted' };
    case 'connection_timeout': return { key: 'providerTimeout' };
    case 'connection_failed': return { key: 'providerFailed' };
    case 'invalid_models_response': return { key: 'providerBadResponse' };
    default: return { key: 'providerOperationFailed' };
  }
}

export default function ProviderSettingsModal({ api, onClose, onChanged, initialPreset, embedded = false }: {
  api: ApiClient; onClose?: () => void; onChanged?: () => void; initialPreset?: string; embedded?: boolean;
}) {
  const { t, lang } = useI18n();
  function presetName(key: string) {
    const info = PROVIDER_PRESETS_CATALOG.find(item => item.id === key);
    return info ? localizePreset(info, lang).name : key;
  }
  const id = 'provider';
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [preset, setPreset] = useState(initialPreset && PROVIDER_PRESETS[initialPreset] ? initialPreset : 'DeepSeek');
  const [form, setForm] = useState(PROVIDER_PRESETS[preset]!);
  const [models, setModels] = useState(form.models.join(', '));
  const [candidates, setCandidates] = useState<string[]>(form.models);
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | 'pull'>();
  const [error, setError] = useState<keyof ModelMessages>();
  const [errorParams, setErrorParams] = useState<Record<string, string>>();
  const [notice, setNotice] = useState<keyof ModelMessages>();
  const [noticeParams, setNoticeParams] = useState<Record<string, string>>();
  const [result, setResult] = useState<TestProviderResult>();
  const [deleting, setDeleting] = useState<string>();
  const [testingSaved, setTestingSaved] = useState<string>();
  const [savedKey, setSavedKey] = useState('');
  const [savedResults, setSavedResults] = useState<Record<string, TestProviderResult>>({});
  function fail(key?: keyof ModelMessages, params?: Record<string, string>) { setError(key); setErrorParams(params); }
  async function refresh() {
    const response = await api.listProviders();
    if (mounted.current) { setProviders(response.providers.filter(provider => provider.name !== 'mock')); setLoaded(true); }
  }
  useEffect(() => {
    mounted.current = true;
    const restore = embedded ? undefined : document.activeElement;
    if (!embedded) dialog.current?.querySelector<HTMLElement>('button')?.focus();
    void refresh().catch((thrown: unknown) => { if (mounted.current) { const failure = providerFailure(thrown); fail(failure.key, failure.params); } }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; if (!embedded && restore instanceof HTMLElement && restore.isConnected) restore.focus(); };
  }, [api, embedded]);
  function change(next: Partial<AddProviderInput>) { setForm(previous => ({ ...previous, ...next, modelCapabilities: undefined })); setResult(undefined); fail(undefined); setNotice(undefined); setNoticeParams(undefined); }
  function pickPreset(key: string) {
    if (key === 'mock') { setPreset(key); setResult(undefined); fail(undefined); setNotice(undefined); return; }
    const next = PROVIDER_PRESETS[key];
    if (!next) return;
    setPreset(key); change(next); setModels(next.models.join(', ')); setCandidates(next.models);
  }
  function pickGallery(info: PresetInfo) { pickPreset(info.id); }
  useEffect(() => {
    if (initialPreset) pickPreset(initialPreset);
  }, [initialPreset]);
  function updateModels(next: string[]) { setModels([...new Set(next)].join(', ')); setResult(undefined); fail(undefined); setNotice(undefined); }
  function providerInput(): AddProviderInput {
    return { ...form, name: form.name.trim(), baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim(), models: [...new Set(models.split(/[,，]/).map(model => model.trim()).filter(Boolean))] };
  }
  async function testDirect(provider: ProviderInfo) {
    if (busy || !loaded) return;
    setBusy('test');
    try {
      const tested = await api.testProvider({ name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl, models: provider.models, apiKey: '' });
      if (mounted.current) {
        setSavedResults(previous => ({ ...previous, [provider.name]: tested }));
        if (tested.ok) { onChanged?.(); await refresh(); }
      }
    } catch (thrown) {
      if (mounted.current) { const failure = providerFailure(thrown); fail(failure.key, failure.params); }
    } finally { if (mounted.current) { setBusy(undefined); setTestingSaved(undefined); } }
  }
  async function testSaved(provider: ProviderInfo) {
    if (busy || !loaded) return;
    const input = { name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl, models: provider.models, apiKey: savedKey.trim() };
    if (!savedKey.trim()) { setSavedResults(previous => ({ ...previous, [provider.name]: { ok: false, error: 'invalid_api_key' } })); return; }
    const invalid = validateProvider(input, providers, false);
    if (invalid) { setSavedResults(previous => ({ ...previous, [provider.name]: { ok: false, error: 'invalid_api_key' } })); return; }
    setBusy('test');
    try {
      const tested = await api.testProvider(input);
      if (mounted.current) {
        setSavedResults(previous => ({ ...previous, [provider.name]: tested }));
        if (tested.ok) { onChanged?.(); await refresh(); }
      }
    } catch (thrown) {
      if (mounted.current) { const failure = providerFailure(thrown); fail(failure.key, failure.params); }
    } finally { if (mounted.current) { setBusy(undefined); setSavedKey(''); } }
  }
  async function run(action: 'test' | 'save' | 'delete') {
    if (preset === 'mock' && action !== 'delete') return;
    if (busy || !loaded) return;
    const input = providerInput();
    const invalid = action === 'delete' ? undefined : validateProvider(input, providers, action === 'save');
    fail(invalid); setNotice(undefined);
    if (invalid) return;
    setBusy(action);
    try {
      if (action === 'test') {
        const tested = await api.testProvider(input);
        if (mounted.current) { setResult(tested); if (tested.ok) { setForm(previous => ({ ...previous, modelCapabilities: tested.modelCapabilities })); if (tested.availableModels?.length) { setCandidates(tested.availableModels); if (!models.trim()) setModels(tested.availableModels.join(', ')); } } }
      } else {
        if (action === 'save') await api.addProvider(input);
        else if (deleting) { const removed = await api.deleteProvider(deleting); if (!removed.ok) throw new Error('delete_failed'); }
        if (mounted.current) { setNotice(action === 'save' ? 'providerSaved' : 'providerDeleted'); setNoticeParams(undefined); setDeleting(undefined); if (action === 'save') setForm(previous => ({ ...previous, apiKey: '' })); onChanged?.(); }
        // The mutation is committed; notify model consumers even if readback fails.
        try { await refresh(); await api.listModels(); }
        catch { if (mounted.current) fail('providerRefreshFailed'); }
      }
    } catch (thrown) { if (mounted.current) { const failure = providerFailure(thrown); fail(failure.key, failure.params); } }
    finally { if (mounted.current) setBusy(undefined); }
  }
  /** 一键拉取模型（task 215）：真实探测端点 `/v1/models` 并回填模型输入框。 */
  async function pull() {
    if (busy || !loaded) return;
    const input = providerInput();
    const invalid = validateProvider(input, providers, false);
    fail(invalid); setNotice(undefined); setNoticeParams(undefined);
    if (invalid) return;
    setBusy('pull');
    try {
      const pulled = await api.pullProviderModels(input);
      if (!mounted.current) return;
      if (!pulled.ok) { const failure = providerFailure(pulled.error); fail(failure.key, failure.params); return; }
      const discovered = [...new Set(pulled.models ?? [])];
      if (!discovered.length) { fail('providerPullEmpty'); return; }
      setResult(undefined);
      setForm(previous => ({ ...previous, modelCapabilities: pulled.modelCapabilities }));
      setCandidates(discovered);
      setModels(discovered.join(', '));
      setNotice('providerPulled');
      setNoticeParams({ count: String(discovered.length) });
    } catch (thrown) { if (mounted.current) { const failure = providerFailure(thrown); fail(failure.key, failure.params); } }
    finally { if (mounted.current) setBusy(undefined); }
  }
  const testText = result?.ok ? t('providerConnected', { ms: String(result.latencyMs ?? 0) })
    : result?.error?.match(/^http_(\d{3})$/) ? t('providerHttp', { status: result.error.slice(5) })
    : t(result?.error === 'connection_timeout' ? 'providerTimeout' : result?.error === 'invalid_models_response' ? 'providerBadResponse' : 'providerFailed');
  return <div className={embedded ? 'provider-hub' : 'overlay provider-overlay'}>
    <div className={embedded ? 'provider-hub-panel' : 'modal provider-modal'} ref={dialog} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-label={t('modelSettings')} tabIndex={-1} onKeyDown={event => {
      if (embedded) return;
      event.stopPropagation();
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose?.(); }
      if (event.key === 'Tab' && dialog.current) {
        const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), [tabindex="0"]'));
        const first = controls[0]; const last = controls.at(-1);
        if (!first) { event.preventDefault(); dialog.current.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="provider-heading">{embedded ? <h2>{t('modelSettings')}</h2> : <h3>{t('modelSettings')}</h3>}{!embedded && <button className="btn" disabled={!!busy} onClick={onClose}>{t('close')}</button>}</div>
      <div className="provider-hub-content">
      <section className="provider-registry" aria-label={t('providerConfigured')}>
      <h3>{t('providerConfigured')}</h3>
      {loading ? <p role="status">{t('loading')}</p> : providers.length ? <div className="provider-list">{providers.map(provider => <article className="provider-card" key={provider.name}>
        <strong>{provider.name}</strong><span className="provider-badge">{t(provider.protocol === 'anthropic' ? 'providerAnthropic' : 'providerOpenai')}</span>
        <code>{provider.baseUrl}</code><span>{provider.apiKeyMasked || t('providerNoKey')}</span><span>{t('providerModelCount', { count: String(provider.models.length) })}</span>
        <span className={`provider-badge${savedResults[provider.name]?.ok ? ' provider-status-ok' : ''}`} role="status">{savedResults[provider.name] ? savedResults[provider.name]!.ok ? t('providerConnected', { ms: String(savedResults[provider.name]!.latencyMs ?? 0) }) : t(providerFailure(savedResults[provider.name]!.error).key, providerFailure(savedResults[provider.name]!.error).params) : t('providerUntested')}</span>
        <details className="provider-capabilities"><summary>{t('capabilitiesTitle')}</summary>{provider.models.map(model => <section key={model}><h4>{model}</h4><CapabilityStatus capabilities={provider.modelCapabilities?.[model]} /></section>)}</details>
        <div className="provider-card-actions">
          <button className="btn" type="button" disabled={!!busy} onClick={() => void testDirect(provider)} title={t('providerTest')}>
            {busy === 'test' && testingSaved === undefined ? t('providerTesting') : `⚡ ${t('providerTest')}`}
          </button>
          {testingSaved === provider.name ? <form className="provider-card-test" onSubmit={event => { event.preventDefault(); void testSaved(provider); }}>
            <label>{t('providerApiKey')}<input className="input" type="password" autoComplete="off" maxLength={8192} value={savedKey} disabled={!!busy} onChange={event => setSavedKey(event.target.value)} /></label>
            <p className="dim">{t('providerRetestHint')}</p>
            <button className="btn" type="submit" disabled={!!busy}>{busy === 'test' ? t('providerTesting') : t('providerTest')}</button>
            <button className="btn btn-secondary" type="button" disabled={!!busy} onClick={() => void testDirect(provider)}>⚡ 直接测试</button>
            <button className="btn" type="button" disabled={!!busy} onClick={() => { setTestingSaved(undefined); setSavedKey(''); }}>{t('cancel')}</button>
          </form> : <button className="btn btn-secondary" type="button" disabled={!!busy} onClick={() => { setTestingSaved(provider.name); setSavedKey(''); }}>{t('providerRetest')}</button>}
          {deleting === provider.name ? <div><span>{t('providerDeleteConfirm', { name: provider.name })}</span><button className="btn" disabled={!!busy} onClick={() => void run('delete')}>{t('confirm')}</button><button className="btn" disabled={!!busy} onClick={() => setDeleting(undefined)}>{t('cancel')}</button></div>
            : <button className="btn" disabled={!!busy} onClick={() => setDeleting(provider.name)}>{t('delete')}</button>}
        </div>
      </article>)}</div> : <p className="dim">{t('providerEmpty')}</p>}
      </section>
      <form noValidate onSubmit={event => { event.preventDefault(); void run('save'); }}>
        <h4>{t('providerAdd')}</h4>
        <PresetsGallery onSelect={pickGallery} selectedId={PROVIDER_PRESETS_CATALOG.find(item => item.id === preset)?.id ?? PROVIDER_PRESETS_CATALOG.find(item => item.baseUrl === form.baseUrl)?.id} disabled={!!busy || loading || !loaded} />
        <fieldset disabled={!!busy || loading || !loaded} className="provider-fields">
          <label htmlFor={`${id}-preset`}>{t('providerPreset')}</label><select id={`${id}-preset`} className="input" value={preset} onChange={event => pickPreset(event.target.value)}><option value="mock">{presetName('mock')}</option>{Object.keys(PROVIDER_PRESETS).map(key => <option key={key} value={key}>{key === 'custom' ? t('providerCustom') : presetName(key)}</option>)}</select>
          {preset === 'mock' ? <section aria-label="Mock"><p>{t('providerMockHint')}</p><p>{t('providerProtocol')}: mock</p><code>mock / mock</code></section> : <>
          <label htmlFor={`${id}-name`}>{t('providerName')}</label><input id={`${id}-name`} className="input" maxLength={80} value={form.name} onChange={event => change({ name: event.target.value })} />
          <label htmlFor={`${id}-protocol`}>{t('providerProtocol')}</label><select id={`${id}-protocol`} className="input" value={form.protocol} onChange={event => change({ protocol: event.target.value as AddProviderInput['protocol'] })}><option value="openai-compatible">{t('providerOpenai')}</option><option value="anthropic">{t('providerAnthropic')}</option></select>
          <label htmlFor={`${id}-url`}>{t('providerBaseUrl')}</label><input id={`${id}-url`} className="input" value={form.baseUrl} onChange={event => change({ baseUrl: event.target.value })} />
          <label htmlFor={`${id}-key`}>{t('providerApiKey')}</label><input id={`${id}-key`} className="input" type="password" autoComplete="off" value={form.apiKey} placeholder={providers.some(p => p.name === form.name) ? t('providerSavedKeyPlaceholder') : ''} onChange={event => change({ apiKey: event.target.value })} aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className="dim">{t('providerKeyHint')}</p>
          {['oauth', 'env'].includes(PROVIDER_PRESETS_CATALOG.find(item => item.id === preset)?.auth ?? '') && <p role="note" className="dim">{t('providerAuthExternal')}</p>}
          <p>{t('providerModels')}</p>
          <ModelChips models={candidates} selected={providerInput().models} defaultModel={providerInput().models[0]} disabled={!!busy || loading || !loaded}
            onSelectionChange={updateModels}
            onToggle={model => { const selected = providerInput().models; updateModels(selected.includes(model) ? selected.filter(item => item !== model) : [...selected, model]); }}
            // ponytail: The existing provider API uses the first model as its default.
            onSetDefault={model => updateModels([model, ...providerInput().models.filter(item => item !== model)])}
            onRemove={model => { setCandidates(previous => previous.filter(item => item !== model)); updateModels(providerInput().models.filter(item => item !== model)); }}
            onAdd={model => updateModels([...providerInput().models, model])} />
          <input type="hidden" id={`${id}-models`} className="input" value={models} onChange={event => { setModels(event.target.value); fail(undefined); }} />
          </>}
        </fieldset>
        {error && <p role="alert" className="error-text">{t(error, errorParams)} <button type="button" className="btn" disabled={!!busy} onClick={() => { setLoading(true); void refresh().then(() => setError(undefined)).catch((thrown: unknown) => { const failure = providerFailure(thrown); fail(failure.key, failure.params); }).finally(() => setLoading(false)); }}>{t('retry')}</button></p>}
        {notice && <p role="status">{t(notice, noticeParams)}</p>}
        {result && <p role="status" className={`provider-result ${result.ok ? 'success' : 'failure'}`}>{testText}</p>}
        {preset !== 'mock' && <div className="modal-actions"><button type="button" className="btn" disabled={!!busy || loading || !loaded} onClick={() => void pull()}>{busy === 'pull' ? t('providerPulling') : t('providerPullModels')}</button><button type="button" className="btn" disabled={!!busy || loading || !loaded} onClick={() => void run('test')}>{busy === 'test' ? t('providerTesting') : t('providerTest')}</button><button className="btn btn-primary" type="submit" disabled={!!busy || loading || !loaded}>{busy === 'save' ? t('uiAdding') : t('save')}</button></div>}
      </form>
      </div>
    </div>
  </div>;
}
