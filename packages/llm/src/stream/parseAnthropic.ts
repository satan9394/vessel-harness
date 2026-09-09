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
 */
export class AnthropicStreamParser {
  private readonly toolIdByIndex = new Map<number, string>();
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

    // Resolve tool id for events that don't carry one (block index -> id).
    if (ev.type === 'content_block_start') {
      const block = ev.content_block;
      if (block?.type === 'tool_use' && block.id) {
        this.toolIdByIndex.set(ev.index ?? 0, block.id);
      }
    }

    const chunks = parseAnthropicEvent(ev);

    // content_block_stop also fires for TEXT blocks; only a stopped tool_use
    // block (one we captured an id for) should yield tool_call_end.
    const isToolStop = ev.type === 'content_block_stop';
    for (const c of chunks) {
      if (c.type === 'tool_call_delta' || c.type === 'tool_call_end') {
        const real = this.toolIdByIndex.get(ev.index ?? 0);
        if (c.type === 'tool_call_end' && (!isToolStop || real === undefined)) continue;
        out.push(real ? ({ ...c, id: real } as typeof c) : c);
        if (c.type === 'tool_call_end') this.toolIdByIndex.delete(ev.index ?? 0);
      } else {
        out.push(c);
      }
    }

    if (ev.type === 'message_stop') {
      this.ended = true;
    }
    return out;
  }

  finish(): StreamChunk[] {
    if (this.ended) return [];
    this.ended = true;
    return [];
  }
}