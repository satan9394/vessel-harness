/**
 * llm/stream — OpenAI SSE `data:` line parser → StreamChunk[].
 *
 * The OpenAI stream endpoint (`POST {base}/chat/completions?stream=true`) emits
 * newline-delimited SSE frames of the form `data: {json}`, one per assistant
 * increment, terminated by `data: [DONE]`. Each JSON payload shape:
 *
 *   {
 *     model?: string,
 *     choices: [{ delta: { role?, content?, tool_calls? }, finish_reason? }],
 *     usage?,   // may ride on the trailing frame
 *   }
 *
 * Mapping table (task 046):
 *   - role: 'assistant' first frame          -> message_start (with model)
 *   - delta.content                          -> text_delta
 *   - delta.tool_calls[].{id,name} first hit -> tool_call_start
 *   - delta.tool_calls[].function.arguments  -> tool_call_delta
 *   - finish_reason (any) / [DONE]           -> tool_call_end then message_end
 *                                              (the boundary `message_end` CARRIES the
 *                                               normalized finish_reason unless it is
 *                                               `'stop'` — see `openAIFinishReason`)
 *   - top-level usage                        -> usage
 *
 * Tool calls stream across frames: `id` + `name` arrive on the FIRST delta of
 * a call; later deltas of the same index carry only an `arguments` fragment.
 * parseOpenAISSE tracks per-index identity across sequential lines via a
 * persistent `state` object; OpenAISTreamParser wraps that with message_start /
 * tool_call_end / message_end bookkeeping.
 *
 * Wire order is NOT guaranteed (Round 46 fix): gateways/proxies that reorder
 * frames, and some "OpenAI-compatible" implementations, emit `index` + an
 * `arguments` fragment BEFORE the `id`/`name` that identify the call. The
 * parser therefore buffers argument fragments per index (`pendingArgsByIndex`)
 * until the identity is complete and replays them, in wire order, as the
 * `arguments` of the eventual `tool_call_start`. Nothing is discarded on the
 * floor: if the identity never completes, `flushPendingToolCalls()` surfaces
 * the buffered fragments as an explicit (placeholder-id) tool call at the
 * stream boundary instead of dropping them.
 *
 * Round 69 — the OpenAI counterpart of the Anthropic Round 68 fix, under the
 * same policy. A frame that REPEATS a call's `id` (+ `name`) for an index that
 * has ALREADY started is a protocol violation (the canonical wire announces the
 * identity once, on the first delta of the call), and the identity it repeats is
 * not authoritative: the call the consumer holds open is keyed by the START's id
 * (AgentLoop.consumeStream: `open.set(chunk.id, …)` / `open.get(chunk.id)`).
 * Registering the repeat's id used to OVERWRITE `state.idByIndex`, and both
 * remaining halves of that call's life are addressed FROM that map — the
 * continuation `tool_call_delta`s here, and the `tool_call_end`s the driver
 * emits in `closeToolCalls` — so the whole tail was re-addressed to an id nobody
 * had opened a call for: the repeat's fragment (and every fragment after it)
 * landed in no accumulator, and the ORIGINAL id never received its own
 * `tool_call_end` (only AgentLoop's stream-boundary fallback closed it). The
 * first start now FREEZES the identity; see `identityFrozen` below.
 */

// BRIEF「截断信号到不了 loop」: the normalization target type is owned by @vessel/shared
// (types.ts re-exports StreamChunk from there — same package, no new dependency).
import type { ChatFinishReason } from '@vessel/shared';
import type { StreamChunk } from './types.js';

/** A single streaming choice's delta fragment (subset of the wire shape). */
export interface OpenAIDelta {
  content?: string | null;
  /** DeepSeek 系 thinking 模式思维链增量（task 109）。 */
  reasoning_content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }[];
  role?: string;
}

