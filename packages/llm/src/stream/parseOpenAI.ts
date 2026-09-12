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
 *   - finish_reason (tool_calls) / [DONE]    -> tool_call_end then message_end
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
 */

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
  /** tool index -> id (set on the first delta of a call, reused by continuations). */
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
   */
  startedIndexes: Set<number>;
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

      if (tc.id) state.idByIndex.set(index, tc.id);
      if (tc.function?.name) state.nameByIndex.set(index, tc.function.name);

      const callName = state.nameByIndex.get(index);
      const callId = state.idByIndex.get(index) ?? `tc_${index}`;

      if (state.startedIndexes.has(index)) {
        // Already started: every later fragment is a continuation, even when the
        // frame redundantly repeats id/name. Re-emitting tool_call_start here
        // (the pre-Round-46 behavior) made consumers that key by id overwrite
        // the accumulator they already held — silently losing the earlier args.
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
      out.push({ type: 'message_end' });
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
    return [...this.closeToolCalls(true), { type: 'message_end' }];
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