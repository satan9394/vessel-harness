/**
 * llm/stream — Anthropic SSE event parser → StreamChunk[].
 *
 * The Anthropic Messages API streaming (`POST {base}/v1/messages?stream=true`)
 * emits SSE frames with an `event:` name and a `data: {json}` payload carrying
 * a discriminator `type`:
 *
 *   event: message_start        data: {"type":"message_start","message":{model,usage}}
 *   event: content_block_start  data: {"type":"content_block_start","index":i,"content_block":{type,text|id,name}}
 *   event: content_block_delta  data: {"type":"content_block_delta","index":i,"delta":{type:"text_delta"|"input_json_delta",...}}
 *   event: content_block_stop   data: {"type":"content_block_stop","index":i}
 *   event: message_delta        data: {"type":"message_delta","delta":{"stop_reason"}, "usage":{output_tokens}}
 *   event: message_stop         data: {"type":"message_stop"}
 *
 * Mapping table (task 046):
 *   - message_start                      -> message_start (model)
 *   - content_block_delta text_delta     -> text_delta
 *   - content_block_start tool_use       -> tool_call_start (id, name, partial input)
 *   - content_block_delta input_json     -> tool_call_delta (argumentsDelta)
 *   - content_block_stop (tool_use)      -> tool_call_end
 *   - message_delta                      -> usage (+ carries stop_reason)
 *   - message_stop                       -> message_end
 *   - content_block_stop of a tool_use block whose content_block_start carried
 *     no id/name                         -> explicit tool_call_start (placeholder
 *                                            identity) + tool_call_end
 *   - EOF without message_stop (finish()) -> open calls' tool_call_end, plus the
 *                                            placeholder flush above, plus
 *                                            message_end
 */

import type { StreamChunk } from './types.js';

export interface AnthropicEventData {
  type?: string;
  index?: number;
  model?: string;
  content_block?: { type?: string; text?: string; id?: string; name?: string; input?: unknown };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  /** The `event:` name from the transport line (may be absent when parsing pure data payloads). */
  event?: string;
}

/** Map one Anthropic `data:` payload (JSON stripped of `data:`) to StreamChunk[]. */
export function parseAnthropicEvent(payload: unknown): StreamChunk[] {
  if (payload == null) return [];
  let ev: AnthropicEventData;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.length === 0) return [];
    try {
      ev = JSON.parse(trimmed) as AnthropicEventData;
    } catch {
      return [];
    }
  } else {
    ev = payload as AnthropicEventData;
  }
  if (typeof ev !== 'object' || ev === null) return [];

  const chunks: StreamChunk[] = [];
  switch (ev.type) {
    case 'message_start': {
      const model = ev.model ?? ev.message?.model;
      chunks.push({ type: 'message_start', model });
      const usage = ev.message?.usage ?? ev.usage;
      if (usage) chunks.push(anthropicUsageChunk(usage));
      break;
    }
    case 'content_block_start': {
      const block = ev.content_block;
      if (block?.type === 'tool_use' && block.id && block.name) {
        chunks.push({
          type: 'tool_call_start',
          id: block.id,
          name: block.name,
          arguments: block.input == null ? '' : JSON.stringify(block.input),
        });
      }
      break;
    }
    case 'content_block_delta': {
      const d = ev.delta;
      if (d?.type === 'text_delta' && d.text != null) {
        chunks.push({ type: 'text_delta', text: d.text });
      } else if (d?.type === 'input_json_delta' && d.partial_json != null) {
        chunks.push({ type: 'tool_call_delta', id: toolIdPlaceholder, argumentsDelta: d.partial_json });
      }
      break;
    }
    case 'content_block_stop': {
      chunks.push({ type: 'tool_call_end', id: toolIdPlaceholder });
      break;
    }
    case 'message_delta': {
      if (ev.usage) chunks.push(anthropicUsageChunk(ev.usage));
      if (ev.delta?.stop_reason) {
        chunks.push({ type: 'message_end', finishReason: anthropicFinishReason(ev.delta.stop_reason) });
      }
      break;
    }
    case 'message_stop': {
      chunks.push({ type: 'message_end' });
      break;
    }
    default:
      break;
  }
  return chunks;
}

