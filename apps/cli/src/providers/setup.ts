import * as clack from '@clack/prompts';
import { ProviderStore, type ProviderConfig } from './ProviderStore.js';
import { findPreset, PROVIDER_PRESETS, type ProviderPreset } from './presets.js';
import { fetchOpenAIModels, modelsForProtocol } from './modelFetcher.js';

/**
 * apps/cli/providers/setup — `cah setup` interactive wizard.
 *
 * Upgraded per docs/ideas/PROVIDER-UX-RESEARCH.md §10/§11 (research across
 * opencode /connect, Pi /model, cc-switch Add-Provider + Fetch Models):
 *   - supplier picker  = clack autocomplete (type-to-filter)   [was select]
 *   - model picker     = clack autocompleteMultiselect (search + SPACE toggle)
 *   - API key          = masked; idempotent (already-saved key → confirm reuse)
 *   - model fetch      = live /v1/models for openai-compatible; built-in list
 *     for anthropic; 401/403 retry (≤3), 404/405/parse/timeout → manual entry
 *   - final summary screen before writing (key tail / model count / scope)
 *   - cancel anywhere (isCancel) → nothing written
 *
 * All prompts flow through the injected SetupIO so tests script answers
 * without a real TTY; createClackIO is the default @clack/prompts impl.
 */

export interface SetupIO {
  pickProvider(): Promise<{ kind: 'preset'; preset: ProviderPreset } | { kind: 'custom' } | symbol>;
  askBaseUrl(presetBase: string): Promise<string | symbol>;
  /** returns '' when no key wanted (mock); symbol = cancel */
  askApiKey(presetName: string, hint: string): Promise<string | symbol>;
  /** idempotent gate: provider already has a key → reuse it? */
  confirmReuseKey(presetName: string): Promise<boolean | symbol>;
  pickModels(modelNames: string[]): Promise<string[] | symbol>;
  /** fallback when model fetch fails / endpoint has no /v1/models */
  askManualModels(providerName: string): Promise<string[] | symbol>;
  confirmSetDefault(id: string): Promise<boolean | symbol>;
  confirmOverwrite(id: string): Promise<boolean | symbol>;
  /** final confirmation before writing (summary screen) */
  confirmWrite(summary: string): Promise<boolean | symbol>;
}

/** mask a key for display: keep first 3 + last 3 chars. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}****${key.slice(-3)}`;
}

export function createClackIO(_store: ProviderStore): SetupIO {
  return {
    async pickProvider() {
      const options = [
        ...PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.name, hint: p.hint })),
        { value: '__custom__', label: '自定义端点（聚合/自托管/未列出）', hint: '手动输入 base-url 与协议' },
      ];
      const picked = (await clack.autocomplete({
        message: '选择供应商（输入即搜索）',
        options,
        maxItems: 12,
      })) as string | symbol;
      if (typeof picked !== 'string') return clack.cancel as unknown as symbol;
      if (picked === '__custom__') return { kind: 'custom' };
      const preset = findPreset(picked);
      return preset ? { kind: 'preset', preset } : { kind: 'custom' };
    },
    async askBaseUrl(presetBase: string) {
      const url = (await clack.text({
        message: 'API 端点 base-url',
        placeholder: presetBase || 'https://api.example.com/v1',
      })) as string | symbol;
      return url;
    },
    async askApiKey(presetName: string, hint: string) {
      const key = (await clack.password({
        message: `输入 ${presetName} 的 API Key（不回显；明文存 ~/.dsh）${hint ? ` — ${hint}` : ''}`,
      })) as string | symbol;
      return key;
    },
    async confirmReuseKey(presetName: string) {
      return (await clack.confirm({
        message: `检测到 ${presetName} 已存有 API Key，沿用？（选否重新输入）`,
        initialValue: true,
      })) as boolean | symbol;
    },
    async pickModels(modelNames: string[]) {
      if (modelNames.length === 0) return [];
      const options = modelNames.map((m) => ({ value: m, label: m }));
      const picked = (await clack.autocompleteMultiselect({
        message: '勾选要用的模型（输入搜索 / 空格 勾选 / 回车确认；至少 1 个）',
        options,
        required: true,
      })) as string[] | symbol;
      return picked;
    },
    async askManualModels(providerName: string) {
      const input = (await clack.text({
        message: `无法自动拉取 ${providerName} 的模型。手动输入模型 id（逗号分隔，如 deepseek-chat,deepseek-reasoner）：`,
        placeholder: 'model-a,model-b',
      })) as string | symbol;
      if (typeof input !== 'string') return clack.cancel as unknown as symbol;
      return input.split(',').map((s) => s.trim()).filter(Boolean);
    },
    async confirmSetDefault(id: string) {
      return (await clack.confirm({ message: `把 "${id}" 设为当前默认供应商？（cah run 立即使用）`, initialValue: true })) as boolean | symbol;
    },
    async confirmOverwrite(id: string) {
      return (await clack.confirm({ message: `供应商 "${id}" 已存在，覆盖它？` })) as boolean | symbol;
    },
    async confirmWrite(summary: string) {
      return (await clack.confirm({ message: `确认写入？\n${summary}`, initialValue: true })) as boolean | symbol;
    },
  };
}

export interface WizardDeps {
  store: ProviderStore;
  io: SetupIO;
  /** override model-list fetch (tests inject deterministic results; default = live fetch) */
  fetchModels?: (protocol: ProviderConfig['protocol'], baseUrl: string, apiKey?: string) => Promise<FetchOutcome>;
}

