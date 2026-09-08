import * as crypto from 'node:crypto';

/**
 * agent-loop/steering — SteeringQueue (task 051, roadmap §7.4).
 *
 * Turn-running steer: while a turn executes, an external surface (CLI keybind,
 * `POST /api/sessions/:id/steer`, web control) can enqueue a user steer
 * directive ("先别改这个文件", "把范围缩小到 backend", "先跑测试再继续").
 *
 * Contract:
 *  - Steers are NEVER preemptive. The AgentLoop drains the queue only at a
 *    **step boundary** — before the next buildContext/model call — so a steer
 *    that arrives while a tool call is executing (or an atomic file write is in
 *    flight) only caches; the in-flight step is never interrupted or re-run.
 *    This is the deliberate contrast with task 050: interrupt = stop the turn,
 *    steer = redirect the next steps and keep going.
 *  - Consumption is all-or-nothing at the boundary: `drain()` atomically takes
 *    every pending steer (FIFO) in one synchronous step. Because enqueue and
 *    drain are both synchronous (no `await` between check and mutation), the
 *    queue is race-free under the single-threaded event loop — a steer that
 *    enqueues between two boundaries can neither be lost nor double-consumed.
 *  - Every steer carries provenance (`source`) and an enqueue timestamp (`ts`),
 *    so the pending state is auditable; once injected, the AgentLoop persists
 *    each steer as a B01 `user/message` record (`source:'steer'`, auto seq/ts)
 *    in the session log, which is the durable audit trail.
 */
export type SteerSource = 'user' | 'api' | 'cli' | 'web';

export interface SteerItem {
  /** unique steer id (audit + tests) */
  id: string;
  /** the raw user steering directive */
  content: string;
  /** provenance — who enqueued this steer ('user' | 'api' | 'cli' | 'web') */
  source: SteerSource;
  /** ISO-8601 enqueue time — every steer is timestamped (audit) */
  ts: string;
}

export class SteeringQueue {
  private items: SteerItem[] = [];

  /**
   * Queue one steer directive. Empty / whitespace-only content is rejected
   * (returns null) so a blank steer can never reach the model context.
   */
  enqueue(content: string, source: SteerSource = 'user'): SteerItem | null {
    const trimmed = content.trim();
    if (trimmed === '') return null;
    const item: SteerItem = {
      id: `steer_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      content: trimmed,
      source,
      ts: new Date().toISOString(),
    };
    this.items.push(item);
    return item;
  }

  /**
   * Consume every pending steer (FIFO) in one atomic step. Returns the batch;
   * the queue is left empty. Unconsumed steers survive across turns — a steer
   * that was never injected because its turn ended early stays pending and is
   * consumed at the next turn's first step boundary.
   */
  drain(): SteerItem[] {
    const batch = this.items;
    this.items = [];
    return batch;
  }

  /** Number of unconsumed steers. */
  get pending(): number {
    return this.items.length;
  }

  /** Read-only view of the pending steers (in FIFO order). */
  peek(): readonly SteerItem[] {
    return this.items;
  }
}
