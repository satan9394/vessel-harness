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
  /** listeners that THREW at this decision point (audit; each is also minted as `handler_error`) */
  listenerErrors: { listener: string; error: unknown }[];
}

/**
 * 决策点上的**监听器错误策略**（BRIEF-决策点 fail-open）。
 *
 * 设计要点：**逐调用点显式声明**，不做全局一刀切 —— 安全门禁点（能挡下工具执行/委派的
 * waterfall）与纯辅助决策点（admission/观察）的正确取向本来就不一样：
 *
 * - `'fail-closed'`：监听器抛错 ⇒ 铸出 `deny`，`reason`/`ref` 带可机读标记
 *   `listener-error:<listenerName>`，短路余下监听器；调用点据此落 `audit/denial`
 *   （stage `'hook'`，与"规则命中"可区分）+ `policy_decision`。**绝不静默放行**。
 * - `'ask'`：监听器抛错 ⇒ 铸出显式 `ask`（v0.1 `approval: never` ⇒ 服务端仍 fail-closed 拒绝）。
 * - `'defer'`：监听器抛错 ⇒ 视作"该监听器没有意见"，链继续（**历史语义**；只允许非安全点使用）。
 *
 * 三种策略都不会让异常逃逸出 `waterfall`（EVENT-SPEC §3.2.3 错误隔离：绝不崩轮次），
 * 也都不会放宽既有裁决（`narrow` 单调收紧不受影响）。
 */
export type WaterfallErrorPolicy = 'fail-closed' | 'ask' | 'defer';

export interface WaterfallOptions {
  /** pre-existing restriction; narrow() can only make the result stricter */
  guard?: VerdictAction;
  ctx?: EventContext;
  /**
   * 本决策点的监听器错误策略。**省略 = `'defer'`**（保持历史语义不变，兼容既有/未接线调用点）。
   * 生产中的安全门禁点（`before_tool`、`before_delegate`）必须显式声明 `'fail-closed'`。
   */
  listenerErrorPolicy?: WaterfallErrorPolicy;
}

/** 监听器抛错铸出的裁决里使用的可机读标记前缀：`listener-error:<listenerName>`。 */
export const LISTENER_ERROR_REF_PREFIX = 'listener-error:';

/** 铸出 `listener-error:<listenerName>` 标记（reason 与 ref 用同一个值）。 */
export function listenerErrorRef(listenerName: string): string {
  return `${LISTENER_ERROR_REF_PREFIX}${listenerName}`;
}

/** 判定一个裁决的 `ref` 是否来自"监听器抛错 ⇒ fail-closed"（调用点据此选择审计 stage）。 */
export function isListenerErrorRef(ref: string | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith(LISTENER_ERROR_REF_PREFIX);
}

function errorKind(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : String(err);
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
   *
   * 监听器错误由 `opts.listenerErrorPolicy` 治理（见 {@link WaterfallErrorPolicy}）：
   * 安全门禁点显式声明 `'fail-closed'`，监听器抛错**绝不会**退化成"没有意见 ⇒ 放行"；
   * 省略该选项时保持历史语义 `'defer'`。任何抛错都会 (a) 通过 `ctx.onListenerError`
   * 通知调用方，(b) 铸出诊断事件 `handler_error`（EVENT-SPEC §3.4），(c) 记入
   * `outcome.listenerErrors` —— 异常本身不逃逸（§3.2.3 绝不崩轮次）。
   */
  async waterfall(
    type: EventType | string,
    payload: unknown,
    opts: WaterfallOptions = {},
  ): Promise<WaterfallOutcome> {
    const set = this.listeners.get(type);
    const vetoes: WaterfallOutcome['vetoes'] = [];
    const listenerErrors: WaterfallOutcome['listenerErrors'] = [];
    const policy: WaterfallErrorPolicy = opts.listenerErrorPolicy ?? 'defer';
    let current: WaterfallResult = { kind: 'defer' };
    if (set) {
      for (const l of [...set]) {
        let raw: WaterfallResult | VerdictAction | void;
        try {
          raw = await l.fn(payload, opts.ctx ?? {});
        } catch (err) {
          listenerErrors.push({ listener: l.name, error: err });
          await this.reportListenerError(type, l.name, err, opts.ctx, policy);
          if (policy === 'defer') {
            // 历史语义：抛错的监听器 = 没有意见（仅非安全点允许）
            continue;
          }
          // 安全决策点：错误绝不静默降级为放行 —— 铸出明确、可机读、可审计的裁决并短路。
          // 该裁决与普通 deny/ask 走同一条 narrow() 路径：guard 只能更严，不可能被放宽。
          const marker = listenerErrorRef(l.name);
          const detail = `${marker}: ${errorMessage(err)}`;
          current =
            policy === 'fail-closed'
              ? ({ kind: 'deny', reason: detail, ref: marker } satisfies WaterfallResult)
              : ({ kind: 'ask', reason: detail, ref: marker } satisfies WaterfallResult);
          vetoes.push({ listener: l.name, result: current });
          break;
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
    return { result: narrowed, vetoes, listenerErrors };
  }

  /**
   * 决策点上的监听器异常上报：通知调用方的诊断回调（该回调自身抛错不得改变本点的错误策略），
   * 并铸出 EVENT-SPEC §3.4 的 `handler_error` 诊断事件，使"某监听器在哪个决策点上抛了什么"
   * 永远留痕。`await` 以保证裁决返回前审计事件已投递；`handler_error` 自身的监听器抛错由
   * `emit` 隔离，且 `emit` 不会再次上报 handler_error，故不存在递归。
   */
  private async reportListenerError(
    type: string,
    listenerName: string,
    err: unknown,
    ctx: EventContext | undefined,
    policy: WaterfallErrorPolicy,
  ): Promise<void> {
    try {
      ctx?.onListenerError?.(type, listenerName, err);
    } catch {
      // 诊断回调自身抛错：吞掉，绝不因此改变本决策点的错误策略
    }
    const payload: Record<string, unknown> = {
      eventName: type,
      listenerId: listenerName,
      error: { kind: errorKind(err), message: errorMessage(err) },
      policy,
      verdict: policy === 'fail-closed' ? 'deny' : policy,
    };
    const agentId = ctx?.['agentId'];
    if (agentId !== undefined) payload.agentId = agentId;
    await this.emit('handler_error', payload);
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
