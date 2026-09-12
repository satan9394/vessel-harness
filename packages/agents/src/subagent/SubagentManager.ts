import * as crypto from 'node:crypto';
import type { ChatProvider, PolicyArtifacts, SubagentResultContract, ToolSpec } from '@vessel/shared';
import { EventBus, type TurnResult } from '@vessel/core';
import { createIsolatedRuntime } from './IsolatedRuntime.js';
import type { AgentPreset } from '../presets/types.js';
import { applyPresetToolFace, applyStrictestPresetFace } from '../presets/capabilities.js';

export type SubagentStopReason = SubagentResultContract['stopReason'];

/**
 * preset 面收窄的**可见状态**（BRIEF：未命中不得静默失效，调用方必须能感知「收窄没应用」）：
 * - `none`                —— 本次委派未声明 preset（子代理继承父代理面，shrink-only，父面 ⊆ 父面）；
 * - `applied`             —— 声明了 preset 且解析命中，按该 preset 能力面收窄；
 * - `strictest-fallback`  —— 声明了 preset 但当前组合**未接线**解析器：收窄到最严格面（只读）并 warn；
 * - `denied-unresolved`   —— 声明了 preset 且解析器已接线但解析不到（未注册/拼错）：**拒绝委派**。
 */
export type PresetNarrowingStatus = 'none' | 'applied' | 'strictest-fallback' | 'denied-unresolved';

/** preset 查找器：命中返回 AgentPreset，未命中返回 undefined（也可抛错，见 resolveDelegationPresetFace）。 */
export type PresetLookup = (presetId: string) => AgentPreset | undefined;

/** preset 声明 → 能力面的裁决结果（纯数据，无副作用；调用方据此决定收窄/拒绝）。 */
export type PresetFaceDecision =
  | { kind: 'unclaimed' }
  | { kind: 'applied'; presetId: string; preset: AgentPreset }
  | { kind: 'strictest-fallback'; presetId: string; reason: string }
  | { kind: 'unresolved'; presetId: string; reason: string };

/**
 * 解析一次委派的 preset 声明（fail-closed 策略，BRIEF-权限收窄静默失效）。
 *
 * 分支即策略，逐条无死角：
 * 1. `presetId === undefined`（未声明）→ `unclaimed`：子代理继承父代理工具面（shrink-only，父面 ⊆ 父面，
 *    不存在「以为受限实际全权」——本来就没有人声明受限）。
 * 2. 声明了 preset + `lookup === undefined`（组装方未接线）→ `strictest-fallback`：无法知道角色面，
 *    故取**最严格面**（只读）而不是静默放行全量面；调用方拿到可读 reason 与状态位。
 * 3. 声明了 preset + lookup 抛错（如 registry.getPreset 的 PresetNotFoundError）→ `unresolved`（拒绝）。
 * 4. 声明了 preset + lookup 返回 undefined（未注册 / 名字拼错 / 该环境无此 preset）→ `unresolved`（拒绝）。
 * 5. 声明了 preset + lookup 命中 → `applied`（按 preset 能力面收窄）。
 *
 * 关键不变式：**任何**「声明了 preset」的分支都不会得到父代理全量工具面。
 */
export function resolveDelegationPresetFace(
  presetId: string | undefined,
  lookup: PresetLookup | undefined,
): PresetFaceDecision {
  if (presetId === undefined) return { kind: 'unclaimed' };
  if (lookup === undefined) {
    return {
      kind: 'strictest-fallback',
      presetId,
      reason:
        `preset "${presetId}" 无法解析：本组合未接线 presetLookup（preset 查找器缺省）——` +
        '按 fail-closed 收窄到最严格面（只读：write:false + canDelegate:false），不再静默放行父代理全量工具面',
    };
  }
  let preset: AgentPreset | undefined;
  try {
    preset = lookup(presetId);
  } catch (err) {
    return {
      kind: 'unresolved',
      presetId,
      reason: `unknown agent preset "${presetId}" (lookup threw: ${(err as Error).message})`,
    };
  }
  if (preset === undefined) {
    return { kind: 'unresolved', presetId, reason: `unknown agent preset "${presetId}" (not registered by this delegate's presetLookup)` };
  }
  return { kind: 'applied', presetId, preset };
}

export interface SubagentResult extends SubagentResultContract {
  durationMs: number;
  childAgentId: string;
  childSessionId: string;
  delegationDepth: number;
  isError: boolean;
  /**
   * preset 面收窄的实际结果（见 PresetNarrowingStatus）。BRIEF 新增：调用方由此**感知**
   * 「收窄是否应用」——`none` 未声明；`applied` 已按命中 preset 收窄；`strictest-fallback`
   * 声明了但解析器未接线，已收窄到只读面并 warn；`denied-unresolved` 未解析且已拒绝。
   */
  presetNarrowing?: PresetNarrowingStatus;
}

