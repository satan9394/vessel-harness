/**
 * Safe model discovery for OpenAI-compatible providers.
 *
 * This module deliberately has no provider or runtime dependencies.  A probe
 * is an optional convenience at the edge of the system, so malformed input,
 * an unavailable endpoint, and an unexpected response are all represented as
 * a result value instead of escaping as an exception.
 */

export interface DiscoveredModel {
  /** Model identifier as returned by the provider. */
  id: string;
  /** Provider-reported context window, when one is available. */
  contextWindow?: number;
  /** Whether the identifier strongly suggests a reasoning model. */
  supportsReasoning: boolean;
  /** Provider/owner metadata, when one is available. */
  ownedBy?: string;
}

export interface ModelProbeOptions {
  /** Provider base URL, with or without an `/v1` suffix. */
  baseUrl: string;
  /** Optional bearer token.  It is never included in a returned error. */
  apiKey?: string;
  /** Request timeout in milliseconds. Defaults to 8000. */
  timeoutMs?: number;
  /** Injectable fetch implementation for tests and non-browser runtimes. */
  fetchFn?: typeof fetch;
}

export type ModelProbeErrorCode = 'NETWORK_ERROR' | 'AUTH_FAILED' | 'INVALID_RESPONSE' | 'TIMEOUT';

export interface ModelProbeError {
  code: ModelProbeErrorCode;
  message: string;
  status?: number;
}

export interface ModelProbeResult {
  ok: boolean;
  models: DiscoveredModel[];
  error?: ModelProbeError;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * These are deliberately token-like names with separators on both sides.
 * For example, `gpt-4o` must not be classified merely because it contains an
 * `o`, while `openai/o3-mini` and `DeepSeek-R1` should be.
 */
const REASONING_MODEL_PATTERN = /(?:^|[/:._-])(?:r1|o1|o3|qwq|thinking|reason(?:er|ing))(?:$|[/:._-])/i;

const INVALID_URL_MESSAGE = 'Invalid model endpoint URL.';
const NETWORK_ERROR_MESSAGE = 'Unable to reach model endpoint.';
const TIMEOUT_MESSAGE = 'Model discovery request timed out.';
const AUTH_FAILED_MESSAGE = 'Model discovery authentication failed.';
const INVALID_RESPONSE_MESSAGE = 'Model endpoint returned an invalid response.';

function invalidResult(code: ModelProbeErrorCode, message: string, status?: number): ModelProbeResult {
  const error: ModelProbeError = { code, message };
  if (status !== undefined) error.status = status;
  return { ok: false, models: [], error };
}

/**
 * Resolve the OpenAI-compatible models endpoint without ever reflecting the
 * caller's URL in a result message.  A host root maps to `/v1/models`, while a
 * path already ending in a version (for example `/api/v1`) only gets
 * `/models`.  A custom non-version path is treated as an already-selected API
 * root and receives `/models`.
 */
export function normalizeOpenAIModelsUrl(baseUrl: string): string | null {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) return null;

  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Credentials in a URL are ambiguous and can accidentally be echoed by a
    // fetch implementation.  Require the explicit apiKey option instead.
    if (url.username || url.password) return null;

