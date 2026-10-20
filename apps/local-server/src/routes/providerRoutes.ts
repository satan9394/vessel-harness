import type { ProviderConfig, ProviderStore } from '../providers/ProviderStore.js';
import type { ProviderCapabilities } from '@vessel/shared';
import { capabilitiesFor, discoverProviderCapabilities, providerNameForConfig } from '@vessel/llm';

export interface ProviderDto {
  name: string;
  protocol: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  apiKeyMasked: string;
  models: string[];
  isDefault?: boolean;
  modelCapabilities: Record<string, ProviderCapabilities>;
}
export interface AddProviderInput {
  name: string;
  protocol: ProviderDto['protocol'];
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelCapabilities?: Record<string, ProviderCapabilities>;
}
export interface TestProviderResult { ok: boolean; latencyMs?: number; availableModels?: string[]; modelCapabilities?: Record<string, ProviderCapabilities>; error?: string }
/** 「拉取模型」端点返回（task 215）：真实探测 `/v1/models` 后的可用模型清单。 */
export interface PullModelsResult { ok: boolean; latencyMs?: number; models?: string[]; modelCapabilities?: Record<string, ProviderCapabilities>; error?: string }
export interface ModelOptionDto { id: string; name: string; providerName: string; protocol: string; capabilities: ProviderCapabilities }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_provider_input');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}
/**
 * 归一化任意供应商输入（task 215）：兼容 Web 扁平式与 AI-SDK / OpenCode 生态规范式。
 *
 * 识别规则：
 *   - 名称：`name`，缺省回退 `id`（两者都非法则留空，由 `save()` 报 invalid_provider_name）；
 *   - 端点：`baseUrl` / `baseURL`，再回退 `options.baseUrl` / `options.baseURL`；
 *   - 密钥：`apiKey`，再回退 `options.apiKey`；
 *   - 协议：显式 `protocol` 字段优先（非法即 invalid_protocol，保持严格拒收）；
 *     缺省时从 `npm`（如 `@ai-sdk/openai-compatible`）或 `options.protocol` 推断，
 *     含 `anthropic` ⇒ anthropic，其余 ⇒ openai-compatible；
 *   - 模型：`string[]`、逗号（中英）分隔字符串、或**字典型 `models`**（取 `Object.keys`）。
 *
 * 只做**形状归一**，不做安全校验：URL/密钥/模型合法性仍由 `connection()` 与
 * `save()` 按原有 fail-loud 口径判定，具体错误码原样上抛。
 */
