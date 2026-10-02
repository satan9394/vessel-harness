/** Only context/input exhaustion; output-parameter and rate-limit errors are excluded. */
export const CONTEXT_OVERFLOW_PATTERNS: RegExp[] = [
  /longer than the model['’]s context length/i,
  /maximum context length/i,
  /context (?:window|length)(?: is)? exceeded/i,
  /context_length_exceeded/i,
  /prompt is too long/i,
  /(?:input|prompt|context).{0,100}(?:token limit exceeded|too many tokens)/i,
  /(?:input|prompt|context).{0,100}max_tokens.{0,50}exceeded/i,
  /input token count.{0,100}exceeds.{0,40}maximum/i,
];

export function isContextOverflowError(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const value = typeof error === 'object' ? error as { message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; error?: { message?: unknown; code?: unknown } } : undefined;
  const status = value?.status ?? value?.statusCode;
  if (typeof status === 'number' && status !== 400 && status !== 413) return false;
  const message = [error instanceof Error ? error.message : typeof value?.message === 'string' ? value.message : String(error),
    typeof value?.error?.message === 'string' ? value.error.message : ''].join(' ').trim();
  if (/rate.?limit|tokens per minute/i.test(message)) return false;
  if (CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(`${value?.code ?? ''} ${value?.error?.code ?? ''} ${message}`))) return true;
  return status === 400 && /^(?:token limit exceeded|too many tokens)$/i.test(message);
}