export type FetchOutcome =
  | { ok: true; models: string[]; note: string }
  | { ok: false; reason: 'auth' | 'unsupported' | 'network'; message: string };

/** Live model-list fetch by protocol, classified for the error ladder. */
export async function fetchModelOutcome(
  protocol: ProviderConfig['protocol'],
  baseUrl: string,
  apiKey?: string,
): Promise<FetchOutcome> {
  if (protocol === 'openai-compatible') {
    try {
      const src = await fetchOpenAIModels(baseUrl, apiKey);
      return { ok: true, models: src.models, note: `live from ${baseUrl}` };
    } catch (err) {
      const msg = (err as Error).message;
      if (/401|403|key|auth/i.test(msg)) return { ok: false, reason: 'auth', message: msg };
      if (/404|405|no models/i.test(msg)) return { ok: false, reason: 'unsupported', message: msg };
      return { ok: false, reason: 'network', message: msg };
    }
  }
  if (protocol === 'anthropic') {
    return { ok: true, models: [...modelsForProtocol('anthropic').models], note: '内置 Claude 清单（非实时；Anthropic 官方无公开枚举端点）' };
  }
  return { ok: false, reason: 'unsupported', message: 'mock 无模型列表' };
}

export function sanitizeId(baseOrName: string): string {
  const clean = baseOrName
    .replace(/^https?:\/\//, '')
    .replace(/[.:/]/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
  return clean.slice(0, 40) || 'custom';
}

/**
 * Run the wizard; returns the saved provider id, or null when cancelled.
 * Upgraded flow (research §10): pick → key (idempotent) → fetch models with
 * error ladder → pick models (search+space) → summary confirm → write → default.
 */
export async function runSetupWizard(deps: WizardDeps): Promise<string | null> {
  const { store, io } = deps;
  const s = clack.spinner();
  const fetchModels = deps.fetchModels ?? fetchModelOutcome;

  // ---- step 1: pick provider (searchable autocomplete) ----
  const choice = await io.pickProvider();
  if (typeof choice === 'symbol') return null;
  const preset = choice.kind === 'preset' ? choice.preset : null;
  const isCustom = choice.kind === 'custom';
  const protocol = (preset?.protocol ?? 'openai-compatible') as ProviderConfig['protocol'];
  const presetName = preset?.name ?? '自定义供应商';
  const id = preset ? preset.id : '';

  if (preset && preset.protocol === 'mock') {
    clack.log.info('mock 是内置离线供应商，无需配置。');
    return 'mock';
  }

  // ---- step 2: base-url (custom only) ----
  const baseUrl = (preset ? preset.baseUrl : ((await io.askBaseUrl('')) as string)) ?? '';
  if (isCustom && !baseUrl) {
    clack.log.error('需要 base-url 才能继续。');
    return null;
  }
  if (typeof baseUrl === 'symbol') return null;
  const finalId = id || sanitizeId(baseUrl as string);

  // ---- step 3: API key (masked, idempotent) ----
  let apiKey = '';
  const existingKey = preset && preset.protocol !== 'mock' ? store.get(finalId)?.apiKey : undefined;
  if (existingKey && preset) {
    const reuse = (await io.confirmReuseKey(presetName)) as boolean | symbol;
    if (typeof reuse === 'symbol') return null;
    if (reuse) apiKey = existingKey;
  }
  if (!apiKey && protocol !== 'mock') {
    const hint = preset?.protocol === 'openai-compatible' ? 'sk-...' : '获取地址见供应商官网';
    const key = (await io.askApiKey(presetName, hint)) as string | symbol;
    if (typeof key === 'symbol') return null;
    apiKey = key;
  }

  // ---- step 4: fetch models (error ladder: auth retry ≤3, else manual) ----
  s.start(protocol === 'openai-compatible' ? `正在从 ${baseUrl} 拉取模型…` : '准备模型清单…');
  let outcome: FetchOutcome;
  try {
    outcome = await fetchModels(protocol, baseUrl as string, apiKey || undefined);
  } finally {
    s.stop();
  }

  // auth failure → retry key up to 3 times
  let authTries = 0;
  while (!outcome.ok && outcome.reason === 'auth' && authTries < 3 && protocol !== 'mock') {
    clack.log.error(`API Key 无效或无权限：${outcome.message}`);
    authTries += 1;
    const key = (await io.askApiKey(presetName, '重试（key 无效）')) as string | symbol;
    if (typeof key === 'symbol') return null;
    apiKey = key;
    s.start('重新拉取模型…');
    try {
      outcome = await fetchModels(protocol, baseUrl as string, apiKey || undefined);
    } finally {
      s.stop();
    }
  }

  // unsupported / network → manual model entry (explicit exit, not silent save)
  let modelNames: string[] = [];
  let modelNote = '';
  if (outcome.ok) {
    modelNames = outcome.models;
    modelNote = outcome.note;
  } else if (outcome.reason === 'auth') {
    clack.log.error('多次尝试后 API Key 仍无效。可稍后用 cah provider add / cah models 再试。');
    return null;
  } else {
    clack.log.warn(`${outcome.message} — 转手动输入模型 id（或留空退出）。`);
    const manual = (await io.askManualModels(presetName)) as string[] | symbol;
    if (typeof manual === 'symbol') return null;
    modelNames = manual;
    modelNote = '手动填写';
  }
  if (modelNames.length === 0 && protocol === 'anthropic') {
    modelNames = [...modelsForProtocol('anthropic').models];
    modelNote = '内置 Claude 清单（非实时）';
  }

  // ---- step 5: pick models (search + SPACE) ----
  const picked = (await io.pickModels(modelNames)) as string[] | symbol;
  if (typeof picked === 'symbol') return null;
  if (picked.length === 0 && modelNames.length > 0 && protocol !== 'mock') {
    clack.log.error('至少勾选一个模型。');
    return null;
  }
  const defaultModel = picked[0] ?? preset?.defaultModel ?? '';
  const models = picked.length > 0 ? picked : preset?.defaultModel ? [preset.defaultModel] : [];

  // ---- step 6: summary confirm ----
  const summary = [
    `  供应商: ${presetName} (${finalId})`,
    `  协议: ${protocol}`,
    `  端点: ${(baseUrl as string) || '(mock)'}`,
    apiKey ? `  API Key: ${maskKey(apiKey)}` : '  API Key: (沿用已存)',
    `  模型: ${models.length > 0 ? models.join(', ') : '(默认)'}`,
    `  作用域: ~/.dsh（影响本机所有 cah run）`,
  ].join('\n');
  const confirmed = (await io.confirmWrite(summary)) as boolean | symbol;
  if (confirmed !== true) return null;

  // ---- write ----
  const cfg: ProviderConfig = {
    id: finalId,
    name: presetName,
    protocol,
    baseUrl: protocol === 'mock' ? undefined : (baseUrl as string),
    apiKey: apiKey || existingKey || undefined,
    model: defaultModel || preset?.defaultModel || 'mock-model',
    models: models.length > 0 ? models : undefined,
    note: preset?.hint ?? 'custom endpoint',
  };
  void modelNote;
  if (store.get(finalId)) {
    const overwrite = (await io.confirmOverwrite(finalId)) as boolean | symbol;
    if (overwrite !== true) return null;
    try {
      store.remove(finalId);
    } catch {
      /* overwrite via add below */
    }
  }
  store.add(cfg);

  // ---- step 7: set default ----
  if (protocol !== 'mock') {
    const makeDefault = (await io.confirmSetDefault(finalId)) as boolean | symbol;
    if (makeDefault === true) {
      store.setCurrent(finalId);
      clack.log.success(`已切换。cah run 现在走 ${presetName}/${defaultModel}（热生效，无需重启）`);
    }
  }
  clack.log.success(`已保存供应商 "${finalId}" 到 ~/.dsh/providers.json`);
  return finalId;
}
