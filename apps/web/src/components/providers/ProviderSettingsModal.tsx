import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, type AddProviderInput, type ApiClient, type ProviderInfo, type TestProviderResult } from '../../api';
import type { ModelMessages } from '../../i18n';
import { useI18n } from '../LanguageProvider';

export const PROVIDER_PRESETS: Record<string, AddProviderInput> = {
  DeepSeek: { name: 'deepseek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner'] },
  OpenAI: { name: 'openai', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: [] },
  Claude: { name: 'claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', models: [] },
  Ollama: { name: 'ollama', protocol: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', apiKey: '', models: [] },
  custom: { name: '', protocol: 'openai-compatible', baseUrl: '', apiKey: '', models: [] },
};

export function validateProvider(input: AddProviderInput, providers: ProviderInfo[], saving: boolean): keyof ModelMessages | undefined {
  if (saving && (!/^[\p{L}\p{N}_.-]{1,80}$/u.test(input.name) || input.name === 'mock')) return 'providerInvalidName';
  if (saving && providers.some(provider => provider.name === input.name)) return 'providerDuplicate';
  let url: URL;
  try { url = new URL(input.baseUrl); } catch { return 'providerInvalidUrl'; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return 'providerInvalidUrl';
  const local = input.protocol === 'openai-compatible' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!input.apiKey.trim() && !local) || input.apiKey.length > 8192 || /[\x00-\x1f\x7f]/.test(input.apiKey)) return 'providerKeyRequired';
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

