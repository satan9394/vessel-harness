import { probeOpenAIModels, type ProviderName } from '@vessel/llm';

/**
 * packages/application/providers/modelFetcher — fetch a provider's model list (task 015).
 *
 * task 098: moved here from apps/cli/src/providers/ (same reason as
 * presets.data.ts — break the cli <-> bench-runners tsc -b type cycle).
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

/**
 * Enumerate models from an OpenAI-compatible endpoint: GET {base}/v1/models
 * (some gateways also accept {base}/models — we try /v1/models first, then
 * /models). Uses the configured apiKey when present.
 */
export async function fetchOpenAIModels(baseUrl: string, apiKey?: string): Promise<ModelSource> {
  // Trailing-slash trim by scan, not `/\/+$/` (quadratic with the `$` anchor —
  // CodeQL js/polynomial-redos).
  let clean = baseUrl;
  while (clean.endsWith('/')) clean = clean.slice(0, -1);
  const candidates = [`${clean}/v1/models`, `${clean}/models`];
  let lastError = 'unknown';
  for (const url of candidates) {
    const result = await probeOpenAIModels({ baseUrl: url, apiKey, timeoutMs: 15_000 });
    if (!result.ok) {
      // The probe deliberately returns fixed, credential-safe error messages.
      lastError = result.error?.message ?? 'Model discovery failed.';
      continue;
    }
    const ids = result.models.map((model) => model.id);
    if (ids.length === 0) {
      lastError = `GET ${new URL(url).pathname} returned no models`;
      continue;
    }
    // Keep the note useful without reflecting a caller-supplied URL/query.
    return { origin: 'live', models: ids, note: `live from ${new URL(url).pathname}` };
  }
  throw new Error(`无法拉取模型列表：${lastError}`);
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