    const path = url.pathname.replace(/\/+$/, '');
    if (path.length === 0) {
      url.pathname = '/v1/models';
    } else if (/\/models$/i.test(path)) {
      url.pathname = path;
    } else if (/\/v\d+$/i.test(path)) {
      url.pathname = `${path}/models`;
    } else {
      url.pathname = `${path}/models`;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = finitePositiveNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function modelEntries(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  return null;
}

function discoverModel(entry: unknown, secret: string): DiscoveredModel | null {
  if (!isRecord(entry)) return null;
  const id = firstString(entry, ['id', 'model', 'model_id']);
  if (!id) return null;

  const contextWindow = firstNumber(entry, [
    'context_window',
    'contextWindow',
    'max_context_length',
    'maxContextLength',
    'context_length',
    'contextLength',
    'max_model_len',
    'maxModelLen',
  ]);
  const ownedBy = firstString(entry, ['owned_by', 'ownedBy', 'owner']);
  // A broken or malicious endpoint can reflect request headers into its model
  // metadata. Drop that row rather than returning any field containing the
  // caller's credential.
  if (secret && (id.includes(secret) || ownedBy?.includes(secret))) return null;

  const model: DiscoveredModel = {
    id,
    supportsReasoning: REASONING_MODEL_PATTERN.test(id),
  };
  if (contextWindow !== undefined) model.contextWindow = contextWindow;
  if (ownedBy !== undefined) model.ownedBy = ownedBy;
  return model;
}

function timeoutValue(timeoutMs: unknown): number {
  return finitePositiveNumber(timeoutMs) ?? DEFAULT_TIMEOUT_MS;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

/**
 * Safely probe an OpenAI-compatible `/models` endpoint.
 *
 * The catch-all guard is intentional: custom fetch implementations and
 * response shims are third-party boundaries too.  Error messages are fixed
 * constants so neither an API key nor an upstream exception string can leak.
 */
export async function probeOpenAIModels(opts: ModelProbeOptions): Promise<ModelProbeResult> {
  let endpoint: string | null;
  let configuredTimeout: unknown;
  try {
    const baseUrl = isRecord(opts) ? opts.baseUrl : undefined;
    endpoint = typeof baseUrl === 'string' ? normalizeOpenAIModelsUrl(baseUrl) : null;
    configuredTimeout = isRecord(opts) ? opts.timeoutMs : undefined;
  } catch {
    // Even property access on a caller-supplied options proxy is an untrusted
    // boundary; it must not reject the convenience probe.
    return invalidResult('INVALID_RESPONSE', INVALID_URL_MESSAGE);
  }
  if (!endpoint) return invalidResult('INVALID_RESPONSE', INVALID_URL_MESSAGE);

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new Error(TIMEOUT_MESSAGE);
      error.name = 'AbortError';
      reject(error);
    }, timeoutValue(configuredTimeout));
  });

  try {
    const fetchFn = (isRecord(opts) && typeof opts.fetchFn === 'function' ? opts.fetchFn : fetch) as typeof fetch;
    const apiKey = isRecord(opts) && typeof opts.apiKey === 'string' ? opts.apiKey.trim() : '';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey.length > 0) headers.Authorization = `Bearer ${apiKey}`;

    const request = async (): Promise<ModelProbeResult> => {
      const response = await fetchFn(endpoint, { method: 'GET', headers, signal: controller.signal });
      const status = typeof response.status === 'number' && Number.isFinite(response.status) ? response.status : undefined;
      if (status !== undefined && status >= 400) {
        if (status === 401 || status === 403) return invalidResult('AUTH_FAILED', AUTH_FAILED_MESSAGE, status);
        return invalidResult('INVALID_RESPONSE', INVALID_RESPONSE_MESSAGE, status);
      }
      if (response.ok === false) return invalidResult('INVALID_RESPONSE', INVALID_RESPONSE_MESSAGE, status);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return invalidResult('INVALID_RESPONSE', INVALID_RESPONSE_MESSAGE, status);
      }

      const entries = modelEntries(payload);
      if (entries === null) return invalidResult('INVALID_RESPONSE', INVALID_RESPONSE_MESSAGE, status);

      // Ignore malformed entries at the boundary, but keep a valid response with
      // a provider's extra metadata usable.  If every entry is malformed, the
      // response is still structurally valid and returns an empty list.
      const models = entries.map((entry) => discoverModel(entry, apiKey)).filter((model): model is DiscoveredModel => model !== null);
      return { ok: true, models };
    };

    // Race the complete fetch + body parse against the timer. Some fetch
    // adapters ignore AbortSignal, so aborting alone would leave the caller
    // hanging indefinitely even though the signal had fired.
    return await Promise.race([request(), timeoutPromise]);
  } catch (error: unknown) {
    if (isAbortError(error)) return invalidResult('TIMEOUT', TIMEOUT_MESSAGE);
    return invalidResult('NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