export default function ProviderSettingsModal({ api, onClose, onChanged }: {
  api: ApiClient; onClose: () => void; onChanged?: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [preset, setPreset] = useState('DeepSeek');
  const [form, setForm] = useState(PROVIDER_PRESETS.DeepSeek!);
  const [models, setModels] = useState(form.models.join(', '));
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | 'pull'>();
  const [error, setError] = useState<keyof ModelMessages>();
  const [errorParams, setErrorParams] = useState<Record<string, string>>();
  const [notice, setNotice] = useState<keyof ModelMessages>();
  const [noticeParams, setNoticeParams] = useState<Record<string, string>>();
  const [result, setResult] = useState<TestProviderResult>();
  const [deleting, setDeleting] = useState<string>();
  function fail(key?: keyof ModelMessages, params?: Record<string, string>) { setError(key); setErrorParams(params); }
  async function refresh() {
    const response = await api.listProviders();
    if (mounted.current) { setProviders(response.providers.filter(provider => provider.name !== 'mock')); setLoaded(true); }
  }
  useEffect(() => {
    mounted.current = true;
    const restore = document.activeElement;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    void refresh().catch((thrown: unknown) => { if (mounted.current) { const failure = providerFailure(thrown); fail(failure.key, failure.params); } }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; if (restore instanceof HTMLElement && restore.isConnected) restore.focus(); };
  }, [api]);
  function change(next: Partial<AddProviderInput>) { setForm(previous => ({ ...previous, ...next })); setResult(undefined); fail(undefined); setNotice(undefined); setNoticeParams(undefined); }
  function providerInput(): AddProviderInput {
    return { ...form, name: form.name.trim(), baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim(), models: [...new Set(models.split(/[,，]/).map(model => model.trim()).filter(Boolean))] };
  }
  async function run(action: 'test' | 'save' | 'delete') {
    if (busy || !loaded) return;
    const input = providerInput();
    const invalid = action === 'delete' ? undefined : validateProvider(input, providers, action === 'save');
    fail(invalid); setNotice(undefined);
    if (invalid) return;
    setBusy(action);
    try {
      if (action === 'test') {
        const tested = await api.testProvider(input);
        if (mounted.current) { setResult(tested); if (tested.ok && !models.trim() && tested.availableModels?.length) setModels(tested.availableModels.join(', ')); }
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
      setModels(discovered.join(', '));
      setNotice('providerPulled');
      setNoticeParams({ count: String(discovered.length) });
    } catch (thrown) { if (mounted.current) { const failure = providerFailure(thrown); fail(failure.key, failure.params); } }
    finally { if (mounted.current) setBusy(undefined); }
  }
  const testText = result?.ok ? t('providerConnected', { ms: String(result.latencyMs ?? 0) })
    : result?.error?.match(/^http_(\d{3})$/) ? t('providerHttp', { status: result.error.slice(5) })
    : t(result?.error === 'connection_timeout' ? 'providerTimeout' : result?.error === 'invalid_models_response' ? 'providerBadResponse' : 'providerFailed');
  return <div className="overlay provider-overlay">
    <div className="modal provider-modal" ref={dialog} role="dialog" aria-modal="true" aria-label={t('modelSettings')} tabIndex={-1} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab' && dialog.current) {
        const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'));
        const first = controls[0]; const last = controls.at(-1);
        if (!first) { event.preventDefault(); dialog.current.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="provider-heading"><h3>{t('modelSettings')}</h3><button className="btn" disabled={!!busy} onClick={onClose}>{t('close')}</button></div>
      {loading ? <p role="status">{t('loading')}</p> : providers.length ? <div className="provider-list">{providers.map(provider => <article className="provider-card" key={provider.name}>
        <strong>{provider.name}</strong><span className="provider-badge">{t(provider.protocol === 'anthropic' ? 'providerAnthropic' : 'providerOpenai')}</span>
        <code>{provider.baseUrl}</code><span>{provider.apiKeyMasked || t('providerNoKey')}</span><span>{provider.models.join(', ')}</span>
        {deleting === provider.name ? <div><span>{t('providerDeleteConfirm', { name: provider.name })}</span><button className="btn" disabled={!!busy} onClick={() => void run('delete')}>{t('confirm')}</button><button className="btn" disabled={!!busy} onClick={() => setDeleting(undefined)}>{t('cancel')}</button></div>
          : <button className="btn" disabled={!!busy} onClick={() => setDeleting(provider.name)}>{t('delete')}</button>}
      </article>)}</div> : <p className="dim">{t('providerEmpty')}</p>}
      <form noValidate onSubmit={event => { event.preventDefault(); void run('save'); }}>
        <h4>{t('providerAdd')}</h4>
        <fieldset disabled={!!busy || loading || !loaded} className="provider-fields">
          <label htmlFor={`${id}-preset`}>{t('providerPreset')}</label><select id={`${id}-preset`} className="input" value={preset} onChange={event => { const key = event.target.value; setPreset(key); change(PROVIDER_PRESETS[key]!); setModels(PROVIDER_PRESETS[key]!.models.join(', ')); }}>{Object.keys(PROVIDER_PRESETS).map(key => <option key={key} value={key}>{key === 'custom' ? t('providerCustom') : key}</option>)}</select>
          <label htmlFor={`${id}-name`}>{t('providerName')}</label><input id={`${id}-name`} className="input" maxLength={80} value={form.name} onChange={event => change({ name: event.target.value })} />
          <label htmlFor={`${id}-protocol`}>{t('providerProtocol')}</label><select id={`${id}-protocol`} className="input" value={form.protocol} onChange={event => change({ protocol: event.target.value as AddProviderInput['protocol'] })}><option value="openai-compatible">{t('providerOpenai')}</option><option value="anthropic">{t('providerAnthropic')}</option></select>
          <label htmlFor={`${id}-url`}>{t('providerBaseUrl')}</label><input id={`${id}-url`} className="input" value={form.baseUrl} onChange={event => change({ baseUrl: event.target.value })} />
          <label htmlFor={`${id}-key`}>{t('providerApiKey')}</label><input id={`${id}-key`} className="input" type="password" autoComplete="off" value={form.apiKey} onChange={event => change({ apiKey: event.target.value })} aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className="dim">{t('providerKeyHint')}</p>
          <label htmlFor={`${id}-models`}>{t('providerModels')}</label><input id={`${id}-models`} className="input" value={models} onChange={event => { setModels(event.target.value); fail(undefined); }} />
        </fieldset>
        {error && <p role="alert" className="error-text">{t(error, errorParams)} <button type="button" className="btn" disabled={!!busy} onClick={() => { setLoading(true); void refresh().then(() => setError(undefined)).catch((thrown: unknown) => { const failure = providerFailure(thrown); fail(failure.key, failure.params); }).finally(() => setLoading(false)); }}>{t('retry')}</button></p>}
        {notice && <p role="status">{t(notice, noticeParams)}</p>}
        {result && <p role="status" className={`provider-result ${result.ok ? 'success' : 'failure'}`}>{testText}</p>}
        <div className="modal-actions"><button type="button" className="btn" disabled={!!busy || loading || !loaded} onClick={() => void pull()}>{busy === 'pull' ? t('providerPulling') : t('providerPullModels')}</button><button type="button" className="btn" disabled={!!busy || loading || !loaded} onClick={() => void run('test')}>{busy === 'test' ? t('providerTesting') : t('providerTest')}</button><button className="btn btn-primary" type="submit" disabled={!!busy || loading || !loaded}>{busy === 'save' ? t('uiAdding') : t('save')}</button></div>
      </form>
    </div>
  </div>;
}