export function normalizeProviderInput(input: unknown): AddProviderInput {
  const b = record(input);
  const opts = b.options && typeof b.options === 'object' && !Array.isArray(b.options)
    ? (b.options as Record<string, unknown>)
    : {};
  const name = text(b.name, 80) ? b.name : text(b.id, 80) ? b.id : '';
  const rawUrl = b.baseUrl ?? b.baseURL ?? opts.baseUrl ?? opts.baseURL;
  const rawKey = b.apiKey ?? opts.apiKey ?? '';
  let protocol: AddProviderInput['protocol'] = 'openai-compatible';
  if (b.protocol !== undefined) {
    if (b.protocol !== 'openai-compatible' && b.protocol !== 'anthropic') throw new Error('invalid_protocol');
    protocol = b.protocol;
  } else if (`${String(b.npm ?? '')} ${String(opts.protocol ?? '')}`.toLowerCase().includes('anthropic')) {
    protocol = 'anthropic';
  }
  let models: string[] = [];
  let modelCapabilities: Record<string, ProviderCapabilities> | undefined;
  if (Array.isArray(b.models)) {
    models = b.models.filter((model): model is string => typeof model === 'string' && model.trim().length > 0);
  } else if (typeof b.models === 'string') {
    models = b.models.split(/[,，]/).map(model => model.trim()).filter(Boolean);
  } else if (b.models && typeof b.models === 'object') {
    models = Object.keys(b.models as Record<string, unknown>).filter(key => key.trim().length > 0);
    modelCapabilities = Object.fromEntries(models.map(model => [model, discoverProviderCapabilities(record((b.models as Record<string, unknown>)[model]), protocol)]));
  }
  if (b.modelCapabilities !== undefined) {
    const supplied = record(b.modelCapabilities);
    modelCapabilities = Object.fromEntries(models.map(model => {
      const snapshot = supplied[model] === undefined ? {} : record(supplied[model]);
      // Input declarations cannot self-certify detection or carry arbitrary source text.
      const metadata = Object.fromEntries(Object.entries(snapshot).map(([key, value]) => {
        const capability = record(value);
        if (!['detected', 'declared', 'unknown'].includes(String(capability.status))) throw new Error('invalid_provider_input');
        return [key, capability.status === 'unknown' ? undefined : capability.value];
      }));
      return [model, discoverProviderCapabilities(metadata, protocol)];
    }));
  }
  return {
    name: (name ?? '') as string,
    protocol,
    baseUrl: typeof rawUrl === 'string' ? rawUrl : '',
    apiKey: typeof rawKey === 'string' ? rawKey : '',
    models,
    ...(modelCapabilities ? { modelCapabilities } : {}),
  };
}
export function providerUrl(value: unknown): URL {
  if (!text(value, 2048)) throw new Error('invalid_base_url');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('invalid_base_url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid_base_url');
  return url;
}
function connection(value: unknown, fallbackApiKey?: string): Pick<AddProviderInput, 'protocol' | 'baseUrl' | 'apiKey'> {
  const b = record(value);
  if (b.protocol !== 'openai-compatible' && b.protocol !== 'anthropic') throw new Error('invalid_protocol');
  const url = providerUrl(b.baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  let key = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
  if (!key && fallbackApiKey) {
    key = fallbackApiKey.trim();
  }
  if (typeof key !== 'string' || key.length > 8192 || /[\x00-\x1f\x7f]/.test(key) || (!key && !(local && b.protocol === 'openai-compatible'))) throw new Error('invalid_api_key');
  return { protocol: b.protocol, baseUrl: url.href.replace(/\/$/, ''), apiKey: key };
}
export function providerModels(cfg: ProviderConfig): string[] {
  return [...new Set([cfg.model, ...(cfg.models ?? [])])];
}
export class ProviderRoutes {
  constructor(private readonly store: () => ProviderStore, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 8000) {}
  private dto(cfg: ProviderConfig): ProviderDto {
    const baseUrl = providerUrl(cfg.baseUrl).href.replace(/\/$/, '');
    return { name: cfg.id, protocol: cfg.protocol as ProviderDto['protocol'], baseUrl, apiKeyMasked: cfg.apiKey ? cfg.apiKey.length > 8 ? `****${cfg.apiKey.slice(-4)}` : '****' : '', models: providerModels(cfg), modelCapabilities: Object.fromEntries(providerModels(cfg).map(model => [model, capabilitiesFor(providerNameForConfig(cfg), model, cfg.modelCapabilities?.[model])])), isDefault: this.store().getCurrent() === cfg.id };
  }
  list(): ProviderDto[] { return this.store().load().map(cfg => this.dto(cfg)); }
  save(value: unknown): ProviderDto {
    const b = normalizeProviderInput(value);
    const previous = this.store().get(b.name);
    const conn = connection(b, previous?.apiKey);
    if (!text(b.name, 80) || !/^[\p{L}\p{N}_.-]+$/u.test(b.name) || b.name === 'mock') throw new Error('invalid_provider_name');
    if (!b.models.length || b.models.length > 256 || !b.models.every(m => text(m))) throw new Error('invalid_models');
    const models = [...new Set(b.models)];
    const snapshots = b.modelCapabilities ?? (previous?.baseUrl === conn.baseUrl && previous.protocol === conn.protocol ? previous.modelCapabilities : undefined);
    const cfg: ProviderConfig = { id: b.name, name: b.name, ...conn, model: models[0]!, models,
      modelCapabilities: snapshots ? Object.fromEntries(Object.entries(snapshots).filter(([model]) => models.includes(model))) : undefined };
    const store = this.store();
    if (!store.credentialsEnabled) throw new Error('secure_store_required');
    if (store.get(cfg.id)) store.update(cfg.id, { ...cfg, secretRef: !b.apiKey.trim() && previous?.secretRef ? previous.secretRef : undefined });
    else store.add(cfg);
    return this.dto(store.get(cfg.id)!);
  }
  remove(name: string): boolean {
    if (name === 'mock') throw new Error('builtin_provider');
    const store = this.store();
    if (!store.get(name)) return false;
    store.remove(name);
    // 凭据自愈（task 215）：删掉 secretRef 指向的 store 条目，避免孤儿密钥残留。
    // 即便凭据后端不可用也不阻断配置删除本身（forgetCredential 内部静默降级）。
    store.forgetCredential(name);
    return true;
  }
  models(): ModelOptionDto[] {
    return this.store().list().flatMap(cfg => providerModels(cfg).map(id => ({ id, name: id, providerName: cfg.id, protocol: cfg.protocol, capabilities: capabilitiesFor(providerNameForConfig(cfg), id, cfg.modelCapabilities?.[id]) })));
  }
  resolve(name: string, model?: string): ProviderConfig {
    const cfg = this.store().get(name);
    if (!cfg) throw new Error('unknown_provider');
    if (model !== undefined && !providerModels(cfg).includes(model)) throw new Error('unknown_model');
    if (cfg.protocol !== 'mock') connection({ ...cfg, apiKey: cfg.apiKey ?? '' });
    return { ...cfg, model: model ?? cfg.model };
  }
  async test(value: unknown): Promise<TestProviderResult> {
    const input = record(value);
    const providerName = typeof input.name === 'string' ? input.name : typeof input.id === 'string' ? input.id : undefined;
    const previous = providerName ? this.store().get(providerName) : undefined;
    const conn = connection(value, previous?.apiKey);
    const start = performance.now();
    const base = conn.baseUrl.replace(/\/$/, '');
    const endpoint = `${base}${conn.protocol === 'anthropic' && !base.endsWith('/v1') ? '/v1' : ''}/models`;
    const headers: Record<string, string> = conn.protocol === 'anthropic' ? { 'x-api-key': conn.apiKey, 'anthropic-version': '2023-06-01' } : conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {};
    try {
      const response = await this.fetcher(endpoint, { headers, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return { ok: false, error: `http_${response.status}` };
      const body = record(await response.json());
      if (!Array.isArray(body.data) || !body.data.every(v => v && typeof v === 'object' && text((v as { id?: unknown }).id))) return { ok: false, error: 'invalid_models_response' };
      const modelCapabilities = Object.fromEntries(body.data.map(v => [(v as { id: string }).id, discoverProviderCapabilities(v as Record<string, unknown>, conn.protocol)]));
      const input = record(value);
      const saved = typeof input.name === 'string' ? this.store().get(input.name) : undefined;
      if (saved && saved.baseUrl === conn.baseUrl && saved.protocol === conn.protocol) this.store().update(saved.id, {
        modelCapabilities: Object.fromEntries(Object.entries(modelCapabilities).filter(([model]) => providerModels(saved).includes(model))),
      });
      return { ok: true, latencyMs: Math.round(performance.now() - start), availableModels: [...new Set(body.data.map(v => (v as { id: string }).id))], modelCapabilities };
    } catch (error) {
      return { ok: false, error: error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'connection_timeout' : 'connection_failed' };
    }
  }
  /**
   * 「一键拉取模型」（task 215）：复用 `test()` 的真实探测，但把结果收敛为
   * 模型清单形状 `{ ok, models, latencyMs?, error? }`，供前端按钮直接回填。
   * 任何失败只回传**具体错误码**，不透出上游响应体或密钥。
   */
  async pullModels(value: unknown): Promise<PullModelsResult> {
    const probed = await this.test(value);
    return probed.ok
      ? { ok: true, latencyMs: probed.latencyMs, models: probed.availableModels ?? [], modelCapabilities: probed.modelCapabilities }
      : { ok: false, error: probed.error };
  }
}