export interface OpenAIStreamChunk {
  model?: string;
  choices?: { delta?: OpenAIDelta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

export interface OpenAIToolState {
  /**
   * tool index -> id (set on the first delta of a call, reused by continuations).
   *
   * Round 69: once the call has STARTED (i.e. `startedIndexes.has(index)`, which
   * is exactly "the `tool_call_start` carrying this id has been emitted") this
   * entry is FROZEN — a later frame repeating the call's `id` may not rewrite it.
   * Every chunk of the call's remaining life is addressed from this map (the
   * continuation `tool_call_delta`s in `parseOpenAIStreamChunk` and the
   * `tool_call_end`s in `OpenAIStreamParser.closeToolCalls`), so rewriting it
   * re-addresses the tail to an id no consumer ever opened.
   */
  idByIndex: Map<number, string>;
  /** tool index -> name (only present on the first delta of a call). */
  nameByIndex: Map<number, string>;
  /**
   * Round 46: tool index -> arguments fragments that arrived BEFORE the call's
   * identity (id + name) was complete, held so they can be replayed on the
   * eventual `tool_call_start` instead of being dropped. Fragments are stored
   * concatenated in wire order; an entry only exists once a non-empty fragment
   * has arrived.
   */
  pendingArgsByIndex: Map<number, string>;
  /**
   * Round 46: tool indices whose `tool_call_start` has already been emitted.
   * Once started, every later fragment is a continuation delta — a frame that
   * redundantly repeats id/name must NOT re-emit `tool_call_start`, because the
   * consumer would overwrite the accumulator holding the earlier arguments.
   *
   * Round 69: this is also the FREEZE test for identity. A frame arriving for a
   * started index may neither re-emit the start (Round 46) nor rewrite the
   * id/name that start registered (Round 69) — the registered values are the
   * only ones any consumer-side accumulator is keyed by. Deliberately NOT "any
   * identity was registered": an index whose identity is still incomplete has no
   * consumer-side call yet, and COMPLETING it from a later frame is the Round 46
   * identity-late recovery (see the id-first / name-later cases in
   * parseOpenAI.test.ts).
   */
  startedIndexes: Set<number>;
  /**
   * BRIEF「截断信号到不了 loop」（流式）: the LAST non-empty wire `finish_reason`
   * seen on this stream, carried across frames for the same reason tool-call
   * identity is — OpenAI puts `finish_reason` on the LAST content delta of the
   * stream (`null` on every earlier frame), while the frame that CLOSES the
   * stream (`data: [DONE]`, or EOF) carries no choice of its own. The driver
   * therefore reads it back here when it emits the boundary `message_end`
   * (`OpenAIStreamParser.messageEnd`). Raw wire value; normalized on emission
   * by `openAIFinishReason` so chat() and stream() share one mapping table.
   */
  finishReason?: string;
}

export function createOpenAIToolState(): OpenAIToolState {
  return {
    idByIndex: new Map(),
    nameByIndex: new Map(),
    pendingArgsByIndex: new Map(),
    startedIndexes: new Set(),
  };
}

/**
 * Map one `data:` payload (JSON already stripped of the `data:` prefix) to
 * StreamChunk[]. Pass one `state` instance across the sequential lines of a
 * single stream so tool-call identity carries forward. Returns an empty array
 * for a bare `[DONE]` line or malformed JSON.
 *
 * Round 46: this function never discards an arguments fragment, but fragments
 * that arrive before their call's identity are held in `state` and only surface
 * once the identity is known — so a caller that drives the stream itself MUST
 * call flushPendingToolCalls(state) at the end (OpenAIStreamParser does it on
 * `[DONE]` / finish()).
 */
export function parseOpenAIStreamChunk(
  payload: unknown,
  state: OpenAIToolState = createOpenAIToolState(),
): StreamChunk[] {
  if (payload === '[DONE]' || payload == null) return [];

  let body: OpenAIStreamChunk;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.length === 0 || trimmed === '[DONE]') return [];
    try {
      body = JSON.parse(trimmed) as OpenAIStreamChunk;
    } catch {
      return [];
    }
  } else {
    body = payload as OpenAIStreamChunk;
  }
  if (typeof body !== 'object' || body === null) return [];

  const chunks: StreamChunk[] = [];
  const choice = body.choices?.[0];
  const delta = choice?.delta;

