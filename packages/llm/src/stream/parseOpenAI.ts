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
}

export function createOpenAIToolState(): OpenAIToolState {
  return { idByIndex: new Map(), nameByIndex: new Map() };
}

/**
 * Map one `data:` payload (JSON already stripped of the `data:` prefix) to
 * StreamChunk[]. Pass one `state` instance across the sequential lines of a
 * single stream so tool-call identity carries forward. Returns an empty array
 * for a bare `[DONE]` line or malformed JSON.
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

      if (!state.nameByIndex.has(index) && !state.idByIndex.has(index)) {
        // no identity captured for this index yet — nothing meaningful to emit.
        continue;
      }

      if (callName && tc.function?.name === callName && state.idByIndex.has(index)) {
        // First delta of a tool call that now carries both id and name.
        chunks.push({ type: 'tool_call_start', id: callId, name: callName, arguments: tc.function?.arguments ?? '' });
      } else if (tc.function?.name) {
        // First delta of a tool call where only name is known (id may be absent).
        chunks.push({ type: 'tool_call_start', id: callId, name: tc.function.name, arguments: argFragment ?? '' });
        state.nameByIndex.set(index, tc.function.name);
      } else if (argFragment) {
        // Continuation arguments fragment for a call already started.
        chunks.push({ type: 'tool_call_delta', id: callId, argumentsDelta: argFragment });
      }
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
      out.push(...this.closeToolCalls());
      out.push({ type: 'message_end' });
      return out;
    }

    const chunks = parseOpenAIStreamChunk(data, this.state);
    const hasToolChunks = chunks.some((c) => c.type.startsWith('tool_call'));
    if (!hasToolChunks) out.push(...this.closeToolCalls());
    out.push(...chunks);
    return out;
  }

  /** Finalize the stream (emits pending tool_call_end + message_end if not ended). */
  finish(): StreamChunk[] {
    if (this.ended) return [];
    this.ended = true;
    return [...this.closeToolCalls(), { type: 'message_end' }];
  }

  private closeToolCalls(): StreamChunk[] {
    const out: StreamChunk[] = [];
    for (const id of new Set(this.state.idByIndex.values())) {
      out.push({ type: 'tool_call_end', id });
    }
    this.state.idByIndex.clear();
    this.state.nameByIndex.clear();
    return out;
  }
}