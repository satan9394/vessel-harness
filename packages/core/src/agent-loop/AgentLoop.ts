import * as crypto from 'node:crypto';
import {
  MAX_STEPS_PER_TURN,
  type ChatFinishReason,
  type ChatProvider,
  type ChatRequest,
  type ChatResponse,
  type ChatToolCall,
  type ChatToolDef,
  type ChatUsage,
  type SessionRecord,
  type StreamChunk,
  type ToolCall,
  type ToolErrorPayload,
} from '@vessel/shared';
import { EventBus, isListenerErrorRef } from '../events/EventBus.js';
import { LoopState } from '../state/State.js';
import { Session } from '../session/Session.js';
import { InterruptController, TurnInterruptedError } from './InterruptController.js';
import { SteeringQueue, type SteerSource } from './SteeringQueue.js';

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
  /**
   * executor — runs one tool call after policy pre-execute recheck; returns
   * frozen result. The optional second argument carries the turn's
   * AbortSignal (task 050): implementations that spawn long work (shell
   * processes, MCP, subagent) forward it; ones that ignore it still get
   * stopped at the loop's next boundary.
   */
  runTool: (call: ToolCall, ctx?: { signal?: AbortSignal | null }) => Promise<ToolResultOutcome>;
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
 * chat()/stream equivalence for finishReason: a stream whose wire finishReason
 * says nothing meaningful is normalized by what was actually produced —
 * hasToolCalls ⇒ 'tool_calls' (matches MockProvider.chat() semantics);
 * explicit length/error pass through.
 */
function normalizeFinishReason(wire: string | undefined, hasToolCalls: boolean): ChatFinishReason {
  if (wire === 'length' || wire === 'error') return wire;
  if (wire === 'tool_calls' || hasToolCalls) return 'tool_calls';
  return 'stop';
}

/**
 * Parse accumulated tool-call arguments at tool_call_end. Mirrors the defensive
 * fallback of the OpenAI chat() provider (JSON.parse failure -> { _raw: <raw> })
 * so a malformed/truncated fragment can never break a turn; an empty string is a
 * zero-argument call and yields {}.
 */
