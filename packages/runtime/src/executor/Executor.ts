import type {
  SandboxSeam,
  ToolCall,
  ToolErrorPayload,
  ToolExecutionResult,
  ToolSpec,
  Verdict,
} from '@vessel/shared';

export interface ExecutorHooks {
  /** policy re-check at pre-execute — tool layer never trusts who called it */
  decide?: (call: ToolCall, spec: ToolSpec) => Promise<Verdict>;
  onPreExecuteDeny?: (call: ToolCall, verdict: Verdict) => Promise<void> | void;
  onResult?: (call: ToolCall, result: ToolExecutionResult) => Promise<void> | void;
}

export interface ExecutorCtx {
  workspaceRoot: string;
  cwd: string;
  sandbox: SandboxSeam;
}

/**
 * runtime/executor — tool execution container (ARCHITECTURE §4.7).
 * Wraps every execute(): pre-execute policy recheck → execute → post-execute → frozen result.
 * Policy is re-checked here even for non-model channels (POLICY-SPEC §2.3).
 */
export class Executor {
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

    const toolCtx = {
      workspaceRoot: ctx.workspaceRoot,
      cwd: ctx.cwd,
      sandbox: ctx.sandbox,
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