  // BRIEF「截断信号到不了 loop」（流式）: OpenAI 把 `finish_reason` 放在该流**最后一个**
  // content delta 上（此前每一帧都是 `null`），而真正收口的那一帧（`data: [DONE]` / EOF）
  // 自己没有 choice。所以这里把它记进跨帧 state（与 tool-call identity 同一套"逐行携带"
  // 机制），由驱动在边界 `message_end` 上取出 —— 与 parseAnthropic 的
  // `message_delta{stop_reason} -> message_end{finishReason}` 同形。
  // 只记非空字符串：`null` / 缺失 / `''` 都不覆盖已记下的值（usage 尾帧常带 `choices: []`）。
  const wireFinishReason = choice?.finish_reason;
  if (typeof wireFinishReason === 'string' && wireFinishReason.length > 0) {
    state.finishReason = wireFinishReason;
  }

  // message_start is emitted by OpenAIStreamParser.feed() (the per-stream
  // driver); here we only map content fragments so the two never double-emit.

  // task 109: DeepSeek 系 thinking 模式思维链走 `delta.reasoning_content` 增量
  // （wire 顺序：思维链先于正文，故 reasoning_delta 先于 text_delta 产出）
  if (delta?.reasoning_content != null && delta.reasoning_content !== '') {
    chunks.push({ type: 'reasoning_delta', text: delta.reasoning_content });
  }

  if (delta?.content != null && delta.content !== '') {
    chunks.push({ type: 'text_delta', text: delta.content });
  }

  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const index = tc.index ?? 0;
      const argFragment = tc.function?.arguments;

      // Round 69 — FIRST START FREEZES IDENTITY (the OpenAI counterpart of the
      // Anthropic Round 68 guard in parseAnthropic.ts:503).
      //
      // A repeated identity frame is not cosmetic: `idByIndex` is the ADDRESS
      // map for the whole remainder of the call — the continuation
      // `tool_call_delta`s below and the `tool_call_end`s `closeToolCalls`
      // derives from this very map. Overwriting it therefore re-addressed the
      // tail to an id the consumer had never opened a call for
      // (AgentLoop.consumeStream keys its accumulator by the START's id:
      // `open.get(chunk.id)`), so the repeat's fragment landed nowhere AND the
      // original id received no end of its own (the stream carried an orphan
      // `tool_call_end` instead). Freezing makes the different-id repeat behave
      // exactly like the same-id repeat Round 46 had already made safe.
      //
      // The guard is `startedIndexes`, deliberately NOT "any identity was
      // registered": OpenAI delivers `id` and `name` on DIFFERENT frames
      // (identity-late), and the start is emitted only once BOTH are known — so
      // a started index is exactly "a consumer-side accumulator is open under
      // `idByIndex.get(index)`". An index that has not started has no call to
      // address yet, and completing its identity from a later frame is the
      // Round 46 recovery; freezing it here would turn that recovery back into a
      // placeholder-id (`tc_<index>`) flush.
      const identityFrozen = state.startedIndexes.has(index);
      if (tc.id && !identityFrozen) state.idByIndex.set(index, tc.id);
      if (tc.function?.name && !identityFrozen) state.nameByIndex.set(index, tc.function.name);

      const callName = state.nameByIndex.get(index);
      const callId = state.idByIndex.get(index) ?? `tc_${index}`;

      if (state.startedIndexes.has(index)) {
        // Already started: every later fragment is a continuation, even when the
        // frame redundantly repeats id/name. Re-emitting tool_call_start here
        // (the pre-Round-46 behavior) made consumers that key by id overwrite
        // the accumulator they already held — silently losing the earlier args.
        // `callId` above is the REGISTERED (frozen) id, never this frame's `tc.id`
        // — that is what makes the repeat's fragment land in the open accumulator.
        if (argFragment) {
          chunks.push({ type: 'tool_call_delta', id: callId, argumentsDelta: argFragment });
        }
        continue;
      }