export interface DelegateRequest {
  prompt: string;
  /**
   * 角色 preset 标签。fail-closed（BRIEF-权限收窄静默失效）：**声明了就一定收窄**——
   * 解析器已接线而解析不到 → 本次委派被拒（stopReason 'denied'，可读原因）；
   * 解析器未接线 → 子代理收窄到最严格面（只读）+ warn + `presetNarrowing` 状态。
   * 只有完全不声明 preset 时才继承父代理工具面（shrink-only）。
   */
  preset?: string;
  /** parent's delegation depth; the child runs at depth+1 */
  delegationDepth: number;
  /** shrink-only: child may only use these tools (subset of the parent's set) */
  toolFilter?: string[];
  /** optional JSON schema — when the output parses as JSON it is captured as `structured` */
  outputSchema?: Record<string, unknown>;
  model?: string;
  maxSteps?: number;
  depthLimit?: number;
}

export interface SubagentManagerOptions {
  workspaceRoot: string;
  cwd?: string;
  provider: ChatProvider;
  model: string;
  policyArtifacts: PolicyArtifacts;
  /** parent-visible tool set; the child receives a narrowed subset */
  tools: ToolSpec[];
  /** parent EventBus — delegation events (A22–A25) are wired here */
  bus: EventBus;
  /** concurrency cap, clamped to [1, 3] (任务书 V0.2: 默认并行 1–3) */
  maxConcurrent?: number;
  /** delegation depth cap (child depth = parent + 1) */
  maxDepth?: number;
  sessionDirBase?: string;
  stableSections?: string[];
  policyGuidance?: string[];
  /** parent session id recorded in the child's session/created (B10) */
  parentSessionId?: string;
  /**
   * Task 055: preset resolver — resolves a delegation's `preset` label to a
   * registered AgentPreset. When present, the child tool face is narrowed by
   * applyPresetToolFace (tools allow-list / write:false read-only / canDelegate:false
   * strips the Subagent tool) BEFORE the caller's explicit toolFilter (both shrink-only).
   *
   * Fail-closed (BRIEF-权限收窄静默失效): a delegation that *declares* a preset never
   * falls back to the parent's full tool face. Resolver wired + miss => the delegation is
   * DENIED (readable reason). Resolver absent + preset declared => the child is narrowed to
   * the strictest face (read-only) and a warning + `presetNarrowing` status make it visible.
   * Only a delegation with NO preset at all inherits the parent face (shrink-only, parent ⊆ parent).
   */
  presetLookup?: PresetLookup;
  /**
   * 收窄降级/兜底的告警出口（默认真 console.warn；测试可注入记录器保持输出干净）。
   * 与 runtime/Sandbox 的 `warn` 注入同一形状：「降级但不静默」。
   */
  onWarn?: (message: string) => void;
}

/**
 * agents/subagent — SubagentManager (ARCHITECTURE §4.10 / D3 decision point 12).
 *
 * A subagent is an ordinary Session reused isomorphically: independent context,
 * independent session log, its own thin loop; the parent only sees the frozen
 * result contract (info hiding, EVENT-SPEC A24). Caps are enforced
 * service-side (fail-closed): concurrency 1–3 and depth limits. Delegation
 * event wiring: BeforeDelegate (A22, waterfall) → SubagentStart (A23, emit) →
 * run → SubagentStop (A24, emit) → AfterDelegate (A25, serial).
 *
 * Preset face (BRIEF-权限收窄静默失效): a delegation that *declares* a preset is
 * never allowed to keep the parent's full tool face when the preset cannot be
 * resolved — resolver-wired misses are DENIED before any child session exists,
 * resolver-absent compositions fall back to the strictest face (read-only) with
 * a visible warning + `SubagentResult.presetNarrowing`. See resolveDelegationPresetFace.
 *
 * Generator/Evaluator separation: the child NEVER self-declares success as a
 * completion proof; results carry stopReason + evidence and are subject to
 * independent evaluation (DeterministicEvaluator / EvaluatorAgent, M3).
 */
export class SubagentManager {
  private readonly maxConcurrent: number;
  private readonly maxDepth: number;
  private readonly opts: SubagentManagerOptions;
  private readonly warn: (message: string) => void;
  private active = 0;

  constructor(opts: SubagentManagerOptions) {
    this.opts = opts;
    // 任务书 V0.2: 默认并行 1–3，不追求数量
    this.maxConcurrent = clampInt(opts.maxConcurrent ?? 2, 1, 3);
    this.maxDepth = opts.maxDepth ?? 3;
    this.warn = opts.onWarn ?? ((message: string) => console.warn(message));
  }

  get activeChildren(): number {
    return this.active;
  }

  get maxConcurrentChildren(): number {
    return this.maxConcurrent;
  }

