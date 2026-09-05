import * as crypto from 'node:crypto';
import {
  MAX_STEPS_PER_TURN,
  type ChatProvider,
  type ChatRequest,
  type ChatResponse,
  type ChatToolDef,
  type SessionRecord,
  type ToolCall,
  type ToolErrorPayload,
} from '@cah/shared';
import { EventBus } from '../events/EventBus.js';
import { LoopState } from '../state/State.js';
import { Session } from '../session/Session.js';

export interface RequestEnvelope {
  model: string;
  messages: Parameters<ChatProvider['chat']>[0]['messages'];
  tools: ChatToolDef[];
  estimateTokens: number;
}

export interface LoopDeps {
  session: Session;
  bus: EventBus;
  provider: ChatProvider;
  model: string;
  /** context builder — assembled per step at BeforeModel (A07) */
  buildContext: (step: number) => Promise<RequestEnvelope>;
  /** executor — runs one tool call after policy pre-execute recheck; returns frozen result */
  runTool: (call: ToolCall) => Promise<ToolResultOutcome>;
  getVisibleTools: () => ChatToolDef[];
  maxSteps?: number;
  llmRetry?: {
    maxRetries?: number;
    onRetry?: (attempt: number, error: unknown) => Promise<void>;
  };
}

export interface ToolResultOutcome {
  /** surface record (tool/result) that was appended — content or error */
  record?: SessionRecord | null;
  content?: string;
  error?: ToolErrorPayload;
  meta: Record<string, unknown>;
}

export interface TurnResult {
  turnId: string;
  kind: 'success' | 'error' | 'interrupted' | 'budget';
  steps: number;
  toolCalls: number;
  finalText: string;
  durationMs: number;
}

const MODEL_RETRYABLE = new Set(['RATE_LIMITED', 'TIMEOUT', 'SERVER_ERROR', 'NETWORK']);

function classifyModelError(err: unknown): string {
  const m = (err as Error)?.message ?? String(err);
  if (/rate\s*limit|429/i.test(m)) return 'RATE_LIMITED';
  if (/timeout/i.test(m)) return 'TIMEOUT';
  if (/5\d\d|server/i.test(m)) return 'SERVER_ERROR';
  if (/network|fetch|econn/i.test(m)) return 'NETWORK';
  return 'UNKNOWN';
}

/**
 * AgentLoop — the single authoritative thin loop (ARCHITECTURE §4.1 / D3 decision point 2).
 * Termination: "no pending tool call / pure text => stop" + mechanical hard cap
 * max_steps_per_turn (default 64). Budgets are policy extensions, not core logic.
 */
export class AgentLoop {
  private readonly deps: LoopDeps;
  private readonly state = new LoopState();
  private readonly maxSteps: number;

  constructor(deps: LoopDeps) {
    this.deps = deps;
    this.maxSteps = deps.maxSteps ?? MAX_STEPS_PER_TURN;
  }