      // Round 46: identity may arrive AFTER the first arguments fragment
      // (reordering gateway / "OpenAI-compatible" implementation). Buffer the
      // fragment by index and replay it below — the old code `continue`d here
      // and dropped the fragment forever.
      if (argFragment) {
        state.pendingArgsByIndex.set(index, (state.pendingArgsByIndex.get(index) ?? '') + argFragment);
      }

      if (callName && state.idByIndex.has(index)) {
        // First delta of a tool call that now carries both id and name.
        // Normal wire order ⇒ the buffer is empty and this is byte-identical to
        // the pre-Round-46 output; out-of-order ⇒ the buffered fragments are
        // replayed (in arrival order) ahead of this delta's own fragment.
        chunks.push({
          type: 'tool_call_start',
          id: callId,
          name: callName,
          arguments: state.pendingArgsByIndex.get(index) ?? '',
        });
        state.pendingArgsByIndex.delete(index);
        state.startedIndexes.add(index);
        continue;
      }

      // Identity still incomplete (id-only, name-only, or neither): nothing is
      // emitted yet AND nothing is discarded — the buffered fragments stay in
      // `pendingArgsByIndex` and are surfaced by flushPendingToolCalls() at the
      // stream boundary (never silently dropped).
    }
  }

  if (body.usage) {
    chunks.push({
      type: 'usage',
      inputTokens: body.usage.prompt_tokens,
      outputTokens: body.usage.completion_tokens,
      cacheReadTokens: body.usage.prompt_tokens_details?.cached_tokens,
    });
  }

  return chunks;
}

/**
 * Round 46: surface every tool call whose identity never completed.
 *
 * `parseOpenAIStreamChunk` buffers argument fragments that arrive before the
 * call's `id`/`name`; when the identity finally arrives they are replayed on the
 * `tool_call_start`. If it never arrives (the stream ends first, or the call is
 * closed by a boundary), the fragments would otherwise be lost — so callers MUST
 * invoke this at the end of a stream (OpenAIStreamParser does it for `[DONE]`
 * and `finish()`).
 *
 * Policy for the never-identified case — explicit, never silent:
 *   - one `tool_call_start` per pending index, with the placeholder id
 *     `tc_<index>` (the same placeholder the continuation path already uses),
 *     the buffered arguments, and the call name if it was seen (`''` otherwise);
 *   - immediately followed by `tool_call_end` for that id.
 * An empty name is deliberate: it is not a resolvable tool name, so the
 * downstream registry answers with an explicit machine-readable
 * `INVALID_ARGS: unknown tool: …` instead of the call vanishing. The flushed
 * entries are removed from `state` so the driver's `tool_call_end` sweep does
 * not emit a second end for the same id.
 */
export function flushPendingToolCalls(state: OpenAIToolState): StreamChunk[] {
  const out: StreamChunk[] = [];
  const unstarted = new Set<number>([
    ...state.pendingArgsByIndex.keys(),
    ...state.idByIndex.keys(),
    ...state.nameByIndex.keys(),
  ]);
  for (const index of [...unstarted].filter((i) => !state.startedIndexes.has(i)).sort((a, b) => a - b)) {
    const callName = state.nameByIndex.get(index);
    const callId = state.idByIndex.get(index) ?? `tc_${index}`;
    out.push({
      type: 'tool_call_start',
      id: callId,
      name: callName ?? '',
      arguments: state.pendingArgsByIndex.get(index) ?? '',
    });
    out.push({ type: 'tool_call_end', id: callId });
    state.pendingArgsByIndex.delete(index);
    state.idByIndex.delete(index);
    state.nameByIndex.delete(index);
  }
  return out;
}

/**
 * Turn a raw SSE transport line into the value after the `data:` field, or
 * `null` for lines that carry no data payload (blank lines, comments, keep-alives).
 */
export function openAISSELineData(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith(':')) return null;
  const fieldEnd = line.indexOf(':');
  if (fieldEnd === -1) return null;
  const field = line.slice(0, fieldEnd).trim();
  if (field !== 'data') return null;
  return line.slice(fieldEnd + 1).trim();
}

