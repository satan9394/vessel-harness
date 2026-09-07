import type { ProviderName } from '@cah/llm';

/**
 * apps/cli/providers/modelFetcher — fetch a provider's model list (task 015).
 *
 *   - OpenAI-compatible endpoints expose GET {base}/v1/models → enumerate for
 *     real (cc-switch's "Fetch Models" behavior).
 *   - Anthropic has NO public model-list endpoint (research confirmed) → fall
 *     back to a built-in list of current Claude generations, honestly labelled
 *     "built-in, not live" (Anthropic-compatible gateways that DO expose
 *     /v1/models can still be listed as openai-compatible or noted).
 *   - mock → offline, nothing to fetch.
 */

export interface ModelSource {
  origin: 'live' | 'builtin' | 'none';
  models: string[];
  /** human note about the source (e.g. built-in list, not live) */
  note: string;
}

/** Anthropic Claude model families (built-in fallback — NOT a live enumeration). */
export const ANTHROPIC_BUILTIN_MODELS: string[] = [
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-sonnet-4',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-3-7-sonnet-latest',
  'claude-3-5-haiku-latest',
];

interface OpenAIModelsResponse {
  data?: { id?: string; object?: string }[];
  error?: { message?: string };
}

/**
 * Enumerate models from an OpenAI-compatible endpoint: GET {base}/v1/models
 * (some gateways also accept {base}/models — we try /v1/models first, then
 * /models). Uses the configured apiKey when present.
 */
export async function fetchOpenAIModels(baseUrl: string, apiKey?: string): Promise<ModelSource> {
  const clean = baseUrl.replace(/\/+$/, '');
  const candidates = [`${clean}/v1/models`, `${clean}/models`];
  let lastErr: Error | null = null;
  for (const url of candidates) {
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) {
        lastErr = new Error(`GET ${url} → HTTP ${resp.status}`);
        continue;
      }
      const body = (await resp.json()) as OpenAIModelsResponse;
      if (body.error) throw new Error(`provider error: ${body.error.message}`);
      const ids = (body.data ?? []).map((m) => m.id ?? '').filter((x) => x.length > 0);
      if (ids.length === 0) {
        lastErr = new Error(`GET ${url} returned no models`);
        continue;
      }
      return { origin: 'live', models: ids, note: `live from ${url}` };
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw new Error(`无法拉取模型列表：${lastErr?.message ?? 'unknown'}`);
}

/** Model list for a provider protocol (mock → none; anthropic → builtin fallback). */
export function modelsForProtocol(protocol: ProviderName): ModelSource {
  if (protocol === 'mock') {
    return { origin: 'none', models: [], note: 'mock provider 是离线的，无模型列表' };
  }
  if (protocol === 'anthropic') {
    return {
      origin: 'builtin',
      models: [...ANTHROPIC_BUILTIN_MODELS],
      note: '内置清单（非实时拉取）——Anthropic 官方无公开 /v1/models 枚举端点；Anthropic 兼容层若暴露 /v1/models 可按 openai-compatible 使用',
    };
  }
  return { origin: 'builtin', models: [], note: '' };
}
