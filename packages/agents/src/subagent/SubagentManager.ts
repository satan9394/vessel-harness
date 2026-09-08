import * as crypto from 'node:crypto';
import type { ChatProvider, PolicyArtifacts, SubagentResultContract, ToolSpec } from '@vessel/shared';
import { EventBus, type TurnResult } from '@vessel/core';
import { createIsolatedRuntime } from './IsolatedRuntime.js';

export type SubagentStopReason = SubagentResultContract['stopReason'];

export interface SubagentResult extends SubagentResultContract {
  durationMs: number;
  childAgentId: string;
  childSessionId: string;
  delegationDepth: number;
  isError: boolean;
}

export interface DelegateRequest {
  prompt: string;
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
 * Generator/Evaluator separation: the child NEVER self-declares success as a
 * completion proof; results carry stopReason + evidence and are subject to
 * independent evaluation (DeterministicEvaluator / EvaluatorAgent, M3).
 */
export class SubagentManager {
  private readonly maxConcurrent: number;
  private readonly maxDepth: number;
  private readonly opts: SubagentManagerOptions;
  private active = 0;

  constructor(opts: SubagentManagerOptions) {
    this.opts = opts;
    // 任务书 V0.2: 默认并行 1–3，不追求数量
    this.maxConcurrent = clampInt(opts.maxConcurrent ?? 2, 1, 3);
    this.maxDepth = opts.maxDepth ?? 3;
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

    const delegateId = `del_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    // A22 BeforeDelegate (waterfall) — listeners may deny (depth/concurrency/policy)
    const gate = await this.opts.bus.waterfall('before_delegate', {
      delegateId,
      toolName: 'Subagent',
      request: { prompt: req.prompt, preset: req.preset, options: { toolFilter: req.toolFilter, outputSchema: req.outputSchema } },
      delegationDepth: req.delegationDepth,
      concurrencyState: { activeChildren: this.active, maxConcurrent: this.maxConcurrent },
    });
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
    try {
      // shrink-only tool set: child ⊆ parent tools; Subagent excluded by default
      // (recursion is additionally guarded by maxDepth)
      const filter = new Set(req.toolFilter ?? []);
      const childTools = this.opts.tools.filter((t) => {
        if (t.name === 'Subagent') return false;
        if (req.toolFilter && !filter.has(t.name)) return false;
        return true;
      });

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
        diagnostic: stopReason === 'error' ? 'child turn ended with kind=error' : undefined,
        durationMs: Date.now() - startedAt,
        childAgentId,
        childSessionId,
        delegationDepth: childDepth,
        isError: stopReason !== 'completed',
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

  private denied(req: DelegateRequest, reason: string, _ref: string): SubagentResult {
    return {
      output: '',
      stopReason: 'denied',
      diagnostic: reason,
      durationMs: 0,
      childAgentId: '',
      childSessionId: '',
      delegationDepth: req.delegationDepth + 1,
      isError: true,
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
