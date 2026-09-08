import type {
  EventContext,
  EventType,
  VerdictAction,
  WaterfallResult,
} from '@vessel/shared';

export type Listener<T = unknown> = (
  payload: T,
  ctx: EventContext,
) => WaterfallResult | VerdictAction | void | Promise<WaterfallResult | VerdictAction | void>;

export interface WaterfallOutcome {
  /** merged result after guard narrowing */
  result: WaterfallResult;
  /** listeners that vetoed (deny/ask) — for audit */
  vetoes: { listener: string; result: WaterfallResult }[];
}

function normalize(listenerName: string, raw: WaterfallResult | VerdictAction | void): WaterfallResult {
  if (!raw) return { kind: 'noop' };
  if (typeof raw === 'string') {
    // VerdictAction shorthand: 'deny' | 'allow' | 'ask'
    return raw === 'deny'
      ? { kind: 'deny', reason: `listener:${listenerName}`, ref: listenerName }
      : raw === 'ask'
        ? { kind: 'ask', ref: listenerName }
        : { kind: 'allow' };
  }
  return raw;
}

/**
 * EventBus — two-domain dispatch primitives (EVENT-SPEC §3.1 / D3 decision point 3).
 * - emit:      fire-and-forget observation (persistent mirrors are written by the caller)
 * - waterfall: sequential decision point; listeners may short-circuit (deny/ask/allow);
 *              guard narrowing afterwards can only make the result stricter.
 * - serial:    sequential side effects; may veto with deny.
 * - parallel:  concurrent observation; errors isolated.
 * - bail:      run listeners until one returns a terminal result.
 */
export class EventBus {
  private listeners = new Map<string, Set<{ name: string; fn: Listener }>>();

  on(type: EventType | string, fn: Listener, name?: string): () => void {
    const entry = { name: name ?? `anon:${type}`, fn };
    const set = this.listeners.get(type) ?? new Set();
    set.add(entry);
    this.listeners.set(type, set);
    return () => {
      set.delete(entry);
    };
  }

  async emit(type: EventType | string, payload: unknown, ctx: EventContext = {}): Promise<void> {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const l of [...set]) {
      try {
        await l.fn(payload, ctx);
      } catch (err) {
        // emit is observation-only: listener errors must never break the loop
        ctx.onListenerError?.(type, l.name, err);
      }
    }
  }

  /**
   * Waterfall decision point: listeners run in registration order.
   * First terminal result (deny/ask/allow) short-circuits. If none, default is 'defer'.
   * Afterwards apply guard narrowing (monotonic — can only get stricter).
   */
  async waterfall(
    type: EventType | string,
    payload: unknown,
    opts: { guard?: VerdictAction; ctx?: EventContext } = {},
  ): Promise<WaterfallOutcome> {
    const set = this.listeners.get(type);
    const vetoes: WaterfallOutcome['vetoes'] = [];
    let current: WaterfallResult = { kind: 'defer' };
    if (set) {
      for (const l of [...set]) {
        let raw: WaterfallResult | VerdictAction | void;
        try {
          raw = await l.fn(payload, opts.ctx ?? {});
        } catch (err) {
          opts.ctx?.onListenerError?.(type, l.name, err);
          continue;
        }
        const r = normalize(l.name, raw);
        if (r.kind === 'deny' || r.kind === 'ask' || r.kind === 'allow') {
          current = r;
          vetoes.push({ listener: l.name, result: r });
          break; // first terminal result short-circuits
        }
        // defer / noop → continue chain
      }
    }
    // guard narrowing: only stricter than current allowed; default guard = existing verdict
    const narrowed = narrow(current, opts.guard);
    return { result: narrowed, vetoes };
  }

  /** serial: sequential side effects; a listener may veto (deny) the proceeding action. */
  async serial(
    type: EventType | string,
    payload: unknown,
    ctx: EventContext = {},
  ): Promise<{ vetoed: boolean; reason?: string }> {
    const set = this.listeners.get(type);
    if (!set) return { vetoed: false };
    for (const l of [...set]) {
      try {
        const r = normalize(l.name, await l.fn(payload, ctx));
        if (r.kind === 'deny') return { vetoed: true, reason: r.reason };
      } catch (err) {
        ctx.onListenerError?.(type, l.name, err);
      }
    }
    return { vetoed: false };
  }

  async parallel(type: EventType | string, payload: unknown, ctx: EventContext = {}): Promise<void> {
    const set = this.listeners.get(type);
    if (!set) return;
    await Promise.all(
      [...set].map(async (l) => {
        try {
          await l.fn(payload, ctx);
        } catch (err) {
          ctx.onListenerError?.(type, l.name, err);
        }
      }),
    );
  }

  /** bail: run listeners until one returns a terminal (deny/ask/allow) result. */
  async bail(type: EventType | string, payload: unknown, ctx: EventContext = {}): Promise<WaterfallResult> {
    const set = this.listeners.get(type);
    if (!set) return { kind: 'defer' };
    for (const l of [...set]) {
      try {
        const r = normalize(l.name, await l.fn(payload, ctx));
        if (r.kind === 'deny' || r.kind === 'ask' || r.kind === 'allow') return r;
      } catch (err) {
        ctx.onListenerError?.(type, l.name, err);
      }
    }
    return { kind: 'defer' };
  }

  listenerCount(type: EventType | string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const STRICTER: Record<VerdictAction, number> = { allow: 0, ask: 1, deny: 2 };

/**
 * Guard narrowing (POLICY-SPEC §4.3): can only make a decision stricter —
 * ALLOW → ASK/DENY, ASK → DENY; never the reverse. `guard` is the pre-existing
 * restriction, `decision` the newly proposed one.
 */
export function narrow(
  decision: WaterfallResult,
  guard?: VerdictAction,
): WaterfallResult {
  if (!guard) return decision;
  if (decision.kind !== 'allow' && decision.kind !== 'ask' && decision.kind !== 'deny') {
    // defer → follow the guard
    return guard === 'deny'
      ? { kind: 'deny', reason: 'guard', ref: 'guard' }
      : guard === 'ask'
        ? { kind: 'ask', ref: 'guard' }
        : { kind: 'allow' };
  }
  if (STRICTER[decision.kind] >= STRICTER[guard]) return decision;
  return guard === 'deny'
    ? { kind: 'deny', reason: `guard narrows ${decision.kind}`, ref: 'guard' }
    : { kind: 'ask', ref: 'guard' };
}