/**
 * Placeholder id for Anthropic tool_call_delta / tool_call_end: the streaming
 * input_json_delta and content_block_stop frames do NOT carry the tool call id
 * (Anthropic only names it once, in content_block_start). The parser tracks
 * block identity via the `index`; consumers that need a concrete id should map
 * the block index → id themselves (AgentLoop wiring is task 049).
 */
export const toolIdPlaceholder = 'anthropic-tool';

/** Rewrite for inputs whose id is known from the parser's per-index tracking. */
export function anthropicUsageChunk(
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
): Extract<StreamChunk, { type: 'usage' }> {
  return {
    type: 'usage',
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    // task 099: Anthropic reports cache writes only on message_start (the
    // message_delta frame carries output_tokens alone), so this stays
    // undefined there — the consumer folds per-field last-wins and an
    // undefined field never clobbers the earlier value.
    cacheCreationTokens: usage.cache_creation_input_tokens,
  };
}

export function anthropicFinishReason(stopReason: string): string {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    default:
      return stopReason;
  }
}

/** Extract the JSON payload after an SSE `data:` field from a transport line. */
export function anthropicSSELineData(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith(':')) return null;
  const fieldEnd = line.indexOf(':');
  if (fieldEnd === -1) return null;
  const field = line.slice(0, fieldEnd).trim();
  if (field !== 'data') return null;
  return line.slice(fieldEnd + 1).trim();
}

/**
 * Stateful driver for one Anthropic stream. Feeds the raw SSE lines (both the
 * `event:` and `data:` frames) and collects StreamChunk[]. Tracks the tool-use
 * block by content index so content_block_delta/stop can carry the real id.
 *
 * Round 52 — the two Anthropic counterparts of the Round 46 OpenAI fix in
 * parseOpenAI.ts, under the same policy: never drop data on the floor.
 *   1. A `tool_use` block whose `content_block_start` carries no `id`/`name`
 *      produced NO `tool_call_start`, while its `input_json_delta` frames kept
 *      producing `tool_call_delta`. Consumers key their argument accumulator by
 *      the id of the start chunk (AgentLoop.consumeStream: `open.get(chunk.id)`,
 *      appending only `if (acc)`), so every fragment was silently discarded.
 *      Identity and fragments are now tracked per block index
 *      (`pendingArgsByIndex`), and a call whose identity never completes is
 *      surfaced EXPLICITLY at its block boundary (and at the stream boundary)
 *      instead of vanishing.
 *   2. `finish()` returned `[]` for a truncated stream (EOF without
 *      `message_stop`): no `message_end`, and no `tool_call_end` for a block
 *      that was still open. It now runs the same terminal boundary as the
 *      OpenAI driver: flush the never-identified calls, close the calls that
 *      did start, then emit `message_end`.
 */
export class AnthropicStreamParser {
  /** block index -> tool_use id (only content_block_start carries it). */
  private readonly toolIdByIndex = new Map<number, string>();
  /** block index -> tool_use name (only content_block_start carries it). */
  private readonly toolNameByIndex = new Map<number, string>();
  /**
   * block index -> `JSON.stringify(content_block_start.input)`: the seed the
   * consumer's accumulator starts from (Anthropic appends the input_json_delta
   * fragments to it).
   */
  private readonly toolInputJsonByIndex = new Map<number, string>();
  /**
   * Round 52: block index -> `input_json_delta` fragments that arrived while the
   * block had not started (no complete identity), held in wire order so the
   * eventual start can replay them — or so the boundary flush can surface them
   * explicitly. An entry only exists once a fragment has arrived.
   */
  private readonly pendingArgsByIndex = new Map<number, string>();
  /**
   * Round 52: block indexes whose `tool_call_start` has been emitted. Only a
   * block in here has a consumer-side accumulator a `tool_call_delta` can still
   * land in.
   */
  private readonly startedIndexes = new Set<number>();
  /** Round 52: block indexes seen as a tool_use block (started or not). */
  private readonly toolIndexes = new Set<number>();
  private started = false;
  private ended = false;

