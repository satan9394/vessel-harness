import type { LoopTask } from './LoopEngine.js';

/**
 * engine/taskQueue — V0.5-M2 Trigger/Discovery minimal form (task 011;
 * MISSION-V0.5 §三.2). An explicit FIFO task queue feeding LoopEngine's
 * `selectTask` dependency. Backlog/memory discovery is deliberately left as a
 * seam (future Discoverer can implement the same TaskQueue interface or wrap
 * it) — V0.5 does NOT do automatic discovery.
 *
 * Queue contract (matches LoopEngine.selectTask returning null = stop):
 * `next()` returns null on an empty queue, so an iteration loop stops cleanly
 * instead of running with no task.
 */

/** Queue surface — injectable, deterministic-testable. Default item is LoopTask. */
export interface TaskQueue<T = LoopTask> {
  /** number of pending items */
  readonly size: number;
  /** push one task at the back (FIFO order of consumption) */
  enqueue(task: T): void;
  /** take the next task, or null when the queue is empty (stop signal) */
  next(): T | null;
  /** look at the next task without consuming it, or null when empty */
  peek(): T | null;
  /** consume-and-return every pending task in FIFO order; queue ends empty */
  drain(): T[];
  /** true when nothing is pending */
  isEmpty(): boolean;
}

/**
 * Array-backed FIFO task queue. Pure/in-memory: no IO, no timers — trivially
 * testable; swap for a persisted queue later without touching callers.
 */
export class ArrayTaskQueue<T = LoopTask> implements TaskQueue<T> {
  private items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  enqueue(task: T): void {
    this.items.push(task);
  }

  next(): T | null {
    return this.items.shift() ?? null;
  }

  peek(): T | null {
    return this.items[0] ?? null;
  }

  drain(): T[] {
    return this.items.splice(0, this.items.length);
  }
}

/** Factory — the default trigger source: an empty TaskQueue = no candidates. */
export function createTaskQueue<T = LoopTask>(initial: readonly T[] = []): TaskQueue<T> {
  const queue = new ArrayTaskQueue<T>();
  for (const task of initial) queue.enqueue(task);
  return queue;
}

/**
 * Adapter that binds a queue to LoopEngineDeps.selectTask, e.g.
 * `selectTask: queueSelectTask(queue)` in the deps object. Resolves null on an
 * empty queue → LoopEngine stops cleanly (its null-stops contract).
 */
export function queueSelectTask<T>(queue: TaskQueue<T>): () => Promise<T | null> {
  return async () => queue.next();
}
