import { describe, it, expect } from 'vitest';
import { SteeringQueue } from './SteeringQueue.js';

/**
 * SteeringQueue unit tests (task 051) — enqueue/consume FIFO, pending bookkeeping,
 * audit fields (source + timestamp), accumulation semantics.
 */
describe('SteeringQueue (task 051)', () => {
  it('enqueue adds a steer with id, provenance source and an ISO timestamp', () => {
    const q = new SteeringQueue();
    const item = q.enqueue('先别改这个文件', 'api');

    expect(item).not.toBeNull();
    expect(item!.content).toBe('先别改这个文件');
    expect(item!.source).toBe('api');
    expect(item!.id).toMatch(/^steer_/);
    // auditability: every steer is timestamped with a parseable ISO string
    expect(() => new Date(item!.ts).toISOString()).not.toThrow();
    expect(item!.ts).toBe(new Date(item!.ts).toISOString());
    expect(q.pending).toBe(1);
  });

  it('defaults provenance to user and trims content', () => {
    const q = new SteeringQueue();
    q.enqueue('  keep scope to backend  ');
    const items = q.peek();
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.source).toBe('user');
    expect(item.content).toBe('keep scope to backend');
  });

  it('rejects empty / whitespace-only content (never reaches the model context)', () => {
    const q = new SteeringQueue();
    expect(q.enqueue('')).toBeNull();
    expect(q.enqueue('   ')).toBeNull();
    expect(q.pending).toBe(0);
  });

  it('drain returns all pending steers in FIFO order and clears the queue', () => {
    const q = new SteeringQueue();
    const a = q.enqueue('first', 'cli');
    const b = q.enqueue('second');
    const c = q.enqueue('third', 'web');
    expect(q.pending).toBe(3);

    const batch = q.drain();
    expect(batch.map((i) => i.content)).toEqual(['first', 'second', 'third']);
    expect(batch.map((i) => i.id)).toEqual([a!.id, b!.id, c!.id]);
    expect(q.pending).toBe(0);
    expect(q.drain()).toEqual([]); // draining an empty queue is a no-op
  });

  it('multiple steers accumulate until a single drain consumes them all', () => {
    const q = new SteeringQueue();
    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    // nothing was consumed — all three are still pending
    expect(q.pending).toBe(3);
    const batch = q.drain();
    expect(batch).toHaveLength(3);
    expect(batch.map((i) => i.content)).toEqual(['a', 'b', 'c']);
  });

  it('steers that arrive after a drain stay cached for the next drain', () => {
    const q = new SteeringQueue();
    q.enqueue('during-step');
    expect(q.drain()).toHaveLength(1);

    // a steer enqueued after the boundary is cached, not lost
    q.enqueue('next-boundary');
    expect(q.pending).toBe(1);
    const batch = q.drain();
    expect(batch.map((i) => i.content)).toEqual(['next-boundary']);
  });
});