  feed(line: string): StreamChunk[] {
    if (this.ended) return [];
    const out: StreamChunk[] = [];

    // The `data:` line carries the payload; the `event:` line is descriptive.
    const data = anthropicSSELineData(line);
    if (data === null) return out;

    let ev: AnthropicEventData;
    try {
      ev = JSON.parse(data) as AnthropicEventData;
    } catch {
      return out;
    }
    if (typeof ev !== 'object' || ev === null) return out;

    if (!this.started && ev.type === 'message_start') this.started = true;

    const index = ev.index ?? 0;

    // Round 52: content_block_start is the ONLY frame that carries a tool-use
    // block's id/name, so remember whatever it announced — even partially. A
    // block that never completes its identity is still surfaced below.
    if (ev.type === 'content_block_start') {
      const block = ev.content_block;
      if (block?.type === 'tool_use') {
        this.toolIndexes.add(index);
        if (block.id) this.toolIdByIndex.set(index, block.id);
        if (block.name) this.toolNameByIndex.set(index, block.name);
        if (block.input != null) this.toolInputJsonByIndex.set(index, JSON.stringify(block.input));
      }
    }

    // message_stop is the terminal boundary — the Anthropic counterpart of the
    // OpenAI driver's `[DONE]` handler: close whatever is still open BEFORE the
    // message_end chunk. On the canonical wire every block has already been
    // stopped here, so this sweep is empty and the output is unchanged.
    if (ev.type === 'message_stop') {
      out.push(...this.closeOpenToolCalls());
      this.ended = true;
    }

    // A tool_use block that never started (identity incomplete) is surfaced at
    // its own boundary, ahead of the generic mapping below: the mapped
    // tool_call_end of that content_block_stop must not become a bare end for a
    // call the consumer never opened.
    if (ev.type === 'content_block_stop' && this.isUnstartedToolBlock(index)) {
      out.push(...this.flushToolBlock(index));
    }

    const chunks = parseAnthropicEvent(ev);

    // content_block_stop also fires for TEXT blocks; only a stop of a block we
    // actually started yields tool_call_end (deliberate rule, unchanged).
    const isToolStop = ev.type === 'content_block_stop';
    for (const c of chunks) {
      if (c.type === 'tool_call_start') {
        // Identity complete: fragments that arrived before it (identity-late
        // wire order) are replayed as part of the start's arguments, in the
        // order Anthropic defines them (`input` first, then the fragments). The
        // canonical order leaves the buffer empty ⇒ byte-identical output.
        const pending = this.pendingArgsByIndex.get(index);
        if (pending !== undefined) {
          c.arguments += pending;
          this.pendingArgsByIndex.delete(index);
        }
        this.startedIndexes.add(index);
        out.push(c);
        continue;
      }

      if (c.type === 'tool_call_delta') {
        if (!this.startedIndexes.has(index)) {
          // No start has been emitted for this block, so a delta would be
          // dropped by every consumer that keys its accumulator by the start's
          // id (AgentLoop.consumeStream does exactly that). Hold the fragment —
          // content_block_stop / finish() surfaces it explicitly.
          this.pendingArgsByIndex.set(index, (this.pendingArgsByIndex.get(index) ?? '') + c.argumentsDelta);
          continue;
        }
        out.push({ ...c, id: this.toolIdByIndex.get(index) ?? c.id });
        continue;
      }

      if (c.type === 'tool_call_end') {
        if (!isToolStop || !this.startedIndexes.has(index)) continue;
        out.push({ ...c, id: this.toolIdByIndex.get(index) ?? c.id });
        this.forgetToolBlock(index);
        continue;
      }

      out.push(c);
    }

    return out;
  }

