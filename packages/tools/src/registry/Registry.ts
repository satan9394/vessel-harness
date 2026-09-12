import {
  MAX_PARALLEL_TOOL_CALLS,
  type ToolCall,
  type ToolExecutionResult,
  type ToolSpec,
} from '@vessel/shared';

export interface RegistryOptions {
  deniedTools?: string[];
  maxParallel?: number;
}

/**
 * tools/registry (ARCHITECTURE §4.5):
 * - minimal builtin set with schema DSL
 * - exposed-surface trimming: policy-compiled denied tools are removed from the
 *   visible set (denied tools "leave the context")
 * - exclusive barrier (write serialization) + rolling pool (maxParallelToolCalls)
 *   — implemented, but NOT wired in production: see the note on `execute`.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();
  private readonly denied: Set<string>;
  private readonly maxParallel: number;
  private exclusiveChain: Promise<unknown> = Promise.resolve();
  private inFlight = 0;

  constructor(tools: ToolSpec[], opts: RegistryOptions = {}) {
    for (const t of tools) this.tools.set(t.name, t);
    this.denied = new Set(opts.deniedTools ?? []);
    this.maxParallel = opts.maxParallel ?? MAX_PARALLEL_TOOL_CALLS;
  }

  spec(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  /**
   * Dynamic tool registration (D3 decision point 7: MCP is the only dynamic
   * extension channel — `mcp__<server>__<tool>`). Registered tools flow
   * through the same pipeline: BeforeTool → Policy → Execute → AfterTool.
   */
  register(tool: ToolSpec): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** visible tools = registered minus denied (schema-level interceptor) */
  listVisible(): ToolSpec[] {
    return [...this.tools.values()].filter((t) => !this.denied.has(t.name));
  }

  listAll(): ToolSpec[] {
    return [...this.tools.values()];
  }

  get deniedTools(): ReadonlySet<string> {
    return this.denied;
  }

  /**
   * Execute with exclusive barrier + rolling pool.
   *
   * NOT WIRED IN PRODUCTION (V0.1): this scheduling path has no production
   * caller. The AgentLoop dispatches tool calls strictly serially
   * (`AgentLoop.ts`: `for (const call of toolCalls) await this.dispatchToolCall(...)`
   * → `deps.runTool` → the executor's `spec.execute`), so it never reaches
   * `ToolRegistry.execute`; the only non-test caller is `ParallelScheduler`
   * (`registry/parallel.ts`), which itself is currently used only by
   * `parallel.test.ts`. The barrier/rolling-pool semantics below are therefore
   * latent capability, not delivered behaviour — wiring them in is a separate
   * feature decision (concurrency semantics, timeouts, cancellation, error
   * aggregation, result ordering).
   */
  async execute(call: ToolCall, ctx: {
    workspaceRoot: string;
    cwd: string;
    guard?: (call: ToolCall) => Promise<{ action: string; reason?: string; ruleRef?: string; stage?: string }>;
    sandbox: { confine(argv: string[], hint?: Record<string, unknown>): Promise<unknown>; status(): unknown };
  }): Promise<ToolExecutionResult> {
    const tool = this.tools.get(call.toolName);
    if (!tool) {
      return {
        content: '',
        error: { errorClass: 'INVALID_ARGS', message: `unknown tool: ${call.toolName}` },
        meta: {},
      };
    }
    if (this.denied.has(call.toolName)) {
      return {
        content: '',
        error: { errorClass: 'DENIED', message: `tool denied: ${call.toolName}` },
        meta: { denied: true },
      };
    }

    if (this.inFlight >= this.maxParallel) {
      return {
        content: '',
        error: { errorClass: 'TOOL_FAILURE', message: 'rolling pool exhausted' },
        meta: {},
      };
    }

    const run = async (): Promise<ToolExecutionResult> => {
      this.inFlight += 1;
      try {
        return await tool.execute(call.arguments, {
          workspaceRoot: ctx.workspaceRoot,
          cwd: ctx.cwd,
          guard: ctx.guard as never,
          sandbox: ctx.sandbox as never,
        });
      } finally {
        this.inFlight -= 1;
      }
    };

    if (tool.exclusive) {
      // exclusive barrier: serialize behind the chain.
      //
      // CHAIN RECOVERY — the chained callback MUST leave `exclusiveChain`
      // RESOLVED. `run()` rethrows whatever `tool.execute` threw, and a rejected
      // chain is permanent: every later `.then(...)` callback is skipped (so the
      // tool never runs) while that same stale error is handed to unrelated
      // callers. One throwing write tool would therefore silently stop every
      // subsequent write tool. So the failure is captured here — the chain
      // recovers — and rethrown to THIS caller only. The throwing caller still
      // observes exactly the error its own call produced (never swallowed into a
      // success, never replaced by a neighbour's error).
      const settled: { result: ToolExecutionResult; failure?: unknown; failed: boolean } = {
        result: { content: '', error: { errorClass: 'TOOL_FAILURE', message: 'barrier' }, meta: {} },
        failed: false,
      };
      this.exclusiveChain = this.exclusiveChain.then(async () => {
        try {
          settled.result = await run();
        } catch (err) {
          settled.failed = true;
          settled.failure = err;
        }
      });
      await this.exclusiveChain;
      if (settled.failed) throw settled.failure;
      return settled.result;
    }
    return run();
  }
}
