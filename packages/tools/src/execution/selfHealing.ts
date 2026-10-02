export interface SelfHealingOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  retryableErrors?: (err: unknown) => boolean;
  signal?: AbortSignal;
  onRetry?: (retry: { attempt: number; delayMs: number; code?: string }) => void;
}

export const DEFAULT_RETRYABLE_CODES = new Set(['EBUSY', 'ETXTBSY', 'ECONNRESET', 'ETIMEDOUT']);

/** Keep platform codes through fetch cause chains and serialized tool errors. */
export function errorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let value = error;
  while (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    const item = value as { code?: unknown; detail?: { code?: unknown }; cause?: unknown };
    const code = item.code ?? item.detail?.code;
    if (typeof code === 'string') return code;
    value = item.cause;
  }
  return undefined;
}

function terminal(error: unknown): boolean {
  const seen = new Set<unknown>();
  let value = error;
  while (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    const item = value as { name?: string; code?: string; errorClass?: string; cause?: unknown };
    if (item.name === 'AbortError' || item.code === 'ABORT_ERR' || ['DENIED', 'SANDBOX_DENIAL', 'INVALID_ARGS', 'TIMEOUT'].includes(item.errorClass ?? '')) return true;
    value = item.cause;
  }
  return false;
}

export function isRetryableToolError(error: unknown): boolean {
  return !terminal(error) && DEFAULT_RETRYABLE_CODES.has(errorCode(error) ?? '');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function executeWithSelfHealing<T>(fn: () => Promise<T>, opts: SelfHealingOptions = {}): Promise<T> {
  const retries = opts.maxRetries ?? 2;
  const initial = opts.initialDelayMs ?? 50;
  const factor = opts.backoffFactor ?? 3;
  if (!Number.isSafeInteger(retries) || retries < 0 || !Number.isFinite(initial) || initial < 0 || !Number.isFinite(factor) || factor < 1) throw new RangeError('invalid self healing options');
  for (let attempt = 0; ; attempt++) {
    opts.signal?.throwIfAborted();
    try { return await fn(); }
    catch (error) {
      opts.signal?.throwIfAborted();
      if (attempt >= retries || terminal(error) || !(opts.retryableErrors ?? isRetryableToolError)(error)) throw error;
      const delayMs = initial === 0 ? 0 : Math.min(2147483647, Math.round(initial * factor ** attempt * (0.8 + Math.random() * 0.4)));
      opts.onRetry?.({ attempt: attempt + 1, delayMs, code: errorCode(error) });
      await delay(delayMs, opts.signal);
    }
  }
}
