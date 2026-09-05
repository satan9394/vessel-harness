import type { ToolCall, ToolExecutionResult, ToolSpec } from '@cah/shared';
import type { ToolRegistry } from './Registry.js';

export interface RegistryExecuteContext {
  workspaceRoot: string;
  cwd: string;
  guard?: (call: ToolCall) => Promise<{ action: string; reason?: string; ruleRef?: string; stage?: string }>;
  sandbox: { confine(argv: string[], hint?: Record<string, unknown>): Promise<unknown>; status(): unknown };
}

export interface ParallelBatchOptions {
  /** read-side concurrency, clamped to [1, 3] (任务书 V0.2: 默认并行 1–3) */
  maxParallel?: number;
}

export interface BatchCallResult {
  call: ToolCall;
  result: ToolExecutionResult;
}

/** Read-side families: parallel exploration is for read-only tools (Glob/Grep/Read 族). */
const READ_FAMILIES = new Set(['file_read', 'search']);

export function isReadFamily(spec: ToolSpec | undefined): boolean {
  return !!spec && READ_FAMILIES.has(spec.family) && !spec.exclusive;
}

/**
 * tools/registry — parallel exploration scheduler (MISSION V0.2-M5).
 *
 * Read/write split discipline (读并发/写串行, D3 decision point 7 / H01):
 * read-only calls (file_read/search, non-exclusive) run through a TRUE rolling
 * pool of maxParallel workers (clamped 1–3) — when a worker frees up it pulls
 * the next queued read immediately. Write/exclusive calls are serial barriers:
 * the read queue is drained before a write starts, and later reads wait for the
 * write to finish. Results return in input order (stable).
 */
export class ParallelScheduler {
  private readonly maxParallel: number;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly ctx: RegistryExecuteContext,
    opts: ParallelBatchOptions = {},
  ) {
    this.maxParallel = Math.min(3, Math.max(1, Math.floor(opts.maxParallel ?? 2)));
  }

  get parallelLimit(): number {
    return this.maxParallel;
  }

  async runBatch(calls: ToolCall[]): Promise<BatchCallResult[]> {
    const results = new Map<string, BatchCallResult>();
    const order = calls.map((c) => c.toolCallId);

    const runOne = async (call: ToolCall): Promise<void> => {
      const result = await this.registry.execute(call, this.ctx);
      results.set(call.toolCallId, { call, result });
    };

    // rolling pool: maxParallel workers pull from the shared read queue
    const runReads = async (queue: ToolCall[]): Promise<void> => {
      if (queue.length === 0) return;
      const worker = async (): Promise<void> => {
        for (;;) {
          const call = queue.shift();
          if (!call) return;
          await runOne(call);
        }
      };
      const workers = Array.from({ length: Math.min(this.maxParallel, queue.length) }, () => worker());
      await Promise.all(workers);
    };

    const readQueue: ToolCall[] = [];
    for (const call of calls) {
      const spec = this.registry.spec(call.toolName);
      if (isReadFamily(spec)) {
        readQueue.push(call);
        continue;
      }
      // write / exclusive / unknown tool → serial barrier: drain reads first
      await runReads(readQueue);
      await runOne(call);
    }
    await runReads(readQueue);

    return order.map((id) => results.get(id)!);
  }
}
