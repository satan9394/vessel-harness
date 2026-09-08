/**
 * agent-loop/interrupt — turn-level interrupt controller (task 050, roadmap §7.3).
 *
 * One AbortController per ACTIVE turn scope:
 *   begin()    — turn start: open a fresh scope (aborts + replaces any stale one)
 *   signal     — the scope's AbortSignal (threaded into provider requests, tool
 *                execution contexts and subagent delegation)
 *   interrupt()— external surface (CLI Ctrl+C / POST /interrupt / Stop button):
 *                abort the active scope, if any
 *   end()      — turn end / teardown: drop the scope (signal no longer observable)
 *
 * The AgentLoop owns one instance and observes `aborted` at every step boundary
 * plus around in-flight model/tool awaits; interruption therefore always ends
 * the turn with kind='interrupted' (turn/start → turn/end pairing preserved).
 */
export class InterruptController {
  private controller: AbortController | null = null;

  /** Open a fresh interrupt scope for a new turn. A still-open stale scope
   * (an older turn that has not settled yet) is aborted — a new turn cancels
   * its predecessor, matching the controller's pre-050 runTurn semantics. */
  begin(): void {
    const stale = this.controller;
    if (stale && !stale.signal.aborted) stale.abort();
    this.controller = new AbortController();
  }

  /** The current scope's signal; null while no turn is active (idle). */
  get signal(): AbortSignal | null {
    return this.controller?.signal ?? null;
  }

  /** A turn scope is open (begin() without end()). */
  get active(): boolean {
    return this.controller !== null;
  }

  /** The current scope has been interrupted. Always false when idle. */
  get aborted(): boolean {
    return this.controller?.signal.aborted ?? false;
  }

  /**
   * Request interruption of the active turn scope.
   * @returns true when an active, not-yet-aborted scope was interrupted;
   *          false when idle or already aborted (a no-op).
   */
  interrupt(): boolean {
    const c = this.controller;
    if (!c || c.signal.aborted) return false;
    c.abort();
    return true;
  }

  /** Close the scope (turn teardown). Idempotent. */
  end(): void {
    this.controller = null;
  }
}

/** Marker thrown inside the loop when the current turn is interrupted. */
export class TurnInterruptedError extends Error {
  constructor(message = 'turn interrupted') {
    super(message);
    this.name = 'TurnInterruptedError';
  }
}
