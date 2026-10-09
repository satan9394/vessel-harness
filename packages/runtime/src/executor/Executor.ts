import type {
  SandboxSeam,
  ToolCall,
  ToolErrorPayload,
  ToolExecutionResult,
  ToolSpec,
  Verdict,
  ModExecutionContext,
  ModInterceptResult,
} from '@vessel/shared';

export interface ExecutorHooks {
  mods?: ExecutorModPipeline;
  modContext?: () => ModExecutionContext;
  onModFailure?: (call: ToolCall, error: unknown) => Promise<void> | void;
  /** policy re-check at pre-execute — tool layer never trusts who called it */
  decide?: (call: ToolCall, spec: ToolSpec) => Promise<Verdict>;
  onPreExecuteDeny?: (call: ToolCall, verdict: Verdict) => Promise<void> | void;
  onResult?: (call: ToolCall, result: ToolExecutionResult) => Promise<void> | void;
}

/** Structural seam: runtime never imports the policy implementation. */
export interface ExecutorModPipeline {
  dispatchObserve(type: string, payload: unknown, context: ModExecutionContext): Promise<void>;
  dispatchRewriteToolInput(name: string, input: Record<string, unknown>, context: ModExecutionContext): Promise<Record<string, unknown>>;
  dispatchIntercept(name: string, input: Record<string, unknown>, context: ModExecutionContext): Promise<ModInterceptResult>;
}

function interceptedResult(value: unknown): ToolExecutionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Mod tool result');
  const result = value as ToolExecutionResult;
  if (typeof result.content !== 'string' || !result.meta || typeof result.meta !== 'object' || Array.isArray(result.meta)) throw new TypeError('Invalid Mod tool result');
  if (result.error && (!['INVALID_ARGS', 'TOOL_FAILURE', 'SANDBOX_DENIAL', 'TIMEOUT', 'DENIED', 'UNKNOWN'].includes(result.error.errorClass) || typeof result.error.message !== 'string')) throw new TypeError('Invalid Mod tool error');
  return { content: result.content, meta: result.meta, ...(result.error ? { error: result.error } : {}) };
}

export interface ExecutorCtx {
  workspaceRoot: string;
  cwd: string;
  sandbox: SandboxSeam;
  /** turn-level cancellation (task 050) — forwarded into every tool execution context */
  signal?: AbortSignal;
}

/**
 * runtime/executor — tool execution container (ARCHITECTURE §4.7).
 * Wraps every execute(): pre-execute policy recheck → execute → post-execute → frozen result.
 * Policy is re-checked here even for non-model channels (POLICY-SPEC §2.3).
 */
export class Executor {
  private modFailed = false;
  constructor(private readonly hooks: ExecutorHooks = {}) {}

  async runTool(tool: ToolSpec, call: ToolCall, ctx: ExecutorCtx): Promise<ToolExecutionResult> {
    // pre-execute: policy recheck (monotonic guard — can only deny)
    if (this.hooks.decide) {
      const verdict = await this.hooks.decide(call, tool);
      if (verdict.action !== 'allow') {
        const error: ToolErrorPayload = {
          errorClass: 'DENIED',
          message: verdict.reason ?? `pre-execute deny (${verdict.ruleRef ?? 'rule'})`,
        };
        await this.hooks.onPreExecuteDeny?.(call, verdict);
        return { content: '', error, meta: { denied: true, decisionPath: verdict.decisionPath } };
      }
    }

    if (this.hooks.mods) {
      try {
        if (this.modFailed) throw new Error('Mod pipeline circuit is open');
        const context = this.hooks.modContext?.() ?? { sessionId: '', turnIndex: 0, metadata: {} };
        await this.hooks.mods.dispatchObserve('before_tool', call, context);
        call = { ...call, arguments: await this.hooks.mods.dispatchRewriteToolInput(call.toolName, call.arguments, context) };
        if (!this.hooks.decide) throw new Error('Mod execution requires host policy');
        const verdict = await this.hooks.decide(call, tool);
        if (verdict.action !== 'allow') {
          await this.hooks.onPreExecuteDeny?.(call, verdict);
          return { content: '', error: { errorClass: 'DENIED', message: verdict.reason ?? 'Mod rewrite denied' }, meta: { denied: true, decisionPath: verdict.decisionPath } };
        }
        const intercepted = await this.hooks.mods.dispatchIntercept(call.toolName, call.arguments, context);
        const result = intercepted.handled ? interceptedResult(intercepted.result)
          : await new Executor({ decide: this.hooks.decide, onPreExecuteDeny: this.hooks.onPreExecuteDeny }).runTool(tool, call, ctx);
        await this.hooks.onResult?.(call, result);
        await this.hooks.mods.dispatchObserve('after_tool', { content: result.content, ...(result.error ? { error: result.error } : {}) }, context);
        return result;
      } catch (error) {
        this.modFailed = true;
        await this.hooks.onModFailure?.(call, error);
        return { content: '', error: { errorClass: 'DENIED', message: 'Mod pipeline failed closed' }, meta: { denied: true, modFailure: true } };
      }
    }

    const toolCtx = {
      workspaceRoot: ctx.workspaceRoot,
      cwd: ctx.cwd,
      sandbox: ctx.sandbox,
      signal: ctx.signal,
      guard: this.hooks.decide
        ? async (c: { toolName: string; arguments: Record<string, unknown> }) => {
            const v = await this.hooks.decide!(
              { toolCallId: call.toolCallId, toolName: c.toolName, arguments: c.arguments },
              tool,
            );
            return {
              action: v.action,
              reason: v.reason,
              ruleRef: v.ruleRef,
              stage: v.decisionPath[0],
            };
          }
        : undefined,
    };

    let result: ToolExecutionResult;
    try {
      result = await tool.execute(call.arguments, toolCtx);
    } catch (err) {
      const error: ToolErrorPayload = {
        errorClass: 'TOOL_FAILURE',
        message: (err as Error).message ?? String(err),
      };
      result = { content: '', error, meta: {} };
    }

    // post-execute: freeze + hooks
    await this.hooks.onResult?.(call, result);
    return result;
  }
}