  get maxDelegationDepth(): number {
    return this.maxDepth;
  }

  /** True when delegating now would be denied by a cap (depth/concurrency). */
  canDelegate(delegationDepth: number): boolean {
    return delegationDepth < this.maxDepth && this.active < this.maxConcurrent;
  }

  async delegate(req: DelegateRequest, opts: { signal?: AbortSignal } = {}): Promise<SubagentResult> {
    // fail-closed service-side caps first (EVENT-SPEC A22 semantics)
    if (req.delegationDepth >= this.maxDepth) {
      return this.denied(req, `delegation depth ${req.delegationDepth} reaches maxDepth ${this.maxDepth}`, 'depth');
    }
    if (this.active >= this.maxConcurrent) {
      return this.denied(req, `concurrency cap ${this.maxConcurrent} reached (active ${this.active})`, 'concurrency');
    }

    // BRIEF-权限收窄静默失效：preset 裁决必须 fail-closed，且必须在**任何子会话产生之前**完成
    // —— 解析器已接线却解析不到（未注册 / 拼错 / 该环境无此 preset）→ 直接拒绝，绝不退化为父代理全量面。
    const presetDecision = resolveDelegationPresetFace(req.preset, this.opts.presetLookup);
    if (presetDecision.kind === 'unresolved') {
      return this.denied(
        req,
        `${presetDecision.reason} — 委派被拒（fail-closed：声明了 preset 却解析不到时，绝不静默退化为父代理全量工具面）`,
        'preset',
        'denied-unresolved',
      );
    }

    const delegateId = `del_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    // A22 BeforeDelegate (waterfall) — listeners may deny (depth/concurrency/policy).
    // BRIEF-决策点 fail-open：委派是**安全门禁点**（子代理能力面在本点是唯一闸口，放行即意味着
    // 一个隔离运行时被创建），因此显式声明 'fail-closed'：监听器抛错会被铸成 ref/reason 带
    // `listener-error:<listenerName>` 的 deny ⇒ 下面统一走 denied(...)（stopReason 'denied'、
    // diagnostic 含可机读标记），绝不静默放行 —— 旧语义（catch → continue）会让 current 停在
    // 'defer'，等于"没有意见"，委派照常发生。
    const gate = await this.opts.bus.waterfall(
      'before_delegate',
      {
        delegateId,
        toolName: 'Subagent',
        request: { prompt: req.prompt, preset: req.preset, options: { toolFilter: req.toolFilter, outputSchema: req.outputSchema } },
        delegationDepth: req.delegationDepth,
        concurrencyState: { activeChildren: this.active, maxConcurrent: this.maxConcurrent },
      },
      { listenerErrorPolicy: 'fail-closed' },
    );
    if (gate.result.kind === 'deny') {
      return this.denied(req, gate.result.reason ?? 'delegation denied by BeforeDelegate listener', 'policy');
    }
    if (gate.result.kind === 'ask') {
      return this.denied(req, gate.result.reason ?? 'delegation requires approval (fail-closed: no responder)', 'policy');
    }

    this.active += 1;
    const childDepth = req.delegationDepth + 1;
    const startedAt = Date.now();
    let childAgentId = '';
    let childSessionId = '';
    /** preset 收窄的实际结果（进入 SubagentResult，调用方可见）。 */
    let presetNarrowing: PresetNarrowingStatus = 'none';
    /** 兜底降级的可读原因（进入 diagnostic + warn，不只留在注释里）。 */
    let presetNote: string | undefined;
    try {
      // shrink-only tool set: child ⊆ parent tools; Subagent excluded by default
      // (recursion is additionally guarded by maxDepth)
      const filter = new Set(req.toolFilter ?? []);
      let childTools = this.opts.tools.filter((t) => {
        if (t.name === 'Subagent') return false;
        return true;
      });
      // task 055 + BRIEF：声明了 preset 的子代理先按其能力面收窄 —— 未解析的组合不得留在全量面
      if (presetDecision.kind === 'applied') {
        childTools = applyPresetToolFace(presetDecision.preset, childTools);
        presetNarrowing = 'applied';
      } else if (presetDecision.kind === 'strictest-fallback') {
        childTools = applyStrictestPresetFace(childTools);
        presetNarrowing = 'strictest-fallback';
        presetNote = presetDecision.reason;
        // 降级但不静默：warn 带 preset id 与后果（与 compose 的 MCP 降级告警同一纪律）
        this.warn(`[vessel] Subagent ${presetNote}（子代理按最严格面构造；如需该角色面请接线 presetLookup）`);
      }
      if (req.toolFilter) {
        childTools = childTools.filter((t) => filter.has(t.name));
      }

      const runtime = await createIsolatedRuntime({
        workspaceRoot: this.opts.workspaceRoot,
        cwd: this.opts.cwd,
        provider: this.opts.provider,
        model: req.model ?? this.opts.model,
        policyArtifacts: this.opts.policyArtifacts,
        tools: childTools,
        source: 'subagent',
        parentSession: this.opts.parentSessionId,
        delegationDepth: childDepth,
        agentPreset: req.preset,
        stableSections: this.opts.stableSections,
        policyGuidance: this.opts.policyGuidance,
        maxSteps: req.maxSteps,
      });
      childSessionId = runtime.session.sessionId;
      childAgentId = `agent_${childSessionId}`;

      // A23 SubagentStart (emit) — child session is running independently
      await this.opts.bus.emit('subagent_start', {
        delegateId,
        childAgentId,
        childSessionId,
        preset: req.preset,
        isContinuable: false,
      });

      // task 050: thread the parent turn's signal into the child. An abort
      // interrupts the child's own loop (child turn ends kind='interrupted' →
      // stopReason 'aborted'), so the delegation resolves promptly instead of
      // the parent waiting out the whole child turn. Note the child's interrupt
      // scope opens synchronously when its runTurn() is invoked below, so
      // interrupting an already-aborted parent still lands on an active scope.
      const childTurn = runtime.loop.runTurn(req.prompt);
      let detachAbort: (() => void) | null = null;
      const stopChild = () => {
        try {
          runtime.loop.interrupt();
        } catch {
          // best-effort: the child may already be closing
        }
      };
      const parentSignal = opts.signal;
      if (parentSignal) {
        if (parentSignal.aborted) stopChild();
        else {
          parentSignal.addEventListener('abort', stopChild, { once: true });
          detachAbort = () => parentSignal.removeEventListener('abort', stopChild);
        }
      }

      let turn!: TurnResult;
      try {
        turn = await childTurn;
      } finally {
        detachAbort?.();
      }

      const stopReason: SubagentStopReason = mapTurnKind(turn.kind);
      const result: SubagentResult = {
        output: turn.finalText,
        stopReason,
        // 兜底降级的原因与错误原因共用 diagnostic 通道（isError 仍如实反映 stopReason）
        diagnostic:
          stopReason === 'error'
            ? 'child turn ended with kind=error'
            : presetNote !== undefined
              ? `preset 收窄降级：${presetNote}`
              : undefined,
        durationMs: Date.now() - startedAt,
        childAgentId,
        childSessionId,
        delegationDepth: childDepth,
        isError: stopReason !== 'completed',
        presetNarrowing,
      };
      if (req.outputSchema && turn.finalText) {
        result.structured = tryParseJson(turn.finalText);
      }

      // A24 SubagentStop (emit) — result contract frozen; mirror is tool/result on the parent side
      await this.opts.bus.emit('subagent_stop', {
        delegateId,
        childAgentId,
        childSessionId,
        result: contractOf(result),
        isError: result.isError,
        durationMs: result.durationMs,
        delegationDepth: childDepth,
      });

      // A25 AfterDelegate (serial) — delegation closed on the parent side
      await this.opts.bus.serial('after_delegate', {
        delegateId,
        result: contractOf(result),
        followUp: { continuable: false, canSendMessage: false },
      });

      await runtime.close();
      return result;
    } catch (err) {
      const result: SubagentResult = {
        output: '',
        stopReason: 'error',
        diagnostic: `subagent run failed: ${(err as Error).message}`,
        durationMs: Date.now() - startedAt,
        childAgentId,
        childSessionId,
        delegationDepth: childDepth,
        isError: true,
        presetNarrowing,
      };
      await this.opts.bus.emit('subagent_stop', {
        delegateId,
        childAgentId,
        childSessionId,
        result: contractOf(result),
        isError: true,
        durationMs: result.durationMs,
        delegationDepth: childDepth,
      });
      return result;
    } finally {
      this.active -= 1;
    }
  }

  private denied(
    req: DelegateRequest,
    reason: string,
    _ref: string,
    narrowing?: PresetNarrowingStatus,
  ): SubagentResult {
    return {
      output: '',
      stopReason: 'denied',
      diagnostic: reason,
      durationMs: 0,
      childAgentId: '',
      childSessionId: '',
      delegationDepth: req.delegationDepth + 1,
      isError: true,
      presetNarrowing: narrowing,
    };
  }
}

function mapTurnKind(kind: 'success' | 'error' | 'interrupted' | 'budget'): SubagentStopReason {
  switch (kind) {
    case 'success':
      return 'completed';
    case 'budget':
      return 'max_tokens';
    case 'interrupted':
      return 'aborted';
    case 'error':
      return 'error';
  }
}

function contractOf(r: SubagentResult): SubagentResultContract {
  return { output: r.output, structured: r.structured, diagnostic: r.diagnostic, stopReason: r.stopReason };
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(v)));
}
