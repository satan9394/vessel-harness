import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorCode, executeWithSelfHealing, isRetryableToolError } from './selfHealing.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const busy = () => Object.assign(new Error('locked'), { code: 'EBUSY' });

describe('tool self healing', () => {
  it('uses two jittered retries centered at 50/150ms and returns success', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fn = vi.fn().mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValue('success');
    const onRetry = vi.fn();
    const run = executeWithSelfHealing(fn, { onRetry });
    await vi.advanceTimersByTimeAsync(49); expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(149); expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(await run).toBe('success');
    expect(onRetry.mock.calls.map(call => call[0].delayMs)).toEqual([50, 150]);
  });
  it('preserves the original exception identity on exhaustion', async () => {
    const error = busy(); const fn = vi.fn().mockRejectedValue(error);
    await expect(executeWithSelfHealing(fn, { initialDelayMs: 0 })).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it.each(['ENOENT', 'EACCES', 'EPERM', 'ABORT_ERR'])('fails immediately for %s', async code => {
    const error = Object.assign(new Error(code), { code }); const fn = vi.fn().mockRejectedValue(error);
    await expect(executeWithSelfHealing(fn)).rejects.toBe(error); expect(fn).toHaveBeenCalledOnce();
  });
  it('recognizes platform codes in causes and tool payloads, handles circular causes', async () => {
    const error = new Error('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
    expect(errorCode(error)).toBe('ECONNRESET'); expect(isRetryableToolError(error)).toBe(true);
    expect(isRetryableToolError({ errorClass: 'TOOL_FAILURE', detail: { code: 'ETIMEDOUT' } })).toBe(true);
    const circular: { cause?: unknown } = {}; circular.cause = circular;
    expect(errorCode(circular)).toBeUndefined();
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('done');
    expect(await executeWithSelfHealing(fn, { initialDelayMs: 0 })).toBe('done');
  });
  it.each(['DENIED', 'SANDBOX_DENIAL', 'INVALID_ARGS', 'TIMEOUT'])('never retries %s even with a custom predicate', async errorClass => {
    const error = { errorClass, detail: { code: 'EBUSY' } }; const fn = vi.fn().mockRejectedValue(error);
    await expect(executeWithSelfHealing(fn, { retryableErrors: () => true })).rejects.toBe(error); expect(fn).toHaveBeenCalledOnce();
  });
  it('cancels during backoff immediately and never starts the next attempt', async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const reason = new Error('stop');
    const fn = vi.fn().mockRejectedValue(busy());
    const run = executeWithSelfHealing(fn, { signal: controller.signal }); const rejection = expect(run).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(1); controller.abort(reason); await rejection;
    expect(fn).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('does no work when already cancelled or options are invalid', async () => {
    const fn = vi.fn(); const controller = new AbortController(); controller.abort();
    await expect(executeWithSelfHealing(fn, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(executeWithSelfHealing(fn, { maxRetries: -1 })).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });
  it('jitter changes the wait within the documented ±20% window', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1);
    const fn = vi.fn().mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValue('done'); const onRetry = vi.fn();
    const run = executeWithSelfHealing(fn, { onRetry }); await vi.runAllTimersAsync(); await run;
    expect(onRetry.mock.calls.map(call => call[0].delayMs)).toEqual([40, 180]);
  });
});