  async runTurn(input: string): Promise<TurnResult> {
    const startedAt = Date.now();
    const { session, bus, provider, model } = this.deps;
    const turnId = `turn_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    this.state.beginTurn(turnId);

    // A03 BeforeTurn (waterfall) — admission/steering veto point
    const beforeTurn = await bus.waterfall('before_turn', { turnId, input });
    if (beforeTurn.result.kind === 'deny') {
      const rec = await session.appendSync({
        type: 'user/message',
        msgId: `m_${crypto.randomBytes(4).toString('hex')}`,
        role: 'user',
        content: input,
        surface: true,
      });
      void rec;
      await session.appendSync({
        type: 'assistant/message',
        msgId: `m_${crypto.randomBytes(4).toString('hex')}`,
        role: 'assistant',
        content: `[blocked] 输入被 BeforeTurn 拦截：${beforeTurn.result.reason ?? 'policy'}`,
        surface: true,
      });
      await session.appendSync({
        type: 'turn/end',
        turnId,
        kind: 'success',
        stats: { steps: 0, toolCalls: 0, durationMs: Date.now() - startedAt },
      });
      await bus.emit('after_turn', { turnId, kind: 'success' });
      return {
        turnId,
        kind: 'success',
        steps: 0,
        toolCalls: 0,
        finalText: '[blocked]',
        durationMs: Date.now() - startedAt,
      };
    }

    await session.appendSync({ type: 'turn/start', turnId, surface: false });
    await session.appendSync({
      type: 'user/message',
      msgId: `m_${crypto.randomBytes(4).toString('hex')}`,
      role: 'user',
      content: input,
      surface: true,
    });

    let finalText = '';
    let dispatchedAny = false;
    let kind: TurnResult['kind'] = 'success';
    const denialCounts = new Map<string, number>();

    try {
      for (let step = 1; step <= this.maxSteps; step++) {
        this.state.beginStep();
        const stepId = `step_${turnId}_${step}`;
        await session.appendSync({ type: 'step/start', stepId, turnId, surface: false });

        // A07 BeforeModel — context builder assembles the envelope
        const envelope = await this.deps.buildContext(step);
        this.state.setContextEstimate(envelope.estimateTokens);
        await bus.emit('before_model', { turnId, step, envelope });

        // Model call with retry (backoff ≤5, EVENT-SPEC A11)
        const response = await this.callModel(envelope, turnId, step);

        if (response.toolCalls.length === 0) {
          // Pure text => stop (semantic stop criterion)
          const rec = await session.appendSync({
            type: 'assistant/message',
            msgId: `m_${crypto.randomBytes(4).toString('hex')}`,
            role: 'assistant',
            content: response.content,
            surface: true,
          });
          void rec;
          finalText = response.content;
          await session.appendSync({ type: 'step/end', stepId, turnId, surface: false });
          await bus.emit('after_model', { turnId, step, response, usage: response.usage });
          break;
        }

        // Tool calls => assistant/attempt (B03)
        const toolCalls: ToolCall[] = response.toolCalls.map((tc) => ({
          toolCallId: tc.id,
          toolName: tc.name,
          arguments: tc.arguments,
        }));
        await session.appendSync({
          type: 'assistant/attempt',
          msgId: `m_${crypto.randomBytes(4).toString('hex')}`,
          role: 'assistant',
          content: response.content,
          toolCalls: toolCalls.map((t) => ({ toolCallId: t.toolCallId, name: t.toolName, arguments: t.arguments })),
          attemptNo: 1,
          surface: false,
        });
        await bus.emit('after_model', { turnId, step, response, usage: response.usage });

        for (const call of toolCalls) {
          this.state.recordToolCall();
          await this.dispatchToolCall(call, denialCounts);
          dispatchedAny = true;
        }

        await session.appendSync({ type: 'step/end', stepId, turnId, surface: false });

        // Continue while work remains owed (denials feed back to the model as tool results)
        const snapshot = this.state.snapshot();
        if (snapshot.steps >= this.maxSteps) {
          kind = 'budget';
          break;
        }
      }
    } catch (err) {
      if (err instanceof DenialLimitError) {
        // denial breaker: same intent denied ≥3 terminates this path — close the
        // turn properly (pairing invariant: turn/start → turn/end) with kind=error
        kind = 'error';
        finalText = finalText || err.message;
      } else {
        throw err;
      }
    }

    if (finalText === '' && kind === 'success') {
      // Hit max steps without a pure-text stop
      kind = 'budget';
    }

    // A04 BeforeStop (serial) — semantic/mechanical joint stop decision point
    const stop = await bus.serial('before_stop', { turnId, finalText, dispatchedAny });
    void stop;

    await session.appendSync({
      type: 'turn/end',
      turnId,
      kind,
      stats: {
        steps: this.state.snapshot().steps,
        toolCalls: this.state.snapshot().toolCalls,
        durationMs: Date.now() - startedAt,
      },
    });
    await bus.emit('after_turn', { turnId, kind });

    return {
      turnId,
      kind,
      steps: this.state.snapshot().steps,
      toolCalls: this.state.snapshot().toolCalls,
      finalText,
      durationMs: Date.now() - startedAt,
    };
  }

  private async callModel(envelope: RequestEnvelope, turnId: string, step: number): Promise<ChatResponse> {
    const maxRetries = this.deps.llmRetry?.maxRetries ?? 5;
    const request: ChatRequest = {
      model: envelope.model,
      messages: envelope.messages,
      tools: envelope.tools.length > 0 ? envelope.tools : undefined,
      temperature: 0,
    };
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await this.deps.provider.chat(request);
      } catch (err) {
        const cls = classifyModelError(err);
        attempt += 1;
        await this.deps.bus.emit('llm_retry', { turnId, step, attempt, errorClass: cls });
        if (attempt > maxRetries || !MODEL_RETRYABLE.has(cls)) {
          throw new Error(`Model call failed after ${attempt} attempt(s): ${(err as Error).message}`);
        }
        if (this.deps.llmRetry?.onRetry) {
          await this.deps.llmRetry.onRetry(attempt, err);
        }
        const backoffMs = Math.min(2000, 100 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  /**
   * Dispatch one tool call through the full pipeline:
   * tool/call (B04) → BeforeTool (A12) waterfall → PolicyDecision (A13) + audit
   * → executor (runTool with pre-execute recheck) → AfterTool (A14) → tool/result (B05).
   * Denial breaker: same intent denied ≥3 terminates the turn path.
   */
  private async dispatchToolCall(call: ToolCall, denialCounts: Map<string, number>): Promise<void> {
    const { session, bus } = this.deps;
    await session.appendSync({
      type: 'tool/call',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      arguments: call.arguments,
      mode: 'auto',
      surface: false,
    });

    // A12 BeforeTool (waterfall): policy engine + sandbox parse are listeners
    const gate = await bus.waterfall('before_tool', {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      arguments: call.arguments,
    });

    if (gate.result.kind === 'deny') {
      await this.recordDenial(call, gate.result.reason ?? 'denied', gate.result.ref, 'rule');
      const error: ToolErrorPayload = {
        errorClass: 'DENIED',
        message: gate.result.reason ?? 'Tool call denied by policy',
      };
      await session.appendSync({
        type: 'tool/result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        error,
        meta: { denied: true, ref: gate.result.ref },
        surface: true,
      });
      await bus.emit('after_tool', { toolCallId: call.toolCallId, toolName: call.toolName, result: { error } });
      // denial breaker: same intent ≥3 → turn ends
      const key = `${call.toolName}:${JSON.stringify(call.arguments)}`;
      const n = (denialCounts.get(key) ?? 0) + 1;
      denialCounts.set(key, n);
      if (n >= 3) {
        throw new DenialLimitError(`same intent denied ${n} times: ${call.toolName}`);
      }
      return;
    }

    if (gate.result.kind === 'ask') {
      // v0.1 ApprovalPolicy=never is enforced service-side in the policy engine
      // (fail-closed); a residual ask means no responder => denied.
      await this.recordDenial(call, gate.result.reason ?? 'approval unavailable (fail-closed)', gate.result.ref, 'approval');
      await session.appendSync({
        type: 'tool/result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        error: { errorClass: 'DENIED', message: 'approval unavailable (fail-closed)' },
        meta: { denied: true, stage: 'approval' },
        surface: true,
      });
      await bus.emit('after_tool', { toolCallId: call.toolCallId, toolName: call.toolName, result: { error: { errorClass: 'DENIED' } } });
      return;
    }

    // allow → execute (executor re-checks policy at pre-execute; tools never trust the caller)
    const outcome = await this.deps.runTool(call);
    await session.appendSync({
      type: 'tool/result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      content: outcome.content,
      error: outcome.error,
      meta: outcome.meta ?? {},
      surface: true,
    });
    await bus.emit('after_tool', {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result: { content: outcome.content, error: outcome.error },
    });
  }

  private async recordDenial(call: ToolCall, reason: string, ref: string | undefined, stage: string): Promise<void> {
    const { session, bus } = this.deps;
    await session.appendSync({
      type: 'audit/denial',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      stage: stage as 'rule',
      ruleRef: ref,
      reason,
      sandboxMode: 'workspace-write',
      surface: false,
    });
    await bus.emit('policy_decision', {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      verdict: 'deny',
      decisionPath: [stage, ref ?? ''].filter(Boolean),
      ruleRef: ref,
      reason,
    });
  }
}

export class DenialLimitError extends Error {}