/**
 * BRIEF「截断信号到不了 loop」修复: OpenAI wire `finish_reason` → 内部 `ChatFinishReason`.
 *
 * 这是**两条路径共用的唯一一份**归一表 —— 非流式 `OpenAICompatibleProvider.chat()`
 * 与本文件流式的边界 `message_end` 都调它，所以 chat()/stream() 对同一个 wire 值
 * 必然给出同一个结果。修复前缺的正是这件事：chat() 把非 stop/tool_calls 的**一切**
 * （含 `'length'`）塌缩成 `'error'`（OpenAICompatibleProvider.ts:179-181），流式则
 * 完全不携带（→ AgentLoop 的 `normalizeFinishReason(undefined, …)` → `'stop'`）。
 *
 * 取值域是 `@vessel/shared` 的四值闭集
 * `ChatFinishReason = 'stop' | 'tool_calls' | 'length' | 'error'`：
 *   `stop`       -> `'stop'`        正常收尾（既有裁决，不变）
 *   `tool_calls` -> `'tool_calls'`  工具调用收尾（既有裁决，不变）
 *   `length`     -> `'length'`      **max_tokens 截断** —— 本卡要送达的信号（改前 'error'）
 *   其它/缺失    -> `'error'`       见下（本卡不改这条既有裁决）
 *
 * 「其它值」的裁决与理由（逐条）：
 *   1. `content_filter`：内容被上游过滤器截掉，**不是**"模型正常说完了"；内部闭集里
 *      没有这个成员，'error' 是唯一诚实的桶（也不放宽成 'stop' ⇒ 不会被报成 success）；
 *   2. `function_call`：OpenAI 已废弃的旧 wire 值，本 provider 只把 `message.tool_calls`
 *      映成 tool_calls；不认识的值一律 fail-loud 到 'error'，不猜成 'tool_calls'；
 *   3. 未知值：同上（宁可报错，也不把不认识的终止原因说成"完成"）；
 *   4. **缺失**（`undefined`/`null`/`''`）：改前也是 'error'，本卡**不动**它 ——
 *      另一张卡正是以"wire 缺失 `finish_reason` 时会被误判"为由拒绝把 wire `'error'`
 *      当截断，所以这里必须保持 'error'，不得借机改成 'stop' 或 'length'。
 *      注意两条路径的"既有值"不同也不得互相污染：**流式**缺失时根本不携带字段
 *      （`OpenAIStreamParser.messageEnd` 只在有值且归一结果非 'stop' 时才挂），
 *      消费者那边仍是既有的 'stop'/'tool_calls'；**非流式**缺失时保持既有的 'error'。
 *      两条路径都不会让"缺失"变成 'length'。
 */
export function openAIFinishReason(wire: string | undefined): ChatFinishReason {
  switch (wire) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_calls';
    case 'length':
      return 'length';
    default:
      return 'error';
  }
}

/**
 * Stateful driver for one OpenAI stream. Feed the raw SSE lines sequentially;
 * it owns message_start / tool_call_end / message_end bookkeeping so callers
 * only deal with content chunks. Finish with `finish()` (or feed `[DONE]`).
 */
export class OpenAIStreamParser {
  private readonly state = createOpenAIToolState();
  private started = false;
  private ended = false;

  /** Feed one raw SSE line (e.g. `data: {...}` / `data: [DONE]` / blank). */
  feed(line: string): StreamChunk[] {
    if (this.ended) return [];
    const out: StreamChunk[] = [];

    if (!this.started) {
      this.started = true;
      out.push({ type: 'message_start' });
    }

    const data = openAISSELineData(line);
    if (data === null) return out;

    if (data === '[DONE]') {
      this.ended = true;
      out.push(...this.closeToolCalls(true));
      out.push(this.messageEnd());
      return out;
    }

    const chunks = parseOpenAIStreamChunk(data, this.state);
    const hasToolChunks = chunks.some((c) => c.type.startsWith('tool_call'));
    if (!hasToolChunks) out.push(...this.closeToolCalls(false));
    out.push(...chunks);
    return out;
  }