  /**
   * Finalize the stream — the OpenAI driver's `finish()` semantics: close the
   * calls that are still open and emit `message_end`, so a truncated connection
   * (EOF with no `message_stop`) ends the stream with the same terminal signals
   * as the OpenAI path instead of returning `[]`.
   */
  finish(): StreamChunk[] {
    if (this.ended) return [];
    this.ended = true;
    return [...this.closeOpenToolCalls(), { type: 'message_end' }];
  }

  /**
   * Round 52 — the terminal boundary, the Anthropic counterpart of the OpenAI
   * driver's `closeToolCalls(true)`:
   *   - every tool_use block whose identity never completed is surfaced
   *     explicitly by flushToolBlock (placeholder call — never dropped);
   *   - every block that DID start but never saw its content_block_stop gets its
   *     tool_call_end.
   * Both in block order, so a stream with several parallel tool blocks stays
   * deterministic.
   */
  private closeOpenToolCalls(): StreamChunk[] {
    const out: StreamChunk[] = [];

    const unstarted = new Set<number>([
      ...this.toolIndexes,
      ...this.pendingArgsByIndex.keys(),
      ...this.toolIdByIndex.keys(),
      ...this.toolNameByIndex.keys(),
    ]);
    for (const index of [...unstarted].filter((i) => !this.startedIndexes.has(i)).sort((a, b) => a - b)) {
      out.push(...this.flushToolBlock(index));
    }

    for (const index of [...this.startedIndexes].sort((a, b) => a - b)) {
      out.push({ type: 'tool_call_end', id: this.toolIdByIndex.get(index) ?? toolIdPlaceholder });
      this.forgetToolBlock(index);
    }
    return out;
  }

  /**
   * Round 52: surface a tool_use block whose identity never completed — the
   * Anthropic counterpart of parseOpenAI's flushPendingToolCalls(). One
   * `tool_call_start` carrying everything the wire delivered (the id if we saw
   * one, else `toolIdPlaceholder`; the name if we saw one, else `''`; the
   * block's `input` seed followed by every buffered fragment in wire order),
   * immediately followed by its `tool_call_end`. An empty name is deliberate: it
   * is not a resolvable tool name, so the registry answers with an explicit
   * machine-readable error instead of the call vanishing.
   */
  private flushToolBlock(index: number): StreamChunk[] {
    const id = this.toolIdByIndex.get(index) ?? toolIdPlaceholder;
    const name = this.toolNameByIndex.get(index) ?? '';
    const seed = this.toolInputJsonByIndex.get(index) ?? '';
    const pending = this.pendingArgsByIndex.get(index) ?? '';
    const out: StreamChunk[] = [
      { type: 'tool_call_start', id, name, arguments: seed + pending },
      { type: 'tool_call_end', id },
    ];
    this.forgetToolBlock(index);
    return out;
  }

  /** Is this block a tool_use block that never emitted a tool_call_start? */
  private isUnstartedToolBlock(index: number): boolean {
    if (this.startedIndexes.has(index)) return false;
    return (
      this.toolIndexes.has(index) ||
      this.pendingArgsByIndex.has(index) ||
      this.toolIdByIndex.has(index) ||
      this.toolNameByIndex.has(index)
    );
  }

  /** Drop every trace of a block that has been closed (or flushed). */
  private forgetToolBlock(index: number): void {
    this.toolIdByIndex.delete(index);
    this.toolNameByIndex.delete(index);
    this.toolInputJsonByIndex.delete(index);
    this.pendingArgsByIndex.delete(index);
    this.startedIndexes.delete(index);
    this.toolIndexes.delete(index);
  }
}