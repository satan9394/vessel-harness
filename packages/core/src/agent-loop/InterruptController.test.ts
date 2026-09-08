import { describe, it, expect } from 'vitest';
import { InterruptController, TurnInterruptedError } from './InterruptController.js';

describe('InterruptController — turn-level abort scope (task 050)', () => {
  it('starts idle: no active scope, no signal, not aborted; interrupt() is a no-op', () => {
    const c = new InterruptController();
    expect(c.active).toBe(false);
    expect(c.signal).toBeNull();
    expect(c.aborted).toBe(false);
    expect(c.interrupt()).toBe(false);
  });

  it('begin() opens an active scope; interrupt() aborts it exactly once', () => {
    const c = new InterruptController();
    c.begin();
    expect(c.active).toBe(true);
    expect(c.aborted).toBe(false);
    expect(c.signal?.aborted).toBe(false);

    expect(c.interrupt()).toBe(true);
    expect(c.aborted).toBe(true);
    expect(c.signal?.aborted).toBe(true);
    // already aborted → further interrupts are no-ops
    expect(c.interrupt()).toBe(false);
  });

  it('end() cleans up the scope: signal no longer observable after teardown', () => {
    const c = new InterruptController();
    c.begin();
    const sig = c.signal!;
    c.interrupt();
    expect(sig.aborted).toBe(true);

    c.end();
    expect(c.active).toBe(false);
    expect(c.signal).toBeNull();
    expect(c.aborted).toBe(false);
    expect(c.interrupt()).toBe(false);
  });

  it('begin() aborts + replaces any stale scope (old signal listeners fire)', () => {
    const c = new InterruptController();
    c.begin();
    const first = c.signal!;
    let firstAborted = false;
    first.addEventListener('abort', () => {
      firstAborted = true;
    });

    c.begin(); // new turn while the old scope was still open
    expect(first.aborted).toBe(true);
    expect(firstAborted).toBe(true);
    // the fresh scope is clean
    expect(c.aborted).toBe(false);
    expect(c.interrupt()).toBe(true);
  });

  it('TurnInterruptedError is a plain Error subclass usable as the loop marker', () => {
    const e = new TurnInterruptedError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('TurnInterruptedError');
    expect(e.message).toBe('turn interrupted');
  });
});