  /** Finalize the stream (emits pending tool_call_end + message_end if not ended). */
  finish(): StreamChunk[] {
    if (this.ended) return [];
    this.ended = true;
    return [...this.closeToolCalls(true), this.messageEnd()];
  }

  /**
   * BRIEF「截断信号到不了 loop」（流式）: the boundary `message_end`, carrying the wire
   * `finish_reason` normalized by `openAIFinishReason`.
   *
   * **在哪个 chunk 上带**：OpenAI 的 `finish_reason` 出现在该流**最后一个 content delta**
   * 帧上（由 `parseOpenAIStreamChunk` 记进 `state.finishReason`），而流是被**后一帧**
   * `data: [DONE]`（`feed()`）或 EOF（`finish()`）收口的 —— 收口帧自己没有 choice，
   * 所以信号只能在**边界 message_end 这一处**补挂（与 parseAnthropic.ts:157 的
   * `message_delta{stop_reason} -> message_end{finishReason}` 同形）。
   *
   * 唯一不挂的情况：归一结果是 `'stop'`（或整条流从未出现过 finish_reason）。
   * 依据是可证的**信息等价**——`normalizeFinishReason(undefined, h)` 与
   * `normalizeFinishReason('stop', h)` 在 h=true/false 上都返回同一个值
   * （AgentLoop.ts:86-90），即"不挂"与"挂 'stop'"对消费者**完全不可区分**；
   * 而不挂还保住了两条既有冻结用例钉死的 `{type:'message_end'}` 字面形状
   * （parseOpenAI.test.ts:159 / streamProvider.test.ts:57 的夹具都带
   * `finish_reason:'stop'`）——本卡不得回归既有测试。其余值一律携带。
   */
  private messageEnd(): StreamChunk {
    const wire = this.state.finishReason;
    if (wire === undefined) return { type: 'message_end' };
    const finishReason = openAIFinishReason(wire);
    if (finishReason === 'stop') return { type: 'message_end' };
    return { type: 'message_end', finishReason };
  }

  /**
   * Close the tool calls that have already STARTED (emitting their
   * `tool_call_end`); `terminal` additionally flushes fragments whose identity
   * never completed (see flushPendingToolCalls).
   *
   * Round 46: a non-terminal boundary MUST NOT touch state belonging to an
   * identity that has not completed yet. `feed()` reaches this method on every
   * frame that yields no tool chunk — and the very first frame of an
   * arguments-first stream is exactly such a frame — so wiping
   * `pendingArgsByIndex` here (pre-fix) dropped the buffered fragment on the
   * real provider path even though the state machine had just saved it. The same
   * argument applies to an id-only / name-only index: its identity may still be
   * in flight, so it is left in place instead of being closed and cleared.
   */
  private closeToolCalls(terminal: boolean): StreamChunk[] {
    const out: StreamChunk[] = [];

    // Terminal boundary: surface every fragment whose identity never completed.
    if (terminal) out.push(...flushPendingToolCalls(this.state));

    // Emit ends for the started calls, in the historical order (idByIndex
    // insertion order, de-duplicated by id) so normal streams stay byte-identical.
    //
    // Round 69: the id here is the REGISTERED one (`idByIndex`, frozen at the
    // call's first start by `identityFrozen` in parseOpenAIStreamChunk) — never
    // the id some later frame happened to repeat. That is the other half of the
    // freeze: without it a different-id repeat still produced an orphan end.
    const closedIds = new Set<string>();
    for (const [index, id] of this.state.idByIndex) {
      if (this.state.startedIndexes.has(index)) closedIds.add(id);
    }
    for (const id of closedIds) out.push({ type: 'tool_call_end', id });

    // Forget only what was just closed. Everything still waiting for its
    // identity — id-only, name-only, fragments-only — stays in state;
    // `pendingArgsByIndex` is emptied ONLY by the identity replay in
    // parseOpenAIStreamChunk or by the explicit flush above, never here.
    for (const index of this.state.startedIndexes) {
      this.state.idByIndex.delete(index);
      this.state.nameByIndex.delete(index);
    }
    this.state.startedIndexes.clear();
    return out;
  }
}