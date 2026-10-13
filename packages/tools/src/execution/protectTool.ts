import type { ToolExecutionResult, ToolSpec } from '@vessel/shared';
import { enforceBoundedOutput } from './boundedOutput.js';
import { errorCode, executeWithSelfHealing, isRetryableToolError } from './selfHealing.js';

const protectedExecutors = new WeakSet<ToolSpec['execute']>();

/** Wrap the actual spec entry point, also used by Executor and child runtimes. */
export function protectTool(tool: ToolSpec): ToolSpec {
  if (protectedExecutors.has(tool.execute)) return tool;
  const execute: ToolSpec['execute'] = async (args, ctx) => {
    let failed: ToolExecutionResult | undefined;
    let attempts = 0;
    const retries: { attempt: number; delayMs: number; code?: string }[] = [];
    let result: ToolExecutionResult;
    try {
      result = await executeWithSelfHealing(async () => {
        failed = undefined;
        if (attempts++ > 0 && ctx.guard) {
          const verdict = await ctx.guard({ toolName: tool.name, arguments: args });
          if (verdict.action !== 'allow') return { content: '', error: { errorClass: 'DENIED' as const, message: verdict.reason ?? 'retry denied by policy' }, meta: { denied: true, ruleRef: verdict.ruleRef } };
        }
        const value = await tool.execute(args, ctx);
        if (value.error && isRetryableToolError(value.error) && !value.meta.interrupted && !value.meta.killed && !value.meta.timedOut && !value.meta.retryUnsafe) {
          failed = value; throw value.error;
        }
        return value;
      }, { maxRetries: tool.effects === 'read_only' || tool.effects === 'idempotent_write' || (!tool.effects && tool.requiredPermission === 'read') ? 2 : 0, signal: ctx.signal, onRetry: retry => retries.push(retry) });
    } catch (error) {
      if (failed && failed.error === error) result = failed;
      else {
        const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : String(error);
        const bounded = enforceBoundedOutput(message);
        // Preserve normal thrown-error semantics; an oversized producer error
        // must not escape into Executor's otherwise unbounded catch result.
        if (!bounded.truncated) throw error;
        result = { content: '', error: { errorClass: 'TOOL_FAILURE', message: bounded.content, ...(errorCode(error) ? { detail: { code: errorCode(error) } } : {}) },
          meta: { boundedError: { originalBytes: bounded.originalBytes, truncatedBytes: bounded.truncatedBytes } } };
      }
    }
    // Outside the retry scope: output processing must never replay a completed effect.
    const bounded = enforceBoundedOutput(result.content);
    const message = result.error ? enforceBoundedOutput(result.error.message) : undefined;
    if (!bounded.truncated && !message?.truncated && !retries.length) return result;
    return { ...result, content: bounded.content,
      error: message?.truncated ? { ...result.error!, message: message.content } : result.error,
      meta: { ...result.meta, ...(bounded.truncated ? { boundedOutput: { originalBytes: bounded.originalBytes, truncatedBytes: bounded.truncatedBytes } } : {}), ...(message?.truncated ? { boundedError: { originalBytes: message.originalBytes, truncatedBytes: message.truncatedBytes } } : {}), ...(retries.length ? { selfHealing: { retries } } : {}) } };
  };
  protectedExecutors.add(execute);
  return { ...tool, execute };
}
