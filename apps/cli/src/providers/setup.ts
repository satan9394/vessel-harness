import * as clack from '@clack/prompts';
import { ProviderStore, type ProviderConfig } from './ProviderStore.js';
import { findPreset, PROVIDER_PRESETS, type ProviderPreset } from './presets.js';
import { fetchOpenAIModels, modelsForProtocol } from './modelFetcher.js';

/**
 * apps/cli/providers/setup — `cah setup` interactive wizard (guided
 * multi-vendor onboarding; cc-switch-style picker UX in the terminal).
 *
 * Flow (guided, no flags to memorize):
 *   1. searchable provider picker (presets + "custom endpoint")
 *   2. base-url (custom only; presets pre-fill)
 *   3. masked API key (mock skips)
 *   4. model list: live fetch for openai-compatible, built-in Claude list for
 *      anthropic (honestly labelled); searchable SPACE-to-toggle multiselect
 *   5. confirm → save into SSOT (ProviderStore) → offer to switch default
 *
 * All prompts go through the injected SetupIO so automated smoke tests can
 * script answers without a real TTY; the clack implementation is the default.
 */

export interface SetupIO {
  pickProvider(): Promise<{ kind: 'preset'; preset: ProviderPreset } | { kind: 'custom' } | symbol>;
  askBaseUrl(presetBase: string): Promise<string | symbol>;
  askApiKey(presetName: string): Promise<string | symbol>;
  pickModels(modelNames: string[]): Promise<string[] | symbol>;
  confirmSetDefault(id: string): Promise<boolean | symbol>;
  setDefault(id: string): void;
  confirmOverwrite(id: string): Promise<boolean | symbol>;
}

export function createClackIO(_store: ProviderStore): SetupIO {
  return {
    async pickProvider() {
      const options = [
        ...PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.name, hint: p.hint })),
        { value: '__custom__', label: '自定义端点（聚合/自托管/未列出）', hint: '手动输入 base-url' },
      ];
      const picked = (await clack.select({ message: '选择供应商（输入可搜索）', options, maxItems: 12 })) as string | symbol;
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
    async askApiKey(presetName: string) {
      const key = (await clack.password({
        message: `输入 ${presetName} 的 API Key（不回显；明文存 ~/.dsh，注意本机安全）`,
      })) as string | symbol;
      return key;
    },
    async pickModels(modelNames: string[]) {
      if (modelNames.length === 0) return [];
      const options = modelNames.map((m) => ({ value: m, label: m }));
      const picked = (await clack.multiselect({
        message: '勾选要用的模型（↑↓ 移动 / 空格 勾选 / 输入过滤搜索）',
        options,
        required: false,
      })) as string[] | symbol;
      return picked;
    },
    async confirmSetDefault(id: string) {
      return (await clack.confirm({ message: `把 "${id}" 设为当前默认供应商？（之后 cah run 直接用）`, initialValue: true })) as boolean | symbol;
    },
    setDefault(id: string) {
      // handled by the caller's store (kept for a UI-free seam)
      void id;
    },
    async confirmOverwrite(id: string) {
      return (await clack.confirm({ message: `供应商 "${id}" 已存在，覆盖它？` })) as boolean | symbol;
    },
  };
}

export interface WizardDeps {
  store: ProviderStore;
  io: SetupIO;
}

/** live model list fetch by protocol; returns [] when unavailable. */
export async function fetchModelNames(protocol: ProviderConfig['protocol'], baseUrl: string, apiKey?: string): Promise<string[]> {
  if (protocol === 'openai-compatible') {
    try {
      return (await fetchOpenAIModels(baseUrl, apiKey)).models;
    } catch {
      return [];
    }
  }
  if (protocol === 'anthropic') return [...modelsForProtocol('anthropic').models];
  return [];
}

export function sanitizeId(baseOrName: string): string {
  const clean = baseOrName
    .replace(/^https?:\/\//, '')
    .replace(/[.:/]/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
  return clean.slice(0, 40) || 'custom';
}

/** Run the wizard; returns the saved provider id, or null when cancelled. */
export async function runSetupWizard(deps: WizardDeps): Promise<string | null> {
  const { store, io } = deps;
  const s = clack.spinner();

  const choice = await io.pickProvider();
  if (typeof choice === 'symbol') return null;
  const isCustom = choice.kind === 'custom';
  const preset = isCustom ? null : choice.preset;
  const protocol = (preset?.protocol ?? 'openai-compatible') as ProviderConfig['protocol'];
  const presetBase = preset?.baseUrl ?? '';
  const presetName = preset?.name ?? '自定义供应商';

  // mock preset: built-in, nothing to configure.
  if (preset && preset.protocol === 'mock') {
    clack.log.info('mock 是内置离线供应商，无需配置。');
    return 'mock';
  }

  const baseUrl = ((preset ? presetBase : await io.askBaseUrl('')) as string) ?? presetBase;
  if (!baseUrl && protocol !== 'mock') {
    clack.log.error('需要 base-url 才能继续。');
    return null;
  }
  const apiKey = ((await io.askApiKey(presetName)) as string) ?? '';
  if (typeof apiKey === 'symbol') return null;

  const id = preset ? preset.id : sanitizeId(baseUrl);

  // fetch + pick models
  s.start(protocol === 'openai-compatible' ? `正在从 ${baseUrl} 拉取模型…` : '准备模型清单…');
  let modelNames: string[] = [];
  try {
    modelNames = await fetchModelNames(protocol, baseUrl, apiKey || undefined);
  } finally {
    s.stop();
  }
  if (modelNames.length === 0 && protocol === 'openai-compatible') {
    clack.log.warn('拉取模型失败（网络/key 问题）——将用你勾选的模型或默认模型保存；可之后用 cah models 再试。');
  }
  if (protocol === 'anthropic' && modelNames.length === 0) {
    modelNames = [...modelsForProtocol('anthropic').models];
  }

  const picked = (await io.pickModels(modelNames)) as string[] | symbol;
  if (typeof picked === 'symbol') return null;
  const defaultModel = picked[0] ?? preset?.defaultModel ?? '';
  if (!defaultModel && protocol !== 'mock') {
    clack.log.error('至少需要一个模型（或留空用预设默认）。');
    return null;
  }

  const cfg: ProviderConfig = {
    id,
    name: presetName,
    protocol,
    baseUrl: protocol === 'mock' ? undefined : baseUrl,
    apiKey: apiKey || undefined,
    model: defaultModel || 'mock-model',
    models: picked.length > 0 ? picked : undefined,
    note: preset?.hint ?? 'custom endpoint',
  };

  // overwrite guard
  if (store.get(id)) {
    const ok = (await io.confirmOverwrite(id)) as boolean | symbol;
    if (ok !== true) return null;
    try {
      store.remove(id);
    } catch {
      /* id exists — safe to overwrite via add below after remove */
    }
  }
  store.add(cfg);

  const makeDefault = (await io.confirmSetDefault(id)) as boolean | symbol;
  if (makeDefault === true) store.setCurrent(id);
  return id;
}