function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed === '') return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return { value: parsed }; // valid JSON that is not an object (string/number/…)
  } catch {
    return { _raw: raw };
  }
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
  /** turn-level interrupt scope (task 050): begin per turn, abort on interrupt, end on teardown */
  private readonly interruptCtl = new InterruptController();
  /** running-steer queue (task 051): enqueued any time, drained only at step boundaries */
  private readonly steerQueue = new SteeringQueue();

  constructor(deps: LoopDeps) {
    this.deps = deps;
    this.maxSteps = deps.maxSteps ?? MAX_STEPS_PER_TURN;
  }

  /**
   * Request interruption of the current turn (if one is running).
   * External surfaces (CLI first Ctrl+C, POST /interrupt, web Stop) call this.
   * @returns true when an active, not-yet-aborted turn was interrupted.
   */
  interrupt(): boolean {
    return this.interruptCtl.interrupt();
  }

  /** Whether the current turn scope has been interrupted. */
  get interrupted(): boolean {
    return this.interruptCtl.aborted;
  }

  /** Whether a turn scope is currently open (a turn is running). */
  get turnActive(): boolean {
    return this.interruptCtl.active;
  }

  /**
   * Steer the running session (task 051): enqueue a user direction-change
   * directive ("先别改这个文件", "把范围缩小到 backend", "先跑测试再继续").
   * Unlike interrupt() a steer NEVER stops anything: it is consumed at the next
   * step boundary and injected as a user-level message into the next model
   * context, redirecting subsequent steps only. A steer enqueued while no turn
   * is running stays pending and applies to the next turn.
   * @returns true when the steer was accepted (non-empty content).
   */
  steer(content: string, source?: SteerSource): boolean {
    return this.steerQueue.enqueue(content, source) !== null;
  }

  /** Number of buffered, unconsumed steer directives (task 051). */
  get pendingSteerCount(): number {
    return this.steerQueue.pending;
  }

  async runTurn(input: string): Promise<TurnResult> {
    // per-turn lifecycle: open the scope (aborting any stale predecessor),
    // and ALWAYS close it afterwards — even when the inner run throws.
    this.interruptCtl.begin();
    try {
      return await this.runTurnInner(input);
    } finally {
      this.interruptCtl.end();
    }
  }

  private async runTurnInner(input: string): Promise<TurnResult> {
    const startedAt = Date.now();
    const { session, bus, provider, model } = this.deps;
    const turnId = `turn_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    this.state.beginTurn(turnId);

    // A03 BeforeTurn (waterfall) — admission/steering veto point.
    // BRIEF-决策点 fail-open：本点是**辅助决策点**，显式声明 'defer'（监听器抛错 = 不否决该轮）：
    //   1) 真正的能力门禁在 before_tool + Executor.decide（本点没有能力面可放行，deny 不是最后一条防线）；
    //   2) 同一条链上挂着纯观察型监听器（Telemetry/TeamProjection 在 before_turn 上计数/记录），
    //      把它们的一次诊断故障升级为"整轮停摆"会把合法的"不否决"流程弄坏；
    //   3) 错误仍然可审计：waterfall 会铸出 handler_error（EVENT-SPEC §3.4）+ outcome.listenerErrors。
    const beforeTurn = await bus.waterfall(
      'before_turn',
      { turnId, input },
      { listenerErrorPolicy: 'defer' },
    );
    if (beforeTurn.result.kind === 'deny') {
      // BRIEF「kind 说谎」修复（本卡）—— 被 BeforeTurn 拒绝的回合 ⇒ `kind='error'`（三处一致：
      // `turn/end` 记录、`after_turn` 事件、返回的 `TurnResult`）。
      //
      // 改前这里三处都写 `'success'`：输入被策略拒绝、**0 次模型调用、0 步、没有任何助手回答**，
      // 却被上报成"回合成功"。四个消费面（TUI `renderTurnOutcome` / CLI `turnHeader`+`turnExitCode`
      // / HTTP `turnStatusFor` / runner `turnKind`+evaluator `stopReason`）在各自刚修成"如实呈现"
      // 之后，仍然把这个**错误的值**如实呈现成成功 ⇒ 被拒输入在 TUI 里是正常助手回复、
      // 在 `vessel run` 里退出码 0、在 HTTP 面是 200。
      //
      // 裁决依据（不新增词表）：
      //  1. 语义：该回合**没有跑完**（`turn/start`/`step/start` 从未写出、无助手回答），失败的性质
      //     由 `finalText`（`[blocked] …`，含原因）如实承载，不丢信息；
      //  2. `docs/EVENT-SPEC.md:234/469` 的既定词表是 `'success'|'error'|'interrupted'|'budget'`，
      //     新增 `'blocked'` 要动词表 + 所有消费方穷尽分支，影响面远大于收益；
      //  3. 选 `'interrupted'` 会适得其反：既有裁决里 `interrupted` **不算失败**
      //     （`cli.turnExitCode('interrupted') === 0`），被拒输入在脚本眼里仍是成功；
      //  4. 选 `'error'` 让已修好的四个消费面自动正确（TUI `[错误]` 标记 / CLI 退 1 且不冒充
      //     「最终回复」/ HTTP 500 / runner `turnKind='error'`）。
      //
      // 刻意**不动**的部分：`user/message` 与 `assistant/message` 的内容逐字不变
      // （`[blocked] 输入被 BeforeTurn 拦截：<reason>`，用户仍要看得到原因）；`steps: 0` /
      // `toolCalls: 0` / `durationMs` 语义不变；**模型调用次数仍是 0**（本分支在任何模型调用
      // 之前返回）。
      //
      // `finalText` 由 `'[blocked]'` 扩成与 `assistant/message` **同一段文案**（`[blocked] … <原因>`）：
      // 改前它是裸的 `'[blocked]'`，不含原因 ⇒ 只打印 `result.finalText` 的消费面（CLI 错误标题下
      // 那一行、TUI `[错误]` 行、HTTP body）里用户看不到"被谁按什么理由拒的"，与"错误文本含原因"
      // 的验收不符。前缀 `[blocked]` 与原因都在，只增不减（不吞信息、不丢 `[blocked]` 标记）。
      const blockedText = `[blocked] 输入被 BeforeTurn 拦截：${beforeTurn.result.reason ?? 'policy'}`;
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
        content: blockedText,
        surface: true,
      });
      await session.appendSync({
        type: 'turn/end',
        turnId,
        kind: 'error',
        stats: { steps: 0, toolCalls: 0, durationMs: Date.now() - startedAt },
      });
      await bus.emit('after_turn', { turnId, kind: 'error' });
      return {
        turnId,
        kind: 'error',
        steps: 0,
        toolCalls: 0,
        finalText: blockedText,
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
        // task 050: an interrupt that arrived between steps stops the turn here
        // (no step/start is opened for a ghost step — the previous step/end
        // already closed its step, so step pairing stays intact).
        if (this.interruptCtl.aborted) {
          kind = 'interrupted';
          break;
        }
        // task 051 — steering boundary: consume pending steers BEFORE the next
        // context build / model call. Each steer becomes a persisted B01
        // user/message record (source='steer') that the context builder's
        // surface projection folds into the next request. Because the queue is
        // drained only here, a steer that arrived while the previous step's
        // model/tool work was in flight never interrupts it — it only
        // redirects the step about to run (interrupt = stop, steer = redirect).
        await this.drainSteers();
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
            // task 109: thinking 模式思维链随消息持久化，供 ContextBuilder 回传 reasoning_content
            reasoningContent: response.reasoningContent,
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
          // task 109: thinking 模式思维链随尝试持久化，供 ContextBuilder 回传 reasoning_content
          reasoningContent: response.reasoningContent,
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

        // task 050: an interrupt that landed while tools were dispatched stops here
        if (this.interruptCtl.aborted) {
          kind = 'interrupted';
          break;
        }

        // Continue while work remains owed (denials feed back to the model as tool results)
        const snapshot = this.state.snapshot();
        if (snapshot.steps >= this.maxSteps) {
          kind = 'budget';
          break;
        }
      }
    } catch (err) {
      if (err instanceof TurnInterruptedError || this.interruptCtl.aborted) {
        // task 050: user interrupt terminates the path — close the turn properly
        // (pairing invariant: turn/start → turn/end) with kind='interrupted'
        kind = 'interrupted';
        finalText = finalText || '';
      } else if (err instanceof DenialLimitError) {
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

  /**
   * Model invocation (task 049 — stream first): when the provider implements
   * stream() the loop consumes the AsyncIterable<StreamChunk> and emits the
   * model_stream_* event family per chunk, accumulating a ChatResponse that is
   * semantically identical to what chat() would have returned (same content /
   * toolCalls / usage / finishReason). Providers without stream() fall back to
   * the existing chat() path unchanged. Retry/backoff (A11 + llm_retry) wraps
   * both paths identically; a failed attempt closes its stream with
   * model_stream_end {finishReason:'error'} so every attempt keeps a
   * start → end pairing.
   */
  private async callModel(envelope: RequestEnvelope, turnId: string, step: number): Promise<ChatResponse> {
    const maxRetries = this.deps.llmRetry?.maxRetries ?? 5;
    const request: ChatRequest = {
      model: envelope.model,
      messages: envelope.messages,
      tools: envelope.tools.length > 0 ? envelope.tools : undefined,
      temperature: 0,
      // task 050: forward the turn's AbortSignal so provider fetches abort promptly
      signal: this.interruptCtl.signal ?? undefined,
    };
    // deterministic per (turnId, step); retry attempts of one logical request share it
    const requestId = `req_${turnId}_step${step}`;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // task 050: interruption that landed between attempts stops retrying at once
      if (this.interruptCtl.aborted) throw new TurnInterruptedError();
      try {
        const provider = this.deps.provider;
        if (typeof provider.stream === 'function') {
          return await this.consumeStream(provider.stream(request), request, turnId, step, requestId);
        }
        return await provider.chat(request);
      } catch (err) {
        // task 050: an abort wins over retry — interruption is never retried
        if (this.interruptCtl.aborted) throw new TurnInterruptedError();
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
   * Stream-first branch (task 049): map each typed chunk onto the model_stream
   * vocabulary and accumulate the same ChatResponse shape the chat() path
   * produces. Chunk mapping:
   *  - text_delta             -> append to text, emit model_stream_delta
   *  - tool_call_start/delta/ -> accumulate per tool-call id (arguments
   *    tool_call_end            fragments joined across deltas), emit
   *                              model_stream_delta; the call is finalized
   *                              (parsed) at tool_call_end
   *  - usage                  -> fold into usage (per-field last-wins; wire usage
   *                              frames are cumulative or terminal)
   *  - message_end            -> carry its finishReason into the terminal payload
   * Streaming tool calls may interleave (parallel tool use), so open
   * accumulators are keyed by id and finalized in start order.
   */
  private async consumeStream(
    stream: AsyncIterable<StreamChunk>,
    request: ChatRequest,
    turnId: string,
    step: number,
    requestId: string,
  ): Promise<ChatResponse> {
    const { bus } = this.deps;
    await bus.emit('model_stream_start', { turnId, step, requestId, model: request.model });

    let text = '';
    let reasoning = '';
    const open = new Map<string, { name: string; args: string }>();
    const order: string[] = [];
    const closed = new Set<string>();
    const toolCalls: ChatToolCall[] = [];
    const usage: ChatUsage = { inputTokens: 0, outputTokens: 0 };
    let wireFinish: string | undefined;

    const finalize = (id: string, acc: { name: string; args: string }): void => {
      toolCalls.push({ id, name: acc.name, arguments: parseToolArguments(acc.args) });
      closed.add(id);
    };

    try {
      for await (const chunk of stream) {
        // task 050: boundary check — an interrupt may have landed while the
        // previous chunk was in flight (signal-blind providers stop here at
        // the latest; signal-aware ones abort the fetch and throw out of the
        // iterator, which the catch below also turns into a stop).
        if (this.interruptCtl.aborted) throw new TurnInterruptedError();
        switch (chunk.type) {
          case 'message_start':
            break; // model identity already carried on model_stream_start
          case 'text_delta':
            text += chunk.text;
            await bus.emit('model_stream_delta', { turnId, step, requestId, chunk });
            break;
          case 'reasoning_delta':
            // task 109: thinking 模式思维链增量累计进 reasoningContent（回传 reasoning_content 用）
            reasoning += chunk.text;
            await bus.emit('model_stream_delta', { turnId, step, requestId, chunk });
            break;
          case 'tool_call_start': {
            open.set(chunk.id, { name: chunk.name, args: chunk.arguments });
            order.push(chunk.id);
            await bus.emit('model_stream_delta', { turnId, step, requestId, chunk });
            break;
          }
          case 'tool_call_delta': {
            const acc = open.get(chunk.id);
            if (acc) acc.args += chunk.argumentsDelta;
            await bus.emit('model_stream_delta', { turnId, step, requestId, chunk });
            break;
          }
          case 'tool_call_end': {
            const acc = open.get(chunk.id);
            if (acc && !closed.has(chunk.id)) finalize(chunk.id, acc);
            await bus.emit('model_stream_delta', { turnId, step, requestId, chunk });
            break;
          }
          case 'usage':
            if (chunk.inputTokens !== undefined) usage.inputTokens = chunk.inputTokens;
            if (chunk.outputTokens !== undefined) usage.outputTokens = chunk.outputTokens;
            if (chunk.cacheReadTokens !== undefined) usage.cacheReadTokens = chunk.cacheReadTokens;
            // task 099: pass the ChatUsage contract field through (no new
            // mechanism) — Anthropic reports it on message_start only.
            if (chunk.cacheCreationTokens !== undefined) usage.cacheCreationTokens = chunk.cacheCreationTokens;
            break;
          case 'message_end':
            if (chunk.finishReason) wireFinish = chunk.finishReason;
            break;
        }
      }
    } catch (err) {
      // attempt-level pairing: close the stream (finishReason 'error'), then let
      // the retry wrapper in callModel decide (interrupt ⇒ no retry) or rethrow
      await bus.emit('model_stream_end', {
        turnId,
        step,
        requestId,
        finishReason: 'error',
        text,
        toolCalls,
        usage,
      });
      throw err;
    }

    // Truncated stream: finalize any tool call that never saw tool_call_end.
    for (const id of order) {
      const acc = open.get(id);
      if (acc && !closed.has(id)) finalize(id, acc);
    }

    const finishReason: ChatFinishReason = normalizeFinishReason(wireFinish, toolCalls.length > 0);
    await bus.emit('model_stream_end', {
      turnId,
      step,
      requestId,
      finishReason,
      text,
      toolCalls,
      usage,
    });
    return { content: text, toolCalls, finishReason, usage, reasoningContent: reasoning.length > 0 ? reasoning : undefined };
  }

  /**
   * Dispatch one tool call through the full pipeline:
   * tool/call (B04) → BeforeTool (A12) waterfall → PolicyDecision (A13) + audit
   * → executor (runTool with pre-execute recheck) → AfterTool (A14) → tool/result (B05).
   * Denial breaker: same intent denied ≥3 terminates the turn path — counted at
   * every DENIED 收口处 (pre-execute gate deny, approval fallback, and the
   * tool-layer `errorClass:'DENIED'` result), once per refusing result.
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

    // A12 BeforeTool (waterfall): policy engine + sandbox parse are listeners.
    // BRIEF-决策点 fail-open：本点是**安全门禁点**（Tool Interceptor 四件套的挂载点，策略以监听器
    // 参与拦截），因此显式声明 'fail-closed'：监听器抛错会被铸成 ref/reason 带
    // `listener-error:<listenerName>` 的 deny（并短路余下监听器），由下面的 deny 分支落
    // audit/denial（stage 'hook'）+ policy_decision + handler_error —— 绝不静默放行。
    // 旧语义（catch → continue）会让 current 停在 'defer'，等于"没有意见"，工具照常执行。
    const gate = await bus.waterfall(
      'before_tool',
      {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        arguments: call.arguments,
      },
      { listenerErrorPolicy: 'fail-closed' },
    );

    if (gate.result.kind === 'deny') {
      // 监听器抛错铸出的 fail-closed 拒绝与"规则命中"在审计上必须可区分：
      // stage 'hook'（监听器/钩子路径，词表既有值）+ ruleRef 带 `listener-error:<listenerName>`。
      const fromListenerError = isListenerErrorRef(gate.result.ref);
      await this.recordDenial(
        call,
        gate.result.reason ?? 'denied',
        gate.result.ref,
        fromListenerError ? 'hook' : 'rule',
      );
      const error: ToolErrorPayload = {
        errorClass: 'DENIED',
        message: gate.result.reason ?? 'Tool call denied by policy',
      };
      await session.appendSync({
        type: 'tool/result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        error,
        meta: {
          denied: true,
          ref: gate.result.ref,
          ...(fromListenerError ? { listenerError: true } : {}),
        },
        surface: true,
      });
      await bus.emit('after_tool', { toolCallId: call.toolCallId, toolName: call.toolName, result: { error } });
      // denial breaker: same intent ≥3 → turn ends
      this.noteDenial(call, denialCounts);
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
      // denial breaker: an approval-unavailable refusal is a DENIED result too —
      // it counts under the same intent key (stage 'approval' audit is unchanged).
      this.noteDenial(call, denialCounts);
      return;
    }

    // allow → execute (executor re-checks policy at pre-execute; tools never
    // trust the caller). The turn signal is forwarded into the tool context and
    // the await is raced against interruption so signal-blind tools cannot
    // stall a stop (task 050).
    let outcome: ToolResultOutcome;
    try {
      outcome = await this.raceToolRun(call);
    } catch (err) {
      if (this.interruptCtl.aborted) {
        // In-flight tool was interrupted: close tool/call → tool/result pairing
        // with an explicit interrupted result, then let the turn end interrupted.
        const interruptedError: ToolErrorPayload = { errorClass: 'TOOL_FAILURE', message: 'interrupted' };
        await session.appendSync({
          type: 'tool/result',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          error: interruptedError,
          meta: { interrupted: true },
          surface: true,
        });
        await bus.emit('after_tool', {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          result: { error: interruptedError },
        });
      }
      throw err;
    }
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
    // denial breaker: a DENIED that came back from the *tool layer* (fs guard
    // `size`/`escape`/`unverifiable`, Skill untrusted, executor pre-execute
    // recheck, registry denied-tool) is the same refused intent as a policy
    // denial and must be bounded the same way — otherwise the model can retry a
    // necessarily-refused call forever, burning steps and tokens. Same key, same
    // counter, same ≥3 threshold. Only `DENIED` counts: every other error class
    // (INVALID_ARGS / TOOL_FAILURE / TIMEOUT / …) stays retryable, unchanged.
    if (outcome.error?.errorClass === 'DENIED') {
      this.noteDenial(call, denialCounts);
    }
  }

  /**
   * Execute one tool call, racing it against a turn interrupt. When the
   * interrupt fires first a TurnInterruptedError is thrown (the caller records
   * an interrupted tool/result and the turn ends kind='interrupted').
   */
  private async raceToolRun(call: ToolCall): Promise<ToolResultOutcome> {
    const signal = this.interruptCtl.signal;
    // already interrupted → never start (possibly long) tool work
    if (signal?.aborted) throw new TurnInterruptedError();
    const run = this.deps.runTool(call, { signal: signal ?? null });
    if (!signal) return run;
    let onAbort: (() => void) | null = null;
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new TurnInterruptedError());
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([run, interrupted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Task 051 — step-boundary steering consumption. Atomically takes every
   * pending steer and persists each as a user-level message record
   * (B01 user/message, source='steer', surface=true) so the next buildContext
   * derives it through the session surface projection (模型可见 ⟺ 已记录).
   * The message shape follows the shared session-record contract: role 'user',
   * raw directive content, msgId per record, seq/ts assigned by the Session.
   */
  private async drainSteers(): Promise<void> {
    const pending = this.steerQueue.drain();
    for (const steer of pending) {
      await this.deps.session.appendSync({
        type: 'user/message',
        msgId: `m_steer_${crypto.randomBytes(4).toString('hex')}`,
        role: 'user',
        content: steer.content,
        source: 'steer',
        surface: true,
      });
    }
  }

  /**
   * 铸出一次拒绝的完整审计链：`audit/denial`（session 记录）+ `policy_decision`（总线事件）。
   * `stage` 用 AuditDenialRecord 的既有词表：'rule' = 规则/策略命中；'hook' = 监听器（hook）
   * 路径（含 BRIEF-决策点 fail-open 的"监听器抛错 ⇒ fail-closed"，ruleRef 为
   * `listener-error:<listenerName>`，与规则命中可机读区分）。
   */
  private async recordDenial(
    call: ToolCall,
    reason: string,
    ref: string | undefined,
    stage: Extract<SessionRecord, { type: 'audit/denial' }>['stage'],
  ): Promise<void> {
    const { session, bus } = this.deps;
    await session.appendSync({
      type: 'audit/denial',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      stage,
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

  /**
   * Denial breaker — one **DENIED** result for the same intent
   * (`toolName:arguments`, JSON-stable) increments one turn-scoped counter; the
   * 3rd such denial throws DenialLimitError (message and timing verbatim
   * unchanged: thrown *after* the 3rd tool/result is appended and after_tool is
   * emitted, so the refusing result is never lost).
   *
   * Scope: the counter tracks **which refusals happened**, not where they came
   * from — a pre-execute policy/hook denial and a tool-layer denial of the same
   * intent are the same refused intent by definition, so they share the key
   * (one intent = one count; a mixed sequence therefore trips on its 3rd denial
   * overall, whichever side refuses).
   *
   * Exactly-once is structural, not bookkeeping: every call site is a terminal
   * exit of one `dispatchToolCall` invocation and they are mutually exclusive —
   * a gate denial/ask returns before `raceToolRun` is ever reached, and the
   * post-execute site is only reachable when the gate allowed. No DENIED path
   * can pass through two of them, so no intent is ever counted twice. The
   * executor's pre-execute `decide` recheck (DENIED with meta.denied) is a
   * *tool-layer* result and therefore lands on the post-execute site only.
   */
  private noteDenial(call: ToolCall, denialCounts: Map<string, number>): void {
    const key = `${call.toolName}:${JSON.stringify(call.arguments)}`;
    const n = (denialCounts.get(key) ?? 0) + 1;
    denialCounts.set(key, n);
    if (n >= 3) {
      throw new DenialLimitError(`same intent denied ${n} times: ${call.toolName}`);
    }
  }
}

export class DenialLimitError extends Error {}
