import { describe, it, expect } from 'vitest';
import { parseAnthropicEvent, AnthropicStreamParser, anthropicFinishReason, anthropicToolInputSeed } from './parseAnthropic.js';
import type { StreamChunk } from '@vessel/shared';

describe('parseAnthropicEvent — content_block_delta → text_delta', () => {
  it('maps text_delta to a text chunk', () => {
    const chunks = parseAnthropicEvent(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }));
    expect(chunks).toEqual([{ type: 'text_delta', text: 'Hello' }]);
  });

  it('maps content_block_start tool_use to tool_call_start', () => {
    const chunks = parseAnthropicEvent(
      JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'Read', input: {} } }),
    );
    // Round 53: the canonical wire's empty-object `input` is a placeholder, not
    // an argument seed — it must NOT pre-load the consumer's accumulator (see
    // anthropicToolInputSeed). Pre-fix this literal was '{}'.
    expect(chunks).toEqual([{ type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' }]);
  });

  // Round 53 strengthening of the test above: the empty-object case is not
  // merely "relaxed to ''" — a NON-empty `input` (an implementation that hands
  // the whole argument object over in content_block_start) must still be
  // serialized verbatim, so no wire shape loses its data.
  it('still serializes a non-empty content_block_start input as the seed (compat, Round 53)', () => {
    const chunks = parseAnthropicEvent(
      JSON.stringify({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { path: 'a.txt', limit: 3 } },
      }),
    );
    expect(chunks).toEqual([{ type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '{"path":"a.txt","limit":3}' }]);
  });

  it('maps message_delta usage + stop_reason to usage and message_end', () => {
    const chunks = parseAnthropicEvent(
      JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }),
    );
    expect(chunks).toContainEqual({ type: 'usage', inputTokens: undefined, outputTokens: 9, cacheReadTokens: undefined });
    expect(chunks).toContainEqual({ type: 'message_end', finishReason: 'stop' });
  });

  it('maps message_start to message_start with model', () => {
    const chunks = parseAnthropicEvent(JSON.stringify({ type: 'message_start', model: 'claude-sonnet-4' }));
    expect(chunks).toContainEqual({ type: 'message_start', model: 'claude-sonnet-4' });
  });
});

describe('parseAnthropicEvent — cache write usage (task 099)', () => {
  it('maps message_start message.usage.cache_creation_input_tokens → cacheCreationTokens', () => {
    const chunks = parseAnthropicEvent(
      JSON.stringify({
        type: 'message_start',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 12, cache_creation_input_tokens: 2095, cache_read_input_tokens: 1024 } },
      }),
    );
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 12,
      outputTokens: undefined,
      cacheReadTokens: 1024,
      cacheCreationTokens: 2095,
    });
  });

  it('message_delta without cache fields leaves cacheCreationTokens undefined (per-field merge, no clobber)', () => {
    const chunks = parseAnthropicEvent(
      JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }),
    );
    const usage = chunks.find((c) => c.type === 'usage') as { cacheCreationTokens?: number } | undefined;
    expect(usage).toBeDefined();
    expect(usage!.cacheCreationTokens).toBeUndefined();
  });
});

describe('parseAnthropicEvent — finish reason mapping', () => {
  it('maps anthropic stop reasons to ChatResponse-style values', () => {
    expect(anthropicFinishReason('end_turn')).toBe('stop');
    expect(anthropicFinishReason('tool_use')).toBe('tool_calls');
    expect(anthropicFinishReason('max_tokens')).toBe('length');
    expect(anthropicFinishReason('stop_sequence')).toBe('stop');
  });
});

describe('AnthropicStreamParser — full SSE event stream', () => {
  it('assembles a tool-use exchange into typed chunks with real ids', () => {
    const p = new AnthropicStreamParser();
    const lines = [
      'event: message_start',
      'data: {"type":"message_start","model":"claude-sonnet-4"}',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Reading "}}',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"Read","input":{}}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"a.txt\\"}"}}',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":1}',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}',
      'event: message_stop',
      'data: {"type":"message_stop"}',
    ];
    const chunks: StreamChunk[] = [];
    for (const l of lines) chunks.push(...p.feed(l));

    expect(chunks[0]).toEqual({ type: 'message_start', model: 'claude-sonnet-4' });
    expect(chunks.map((c) => c.type)).toContain('text_delta');
    const startIdx = chunks.findIndex((c) => c.type === 'tool_call_start');
    // Round 53: the block announced `input:{}` — a placeholder ⇒ empty seed.
    expect(chunks[startIdx]).toEqual({ type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' });
    const deltas = chunks.filter((c) => c.type === 'tool_call_delta') as { id: string; argumentsDelta: string }[];
    expect(deltas).toHaveLength(2);
    expect(deltas.every((d) => d.id === 'toolu_01')).toBe(true);
    expect(deltas[0]!.argumentsDelta).toBe('{"path":');
    expect(deltas[1]!.argumentsDelta).toBe('"a.txt"}');
    const end = chunks.find((c) => c.type === 'tool_call_end');
    expect((end as { id: string }).id).toBe('toolu_01');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' });
  });

  it('ignores ping/keepalive frames without data payloads', () => {
    const p = new AnthropicStreamParser();
    const chunks = p.feed(': ping');
    expect(chunks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Round 52 — Anthropic counterparts of the Round 46 OpenAI fix in
// parseOpenAI.ts: an identity-incomplete `tool_use` block, and a truncated
// stream. Both were the same family of silent data loss ("identity incomplete ⇒
// drop it", "stream ends ⇒ emit nothing"), so both follow the same policy: hold
// the fragments per block index, and surface them EXPLICITLY at the boundary.
// ---------------------------------------------------------------------------

const ARG_A = '{"path":"';
const ARG_B = 'a.txt"}';
const FULL_ARGS = '{"path":"a.txt"}';

/** One Anthropic SSE `data:` transport line from a payload object. */
const sse = (payload: Record<string, unknown>): string => `data: ${JSON.stringify(payload)}`;
const TOOL_START = (block: Record<string, unknown>, index = 0): string =>
  sse({ type: 'content_block_start', index, content_block: { type: 'tool_use', ...block } });
const TOOL_DELTA = (partialJson: string, index = 0): string =>
  sse({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partialJson } });
const TOOL_STOP = (index = 0): string => sse({ type: 'content_block_stop', index });
const MSG_STOP = sse({ type: 'message_stop' });

const feedAll = (p: AnthropicStreamParser, lines: string[]): StreamChunk[] => {
  const out: StreamChunk[] = [];
  for (const l of lines) out.push(...p.feed(l));
  return out;
};

/**
 * The consumer accumulation AgentLoop.consumeStream() performs — `open.set` on
 * tool_call_start (keyed by id) and append on tool_call_delta ONLY when an entry
 * for that id exists. Using the real algorithm is what makes the assertions
 * below evidence about what a consumer ends up holding, instead of about our
 * chunk shape alone.
 */
function assembleByConsumer(chunks: StreamChunk[]): Map<string, { name: string; args: string }> {
  const open = new Map<string, { name: string; args: string }>();
  for (const c of chunks) {
    if (c.type === 'tool_call_start') open.set(c.id, { name: c.name, args: c.arguments });
    else if (c.type === 'tool_call_delta') {
      const acc = open.get(c.id);
      if (acc) acc.args += c.argumentsDelta;
    }
  }
  return open;
}

/**
 * AgentLoop.parseToolArguments (AgentLoop.ts:98-108), transcribed verbatim: the
 * turn-final conversion of the accumulated argument string. Its `catch` is the
 * `{ _raw: … }` fallback that made a broken seed visible as a tool with no
 * `path` instead of as an exception.
 */
function parseToolArgumentsLikeAgentLoop(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed === '') return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

// ---------------------------------------------------------------------------
// Round 53 — THE production bug: the canonical Anthropic wire always sends
// `content_block_start.content_block.input = {}` (the real JSON arrives as
// `input_json_delta` fragments), and the parser turned that empty placeholder
// into the SEED of `tool_call_start.arguments`. AgentLoop.consumeStream APPENDS
// the fragments to the seed, so the accumulator held '{}{"path":"a.txt"}' — not
// JSON — and every streaming Anthropic tool call degraded to `{ _raw: … }`.
// `callModel` prefers `stream()` whenever a provider has it, so this was the
// production hot path, not an edge case.
// ---------------------------------------------------------------------------

describe('AnthropicStreamParser — canonical tool_use stream: the argument seed must not be "{}" (Round 53)', () => {
  it('REPRO ③: canonical Anthropic stream ⇒ parseable arguments with path=a.txt (pre-fix: {}{...} ⇒ { _raw })', () => {
    // The reported probe, verbatim:
    //   content_block_start{tool_use,id,name,input:{}} → two input_json_delta
    //   {'{"path":'} + {'"a.txt"}'} → content_block_stop → message_stop
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      sse({ type: 'message_start', model: 'claude-sonnet-4' }),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 1),
      TOOL_DELTA('{"path":', 1),
      TOOL_DELTA('"a.txt"}', 1),
      TOOL_STOP(1),
      MSG_STOP,
    ]);

    // Layer 1 — the parser. `input:{}` is a placeholder, so there is NO seed:
    // pre-fix this chunk was { … arguments: '{}' }.
    expect(chunks.filter((c) => c.type === 'tool_call_start')).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
    ]);

    // Layer 2 — the consumer accumulation AgentLoop.consumeStream performs
    // (open.set on start keyed by id; append only `if (acc)`), via
    // assembleByConsumer above.
    const open = assembleByConsumer(chunks);
    expect([...open.keys()]).toEqual(['toolu_01']);

    // The accumulator's seed is chunks[start].arguments — pre-fix '{}', now ''.
    const appended = '{"path":' + '"a.txt"}';
    const accumulated = String(open.get('toolu_01')?.args);

    expect(accumulated).toBe(appended); // pre-fix: '{}' + appended = '{}{"path":"a.txt"}'
    expect(accumulated.startsWith('{}')).toBe(false); // the exact defect signature
    expect(JSON.parse(accumulated)).toEqual({ path: 'a.txt' }); // pre-fix: throws ⇒ parseFailed

    // Layer 3 — what the tool actually receives: pre-fix this was
    // { _raw: '{}{"path":"a.txt"}' } and `path` was unreachable.
    const toolArguments = parseToolArgumentsLikeAgentLoop(accumulated);
    expect(toolArguments).toEqual({ path: 'a.txt' });
    expect(toolArguments).not.toHaveProperty('_raw');
    expect(toolArguments.path).toBe('a.txt');
  });

  it('the empty-object placeholder is information-free: `input:{}` ≡ absent `input`, both assemble cleanly', () => {
    const assemble = (startBlock: Record<string, unknown>): Map<string, { name: string; args: string }> => {
      const p = new AnthropicStreamParser();
      return assembleByConsumer(
        feedAll(p, [TOOL_START(startBlock, 0), TOOL_DELTA(ARG_A), TOOL_DELTA(ARG_B), TOOL_STOP(0), MSG_STOP]),
      );
    };
    const withPlaceholder = assemble({ id: 'toolu_01', name: 'Read', input: {} });
    const withNothing = assemble({ id: 'toolu_01', name: 'Read' });
    expect(withPlaceholder.get('toolu_01')).toEqual(withNothing.get('toolu_01'));
    expect(parseToolArgumentsLikeAgentLoop(String(withPlaceholder.get('toolu_01')?.args))).toEqual({ path: 'a.txt' });
  });

  it('a NON-empty `input` is still serialized as the seed, so no wire shape loses its data (compat)', () => {
    // The "whole argument object in content_block_start" shape: the seed IS the
    // complete arguments and no delta follows. This must keep working — the fix
    // removes only the information-free `{}`, it does not drop seeds in general.
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: { path: 'a.txt' } }, 0),
      TOOL_STOP(0),
      MSG_STOP,
    ]);
    expect(chunks.filter((c) => c.type === 'tool_call_start')).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '{"path":"a.txt"}' },
    ]);
    const open = assembleByConsumer(chunks);
    expect(parseToolArgumentsLikeAgentLoop(String(open.get('toolu_01')?.args))).toEqual({ path: 'a.txt' });
  });

  it('anthropicToolInputSeed: only own-key-less plain objects are dropped; null/undefined/arrays/primitives unchanged', () => {
    expect(anthropicToolInputSeed(null)).toBe('');
    expect(anthropicToolInputSeed(undefined)).toBe('');
    expect(anthropicToolInputSeed({})).toBe('');
    expect(anthropicToolInputSeed({ path: 'a.txt' })).toBe('{"path":"a.txt"}');
    expect(anthropicToolInputSeed({ limit: 0 })).toBe('{"limit":0}'); // a falsy but real value is kept
    expect(anthropicToolInputSeed([])).toBe('[]'); // arrays keep JSON.stringify semantics
    expect(anthropicToolInputSeed('x')).toBe('"x"');
    expect(anthropicToolInputSeed(0)).toBe('0');
  });
});

describe('AnthropicStreamParser — identity-incomplete tool_use block (Round 52)', () => {
  it('REPRO ①: a tool_use block missing `id` still surfaces its arguments (pre-fix: they vanished)', () => {
    // PRE-FIX trace (pre-Round-52 parser): the `block.id && block.name` guard in
    // parseAnthropicEvent emitted NO tool_call_start, and the driver's
    // toolIdByIndex never learned the block, so
    //   - each input_json_delta frame was emitted as
    //     tool_call_delta(id='anthropic-tool') with no `open` entry to absorb it
    //     (consumeStream appends only `if (acc)`) ⇒ fragments dropped;
    //   - the content_block_stop end was dropped by the `real === undefined`
    //     filter;
    //   - output was [message_end] only and assembleByConsumer(...) was EMPTY:
    //     argsLost = true, no warning of any kind.
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ name: 'Read', input: {} }), // ← no `id`
      TOOL_DELTA(ARG_A),
      TOOL_DELTA(ARG_B),
      TOOL_STOP(),
      MSG_STOP,
    ]);

    // Round 53: the block's own `input:{}` is the canonical empty placeholder,
    // so it contributes NO seed (anthropicToolInputSeed); the fragments alone are
    // the arguments. Pre-fix this literal was `'{}' + FULL_ARGS` — the exact
    // '{}{...}' shape that made the consumer's JSON.parse fail.
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'anthropic-tool', name: 'Read', arguments: FULL_ARGS },
      { type: 'tool_call_end', id: 'anthropic-tool' },
      { type: 'message_end' },
    ]);

    const open = assembleByConsumer(chunks);
    expect([...open.keys()]).toEqual(['anthropic-tool']); // pre-fix: []
    expect(open.get('anthropic-tool')?.name).toBe('Read');
    expect(open.get('anthropic-tool')?.args).toBe(FULL_ARGS);
    // The value the consumer ends up holding must be usable, not just present.
    expect(JSON.parse(String(open.get('anthropic-tool')?.args))).toEqual({ path: 'a.txt' });
  });

  it('the same block without an `input` seed surfaces machine-readable, parseable arguments', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [TOOL_START({ name: 'Read' }), TOOL_DELTA(ARG_A), TOOL_DELTA(ARG_B), TOOL_STOP(), MSG_STOP]);
    const args = assembleByConsumer(chunks).get('anthropic-tool')?.args;
    expect(args).toBe(FULL_ARGS);
    expect(JSON.parse(String(args))).toEqual({ path: 'a.txt' }); // pre-fix: nothing assembled at all
  });

  it('a block missing `name` is surfaced with the real id and an empty name (explicit, not silence)', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [TOOL_START({ id: 'toolu_01', input: {} }), TOOL_DELTA(FULL_ARGS), TOOL_STOP(), MSG_STOP]);
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: '', arguments: FULL_ARGS },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
    // '' is not a resolvable tool name ⇒ the registry answers with an explicit
    // machine-readable `INVALID_ARGS: unknown tool: ` instead of nothing.
    expect(assembleByConsumer(chunks).get('toolu_01')?.name).toBe('');
    // Round 53: and the arguments it does carry are still well-formed.
    expect(JSON.parse(String(assembleByConsumer(chunks).get('toolu_01')?.args))).toEqual({ path: 'a.txt' });
  });

  it('input_json_delta with no content_block_start at all is surfaced at its content_block_stop', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [TOOL_DELTA(ARG_A), TOOL_DELTA(ARG_B), TOOL_STOP(), MSG_STOP]);
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'anthropic-tool', name: '', arguments: FULL_ARGS },
      { type: 'tool_call_end', id: 'anthropic-tool' },
      { type: 'message_end' },
    ]);
  });

  it('fragments buffered before the identity arrives are merged into the eventual tool_call_start.arguments', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ name: 'Read' }), // identity incomplete (no id)
      TOOL_DELTA(ARG_A),
      TOOL_DELTA(ARG_B),
      TOOL_START({ id: 'toolu_01', name: 'Read' }), // identity completes later
      TOOL_STOP(),
      MSG_STOP,
    ]);
    // Pre-fix: the fragments were emitted as start-less deltas (dropped), so the
    // eventual start carried arguments '' ⇒ an empty, unparseable call.
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: FULL_ARGS },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
    const open = assembleByConsumer(chunks);
    expect([...open.keys()]).toEqual(['toolu_01']); // exactly one call, real id
    expect(JSON.parse(String(open.get('toolu_01')?.args))).toEqual({ path: 'a.txt' });
  });
});

describe('AnthropicStreamParser — truncated stream / EOF boundary (Round 52)', () => {
  it("REPRO ②: EOF without message_stop emits the open call's tool_call_end and message_end (pre-fix: [])", () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }), TOOL_DELTA(FULL_ARGS)]);
    // The connection is truncated here: no content_block_stop, no message_stop.
    expect(chunks.map((c) => c.type)).toEqual(['tool_call_start', 'tool_call_delta']);

    // PRE-FIX: finish() returned [] ⇒ the stream ended with neither a
    // tool_call_end for the open block nor a message_end.
    expect(p.finish()).toEqual([{ type: 'tool_call_end', id: 'toolu_01' }, { type: 'message_end' }]);
    // The terminal boundary is idempotent.
    expect(p.finish()).toEqual([]);
  });

  it('EOF with only an identity-less block flushes the buffered fragments explicitly, then message_end', () => {
    const p = new AnthropicStreamParser();
    const before = feedAll(p, [TOOL_START({ name: 'Read' }), TOOL_DELTA(ARG_A), TOOL_DELTA(ARG_B)]);
    // Held in state — not emitted as a start-less delta (which the consumer
    // would drop) and not discarded. Pre-fix this was two bare deltas.
    expect(before).toEqual([]);

    expect(p.finish()).toEqual([
      { type: 'tool_call_start', id: 'anthropic-tool', name: 'Read', arguments: FULL_ARGS },
      { type: 'tool_call_end', id: 'anthropic-tool' },
      { type: 'message_end' },
    ]);
    expect(p.finish()).toEqual([]);
  });

  it('EOF with no tool block at all still closes the stream with message_end', () => {
    const p = new AnthropicStreamParser();
    p.feed(sse({ type: 'message_start', model: 'claude-sonnet-4' }));
    p.feed(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }));
    expect(p.finish()).toEqual([{ type: 'message_end' }]); // pre-fix: []
  });

  it('message_stop is the terminal boundary: a block left open is closed before message_end', () => {
    // The Anthropic counterpart of the OpenAI driver's `[DONE]` handler. On the
    // canonical wire every block is already stopped here, so the sweep is empty.
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [TOOL_START({ id: 'toolu_01', name: 'Read' }), TOOL_DELTA(FULL_ARGS), MSG_STOP]);
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: FULL_ARGS },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
    expect(p.finish()).toEqual([]); // already ended by message_stop
  });
});

describe('AnthropicStreamParser — negative control: the canonical stream is chunk-for-chunk stable (Round 52, exacted Round 53)', () => {
  it('text + complete tool_use sequence is byte-identical except the Round 53 seed, and only the tool block gets an end', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      sse({ type: 'message_start', model: 'claude-sonnet-4' }),
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading ' } }),
      sse({ type: 'content_block_stop', index: 0 }),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 1),
      TOOL_DELTA(ARG_A, 1),
      TOOL_DELTA(ARG_B, 1),
      TOOL_STOP(1),
      sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }),
      MSG_STOP,
    ]);

    expect(chunks).toEqual([
      { type: 'message_start', model: 'claude-sonnet-4' },
      { type: 'text_delta', text: 'Reading ' },
      // Round 53 — THE one literal this fix changes on the canonical path:
      // '{}' -> ''. Every other chunk below is byte-identical to the pre-fix
      // expectation (see the diff-proof test after this one).
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'usage', inputTokens: undefined, outputTokens: 8, cacheReadTokens: undefined, cacheCreationTokens: undefined },
      { type: 'message_end', finishReason: 'tool_calls' },
      { type: 'message_end' },
    ]);

    // The TEXT block's content_block_stop yields NO end (the deliberate rule):
    // exactly one tool_call_end, for the tool block only — i.e. the fix does not
    // "pad" every block with an end.
    expect(chunks.filter((c) => c.type === 'tool_call_end')).toHaveLength(1);

    // Round 53 strengthening: the same canonical sequence, accumulated exactly
    // as AgentLoop.consumeStream does, is now a PARSEABLE call. Pre-fix this
    // value was '{}{"path":"a.txt"}' and JSON.parse threw.
    const open = assembleByConsumer(chunks);
    expect(JSON.parse(String(open.get('toolu_01')?.args))).toEqual({ path: 'a.txt' });
  });

  // Round 53 — the "nothing else moved" evidence demanded by the brief: the
  // canonical wire with `input:{}` and the same wire with `input` absent are now
  // chunk-for-chunk identical, which can only be true if the empty object
  // stopped contributing a seed and nothing else changed with it.
  it('Round 53 diff-proof: `input:{}` ≡ absent `input`, and the canonical sequence differs from pre-fix by that one literal', () => {
    const wire = (startBlock: Record<string, unknown>): StreamChunk[] => {
      const p = new AnthropicStreamParser();
      return feedAll(p, [
        sse({ type: 'message_start', model: 'claude-sonnet-4' }),
        sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
        sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading ' } }),
        sse({ type: 'content_block_stop', index: 0 }),
        TOOL_START(startBlock, 1),
        TOOL_DELTA(ARG_A, 1),
        TOOL_DELTA(ARG_B, 1),
        TOOL_STOP(1),
        sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }),
        MSG_STOP,
      ]);
    };

    const withEmptyObject = wire({ id: 'toolu_01', name: 'Read', input: {} });
    const withNoInput = wire({ id: 'toolu_01', name: 'Read' });
    expect(withEmptyObject).toEqual(withNoInput);

    // The pre-Round-53 expectation for this exact stream, reproduced verbatim
    // with the single changed literal marked.
    expect(withEmptyObject).toEqual([
      { type: 'message_start', model: 'claude-sonnet-4' },
      { type: 'text_delta', text: 'Reading ' },
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' }, // was '{}'
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'usage', inputTokens: undefined, outputTokens: 8, cacheReadTokens: undefined, cacheCreationTokens: undefined },
      { type: 'message_end', finishReason: 'tool_calls' },
      { type: 'message_end' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Round 54 — malformed-frame observability.
//
// The family Round 52 did NOT cover: a frame the wire delivered in a
// byte-level-unparseable state. Its bytes are gone for good, so the fix is not
// data preservation but VISIBILITY — the frame is still dropped, but the parser
// now says so. Reachability is not hypothetical: AnthropicProvider's EOF path
// feeds the leftover (newline-less) buffer to parser.feed() as one last frame,
// so a truncated connection's half-written JSON tail necessarily lands in
// feed()'s `catch { return out }` that used to be indistinguishable from
// "nothing to emit".
//
// Scope discipline: the counter is the ONLY behavioural change. No new event
// type, no change to feed()/finish() return shapes, no field added to
// `message_end` (that would move the consumer contract), and nothing in
// packages/shared.
// ---------------------------------------------------------------------------

/** A real `input_json_delta` frame — and the same frame as a dropped connection leaves it. */
const INTACT_TAIL_FRAME = TOOL_DELTA('{"limit":2}', 1);
const TRUNCATED_TAIL_FRAME = INTACT_TAIL_FRAME.slice(0, INTACT_TAIL_FRAME.length - 4);

describe('AnthropicStreamParser — malformed frames are counted, not silent (Round 54)', () => {
  it('REPRO ①: the truncated tail frame still yields no chunks — and now leaves exactly one counted trace', () => {
    // Self-verifying fixture: this really is the EOF residual-buffer shape (one
    // newline-less line whose JSON was cut mid-write), not a made-up string.
    expect(TRUNCATED_TAIL_FRAME.includes('\n')).toBe(false);
    expect(() => JSON.parse(TRUNCATED_TAIL_FRAME.slice('data: '.length))).toThrow();

    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      sse({ type: 'message_start', model: 'claude-sonnet-4' }),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
      TOOL_DELTA(FULL_ARGS, 0),
      TRUNCATED_TAIL_FRAME, // ← the connection dies here, mid-frame
    ]);

    // The frame itself is still lost — that is unchanged and intentional (its
    // bytes are unrecoverable). "No trace" was the defect:
    expect(chunks.map((c) => c.type)).toEqual(['message_start', 'tool_call_start', 'tool_call_delta']);
    expect(chunks.some((c) => JSON.stringify(c).includes('limit'))).toBe(false);

    // Pre-fix there was NOTHING to assert here: the parser exposed no counter
    // and no chunk, so `malformedFrames` was 0/undefined. This line is what
    // goes red if the fix is deleted.
    expect(p.malformedFrames).toBe(1);

    // ...and the turn still LOOKS successful, which is exactly why silence was
    // dangerous: the consumer assembles a perfectly parseable call while a whole
    // frame of the model's bytes went missing.
    expect(JSON.parse(String(assembleByConsumer(chunks).get('toolu_01')?.args))).toEqual({ path: 'a.txt' });

    // Round 52's terminal boundary is untouched by the counter.
    expect(p.finish()).toEqual([{ type: 'tool_call_end', id: 'toolu_01' }, { type: 'message_end' }]);
    expect(p.malformedFrames).toBe(1); // finish() does not re-scan, so it cannot re-count
  });

  it('NEGATIVE CONTROL ②: a canonical stream counts zero — no blanket counting', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      'event: message_start',
      sse({ type: 'message_start', model: 'claude-sonnet-4' }),
      ': ping', // keepalive: no `data:` field at all
      'event: content_block_start',
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      'event: content_block_delta',
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading ' } }),
      'event: content_block_stop',
      sse({ type: 'content_block_stop', index: 0 }),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 1),
      TOOL_DELTA(ARG_A, 1),
      TOOL_DELTA(ARG_B, 1),
      TOOL_STOP(1),
      sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }),
      MSG_STOP,
    ]);

    // The canonical wire is not "tolerated", it is clean: zero frames dropped.
    expect(p.malformedFrames).toBe(0);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' });

    // Documented scope boundary, asserted so it cannot drift silently: a frame
    // that IS valid JSON but not an object (here a bare number) is an unknown
    // shape the mapper already ignores — it is not byte-level malformed, so it
    // is deliberately not counted.
    const q = new AnthropicStreamParser();
    expect(feedAll(q, ['data: 123'])).toEqual([]);
    expect(q.malformedFrames).toBe(0);
  });

  it('③ the count is PER STREAM: a second parser starts at 0 and the first is not moved by it', () => {
    const first = new AnthropicStreamParser();
    expect(first.malformedFrames).toBe(0); // fresh stream starts clean
    first.feed(TRUNCATED_TAIL_FRAME);
    expect(first.malformedFrames).toBe(1);

    const second = new AnthropicStreamParser();
    expect(second.malformedFrames).toBe(0); // ← pre-counter designs that shared module state go red here
    second.feed(sse({ type: 'message_stop' }));
    expect(second.malformedFrames).toBe(0);

    expect(first.malformedFrames).toBe(1); // the first stream is untouched by the second
  });

  it('counts one frame exactly once: repeated reads do not increment, a second bad frame does', () => {
    const p = new AnthropicStreamParser();
    p.feed(TRUNCATED_TAIL_FRAME);
    expect(p.malformedFrames).toBe(1);
    expect(p.malformedFrames).toBe(1); // reading is a pure getter
    expect(p.malformedFrames).toBe(1);
    p.feed(TRUNCATED_TAIL_FRAME); // a distinct frame on the wire ⇒ a distinct count
    expect(p.malformedFrames).toBe(2);
  });

  it('the stateless mapper reports its own malformed payload through the optional sink — and stays pure without it', () => {
    // Without the sink: unchanged behaviour, byte-for-byte the pre-fix contract.
    expect(parseAnthropicEvent('{"type":')).toEqual([]);

    let reported = 0;
    expect(parseAnthropicEvent('{"type":', () => {
      reported += 1;
    })).toEqual([]);
    expect(reported).toBe(1);

    // A payload that parses never fires the sink — the negative control for the
    // sink itself, so "always report" cannot pass either.
    let untouched = 0;
    expect(parseAnthropicEvent(JSON.stringify({ type: 'message_stop' }), () => {
      untouched += 1;
    })).toEqual([{ type: 'message_end' }]);
    expect(untouched).toBe(0);
  });

  it('documented boundary: bytes after the terminal message_stop are not counted (feed() returns before parsing)', () => {
    const p = new AnthropicStreamParser();
    p.feed(sse({ type: 'message_stop' })); // terminal boundary reached
    expect(p.feed(TRUNCATED_TAIL_FRAME)).toEqual([]); // already ended: no parsing, no counting
    expect(p.malformedFrames).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Duplicate `content_block_start` — the third member of the "same wire frame
// arrives twice ⇒ the consumer's id-keyed accumulator is OVERWRITTEN" family
// this file has been closing (Round 46 = OpenAI "start after start", Round 52
// = the identity-incomplete block, Round 53 = the `{}` seed).
//
// The mechanism, in full, before the fix:
//   feed()'s tool_call_start branch had no "has this index already started?"
//   check (parseOpenAI.ts:152-161 has had one since Round 46), so a second
//   `content_block_start` for the same index emitted a SECOND tool_call_start;
//   AgentLoop.consumeStream (`case 'tool_call_start':
//   open.set(chunk.id, { name: chunk.name, args: chunk.arguments })`) REPLACES
//   the map entry wholesale, so every `input_json_delta` fragment accumulated
//   since the first start was silently discarded — and because the replacement
//   seed is itself valid JSON, the turn still LOOKED healthy.
//
// The fix keeps the Round-46 policy (suppress the repeated start) but not the
// Round-46 outcome for the repeated frame's payload: a non-empty seed rides on
// as an append-only `tool_call_delta`, so neither side of the duplicate is lost.
// ---------------------------------------------------------------------------

/** The seed a duplicate start carries in these cases (`input: { limit: 2 }`). */
const DUP_SEED = JSON.stringify({ limit: 2 }); // '{"limit":2}'

describe('AnthropicStreamParser — duplicate content_block_start must not overwrite the accumulator', () => {
  it('REPRO ①: a repeated start carrying a non-empty input keeps BOTH the earlier fragments and the new seed', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
      TOOL_DELTA(ARG_A, 0), // a fragment already accumulated in the consumer
      TOOL_START({ id: 'toolu_01', name: 'Read', input: { limit: 2 } }, 0), // ← the duplicate
      TOOL_STOP(0),
      MSG_STOP,
    ]);

    // Root cause first: the pre-fix parser emitted a SECOND tool_call_start here
    // (that chunk is what makes the consumer overwrite). Post-fix there is one.
    expect(chunks.filter((c) => c.type === 'tool_call_start')).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
    ]);

    // ...and the repeated frame's seed is NOT thrown away with it: it becomes an
    // append-only delta, which is exactly the shape the consumer accumulates.
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: DUP_SEED },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);

    const accumulated = String(assembleByConsumer(chunks).get('toolu_01')?.args);
    expect(accumulated).toBe(ARG_A + DUP_SEED);
    expect(accumulated.includes(ARG_A)).toBe(true); // ← pre-fix FALSE: the fragment was overwritten
    expect(accumulated.includes(DUP_SEED)).toBe(true); // the duplicate's data is present too

    // PRE-FIX TRACE — the chunk sequence the pre-fix parser produced for this
    // exact wire, transcribed (the only difference from `chunks` is the second
    // tool_call_start, which the fix replaced with the folded delta). Replaying
    // it through the SAME consumer algorithm shows the loss without depending on
    // the fix being absent:
    const preFix: StreamChunk[] = [
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: DUP_SEED }, // ← the overwrite
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ];
    const preFixAccumulated = String(assembleByConsumer(preFix).get('toolu_01')?.args);
    expect(preFixAccumulated).toBe(DUP_SEED);
    expect(preFixAccumulated.includes(ARG_A)).toBe(false); // ARG_A is GONE
    // ...and the turn still looked successful: the surviving value parses, so the
    // tool is called — with arguments the model never sent (the model's actual
    // `{"path":"` fragment is what disappeared).
    expect(parseToolArgumentsLikeAgentLoop(preFixAccumulated)).toEqual({ limit: 2 });
    expect(parseToolArgumentsLikeAgentLoop(preFixAccumulated)).not.toHaveProperty('_raw');
  });

  it('② a repeated start with an EMPTY seed injects no junk delta: identical to the single-start stream', () => {
    const wire = (duplicate: boolean): StreamChunk[] => {
      const p = new AnthropicStreamParser();
      return feedAll(p, [
        TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
        TOOL_DELTA(ARG_A, 0),
        ...(duplicate ? [TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0)] : []),
        TOOL_DELTA(ARG_B, 0),
        TOOL_STOP(0),
        MSG_STOP,
      ]);
    };

    // Chunk-for-chunk equal to the one-start stream. This is what goes red if the
    // `c.arguments !== ''` guard is dropped: an empty `argumentsDelta: ''` chunk
    // would be injected (the consumer would not even notice — hence the array
    // assertion, not just the accumulator assertion).
    expect(wire(true)).toEqual(wire(false));
    expect(wire(true)).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
    expect(String(assembleByConsumer(wire(true)).get('toolu_01')?.args)).toBe(FULL_ARGS);

    // The other information-free shape (`input` absent altogether) behaves the
    // same: Round 53's seed rule turns both into ''.
    const dupNoInput = feedAll(new AnthropicStreamParser(), [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
      TOOL_DELTA(ARG_A, 0),
      TOOL_START({ id: 'toolu_01', name: 'Read' }, 0), // ← duplicate, no `input`
      TOOL_DELTA(ARG_B, 0),
      TOOL_STOP(0),
      MSG_STOP,
    ]);
    expect(dupNoInput).toEqual(wire(false));
  });

  it('④ no second tool_call_start is ever emitted for an already-started index (repeat it three times)', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
      TOOL_DELTA(ARG_A, 0),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0), // repeat #1
      TOOL_DELTA(ARG_B, 0),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0), // repeat #2
      TOOL_STOP(0),
      MSG_STOP,
    ]);

    // The invariant the fix installs, stated directly: one start per started
    // index, no matter how many duplicate frames the wire delivers.
    expect(chunks.filter((c) => c.type === 'tool_call_start')).toHaveLength(1);
    // ...and the accumulation is complete (nothing was overwritten on the way).
    const open = assembleByConsumer(chunks);
    expect([...open.keys()]).toEqual(['toolu_01']);
    expect(String(open.get('toolu_01')?.args)).toBe(FULL_ARGS);
    expect(JSON.parse(String(open.get('toolu_01')?.args))).toEqual({ path: 'a.txt' });
  });
});

// ---------------------------------------------------------------------------
// Negative control for the duplicate-start fix: a canonical stream carries
// exactly one `content_block_start` per index, so the `startedIndexes` guard can
// never fire on it. Asserted as a full literal array — the fix adds a branch to
// the hot path, and "the branch is dead on a well-formed wire" has to be
// evidence, not an argument.
// ---------------------------------------------------------------------------

describe('AnthropicStreamParser — negative control: canonical streams are untouched by the duplicate-start guard', () => {
  it('③ two tool blocks + text: chunk-for-chunk unchanged (delete the guard ⇒ still green)', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      sse({ type: 'message_start', model: 'claude-sonnet-4' }),
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading ' } }),
      sse({ type: 'content_block_stop', index: 0 }),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 1),
      TOOL_DELTA(ARG_A, 1),
      TOOL_DELTA(ARG_B, 1),
      TOOL_STOP(1),
      TOOL_START({ id: 'toolu_02', name: 'Glob', input: {} }, 2),
      TOOL_DELTA('{"pat":', 2),
      TOOL_DELTA('"*"}', 2),
      TOOL_STOP(2),
      sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }),
      MSG_STOP,
    ]);

    expect(chunks).toEqual([
      { type: 'message_start', model: 'claude-sonnet-4' },
      { type: 'text_delta', text: 'Reading ' },
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'tool_call_start', id: 'toolu_02', name: 'Glob', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_02', argumentsDelta: '{"pat":' },
      { type: 'tool_call_delta', id: 'toolu_02', argumentsDelta: '"*"}' },
      { type: 'tool_call_end', id: 'toolu_02' },
      { type: 'usage', inputTokens: undefined, outputTokens: 8, cacheReadTokens: undefined, cacheCreationTokens: undefined },
      { type: 'message_end', finishReason: 'tool_calls' },
      { type: 'message_end' },
    ]);

    // Both parallel calls assemble, keyed by their own id.
    const open = assembleByConsumer(chunks);
    expect([...open.keys()]).toEqual(['toolu_01', 'toolu_02']);
    expect(parseToolArgumentsLikeAgentLoop(String(open.get('toolu_01')?.args))).toEqual({ path: 'a.txt' });
    expect(parseToolArgumentsLikeAgentLoop(String(open.get('toolu_02')?.args))).toEqual({ pat: '*' });
    // The text block's stop still yields no end (the deliberate Round 52 rule).
    expect(chunks.filter((c) => c.type === 'tool_call_end')).toHaveLength(2);
    expect(p.finish()).toEqual([]); // message_stop already closed the stream
  });
});

// ---------------------------------------------------------------------------
// Round 65 — duplicate-`content_block_start` OBSERVABILITY.
//
// Round 64 fixed the data loss of the shape its `startedIndexes` guard can SEE:
// the repeat carries `id`+`name`, so it produces a `tool_call_start`, the guard
// suppresses it, and its non-empty seed is folded into a `tool_call_delta`. It
// left a shape the guard CANNOT see, and this file must not pretend otherwise:
//
//   a repeat carrying NO `id`/`name` (but a non-empty `input`) makes
//   parseAnthropicEvent's `block.id && block.name` guard emit NOTHING, so
//   feed()'s chunk loop never runs for that frame, the guard never fires, and
//   the seed the frame wrote into `toolInputJsonByIndex` is read by nobody:
//   flushToolBlock — the only reader — serves UNSTARTED blocks, and this index
//   is started. The seed is still silently lost.
//
// Both shapes ARE protocol violations ("the block for this index is still open
// and another content_block_start arrived"), so both are now counted, per
// stream, by the read-only `duplicateStarts` getter — the count is taken at the
// FRAME, before the mapper, which is why the second shape needs no second
// emission point.
//
// Deliberately NOT merged into `malformedFrames`, whose meaning is byte-level
// unparseability (a truncated connection): "the peer re-sent a frame" and "the
// connection was cut mid-frame" are different incidents, and a single merged
// number would make them indistinguishable.
//
// Scope discipline, as in Round 54: a read-only getter, per-stream instance
// state, no new export, no change to feed()/finish() return shapes, no change to
// `message_end`, nothing in packages/shared.
// ---------------------------------------------------------------------------

describe('AnthropicStreamParser — duplicate content_block_start is counted as a protocol violation (Round 65)', () => {
  it('REPRO ①: a repeat carrying id+name on an OPEN block is counted (the shape Round 64 already handles)', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
      TOOL_DELTA(ARG_A, 0),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: { limit: 2 } }, 0), // ← the protocol violation
      TOOL_DELTA(ARG_B, 0),
      TOOL_STOP(0),
      MSG_STOP,
    ]);

    expect(p.duplicateStarts).toBe(1);

    // Round 64's data-preserving behaviour is untouched, and no second
    // tool_call_start appears (the chunk the consumer would overwrite on).
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: DUP_SEED },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
    expect(chunks.filter((c) => c.type === 'tool_call_start')).toHaveLength(1);
    expect(String(assembleByConsumer(chunks).get('toolu_01')?.args)).toBe(ARG_A + DUP_SEED + ARG_B);
  });

  it('REPRO ②: a repeat carrying NO id/name on an OPEN block is counted — the shape NO guard sees, whose seed is still lost', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0), // identity complete ⇒ block open + started
      TOOL_START({ input: { limit: 2 } }, 0), //                    ← repeat: no id, no name, NON-empty input
      TOOL_STOP(0),
      MSG_STOP,
    ]);

    // THE POINT OF THIS CARD. This frame is a protocol violation that the Round
    // 64 guard in feed()'s chunk loop can never fire on: parseAnthropicEvent
    // emits no tool_call_start for it (its `block.id && block.name` guard is
    // false), so the chunk loop is never entered. Pre-fix there was NO signal of
    // any kind — the chunk output below was byte-identical to a canonical
    // single-start stream. This line is what goes red if the counter is deleted,
    // and ALSO what goes red if the increment is moved into the
    // `startedIndexes.has(index)` branch (where it "looks" like it belongs).
    expect(p.duplicateStarts).toBe(1);

    // ...and the seed that frame carried is STILL not surfaced. This is the
    // known residual — preserving it needs a second emission point, which is an
    // explicitly separate decision — asserted here so "known" cannot quietly
    // decay into "assumed fixed".
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
    expect(chunks.some((c) => JSON.stringify(c).includes('limit'))).toBe(false);

    // What the tool actually receives: the wire delivered {"limit":2} on that
    // frame, and the call arrives with NO arguments at all. The counter makes
    // the loss visible; it does not repair it.
    const args = String(assembleByConsumer(chunks).get('toolu_01')?.args);
    expect(args).toBe('');
    expect(parseToolArgumentsLikeAgentLoop(args)).toEqual({});
  });

  it('③ NEGATIVE CONTROL: a canonical stream counts zero, and its chunks are byte-identical', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      sse({ type: 'message_start', model: 'claude-sonnet-4' }),
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading ' } }),
      sse({ type: 'content_block_stop', index: 0 }),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 1),
      TOOL_DELTA(ARG_A, 1),
      TOOL_DELTA(ARG_B, 1),
      TOOL_STOP(1),
      sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }),
      MSG_STOP,
    ]);

    expect(p.duplicateStarts).toBe(0); // ← "count every start" goes red here
    expect(p.malformedFrames).toBe(0);

    // The output is asserted, not argued: one start per block ⇒ nothing to count
    // AND nothing changed.
    expect(chunks).toEqual([
      { type: 'message_start', model: 'claude-sonnet-4' },
      { type: 'text_delta', text: 'Reading ' },
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'usage', inputTokens: undefined, outputTokens: 8, cacheReadTokens: undefined, cacheCreationTokens: undefined },
      { type: 'message_end', finishReason: 'tool_calls' },
      { type: 'message_end' },
    ]);
  });

  it('④ NEGATIVE CONTROL: reusing an index AFTER its content_block_stop is legal and counts zero', () => {
    // The hard boundary: the block is CLOSED and all of its state was dropped, so
    // the next content_block_start for that index is the FIRST start of a NEW
    // block — exactly what index reuse on a well-formed wire looks like.
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ id: 'toolu_01', name: 'Read' }, 0),
      TOOL_DELTA('{"path":"a.txt"}', 0),
      TOOL_STOP(0), //                                    ← the block closes here...
      TOOL_START({ id: 'toolu_02', name: 'Glob' }, 0), // ← ...so this is legal, NOT a duplicate
      TOOL_DELTA('{"pat":"*"}', 0),
      TOOL_STOP(0),
      MSG_STOP,
    ]);

    expect(p.duplicateStarts).toBe(0); // ← "any second start for an index" goes red here
    expect(p.malformedFrames).toBe(0);

    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: '{"path":"a.txt"}' },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'tool_call_start', id: 'toolu_02', name: 'Glob', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_02', argumentsDelta: '{"pat":"*"}' },
      { type: 'tool_call_end', id: 'toolu_02' },
      { type: 'message_end' },
    ]);

    // Both blocks assemble independently: the reuse did not merge them.
    const open = assembleByConsumer(chunks);
    expect(parseToolArgumentsLikeAgentLoop(String(open.get('toolu_01')?.args))).toEqual({ path: 'a.txt' });
    expect(parseToolArgumentsLikeAgentLoop(String(open.get('toolu_02')?.args))).toEqual({ pat: '*' });
  });

  it('⑤ the two counters stay independent in BOTH directions (no 口径混用)', () => {
    // A truncated frame is a BYTE-level failure: malformedFrames moves, the
    // protocol counter does not.
    const broken = new AnthropicStreamParser();
    feedAll(broken, [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
      TOOL_DELTA(FULL_ARGS, 0),
      TRUNCATED_TAIL_FRAME, // ← the connection dies mid-frame
    ]);
    expect(broken.malformedFrames).toBe(1);
    expect(broken.duplicateStarts).toBe(0); // ← merging the two counters goes red here

    // A duplicate start is a PROTOCOL failure: the mirrored assertion, so
    // "one shared counter" cannot pass by counting on the other field's behalf.
    const repeated = new AnthropicStreamParser();
    feedAll(repeated, [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0), // ← protocol violation
      TOOL_STOP(0),
      MSG_STOP,
    ]);
    expect(repeated.duplicateStarts).toBe(1);
    expect(repeated.malformedFrames).toBe(0);
  });

  it('idempotency: one count per violating FRAME, reading is pure, and the terminal boundary cannot re-count', () => {
    const p = new AnthropicStreamParser();
    expect(p.duplicateStarts).toBe(0); // a fresh stream starts clean

    feedAll(p, [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0), // violation #1
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0), // violation #2
    ]);
    // "One count per violation" is per FRAME: two repeated frames are two
    // violations. What must NOT happen is one frame counting twice.
    expect(p.duplicateStarts).toBe(2);
    expect(p.duplicateStarts).toBe(2); // reading is a pure getter
    expect(p.duplicateStarts).toBe(2);

    // PER STREAM: a second parser owns its own count...
    const second = new AnthropicStreamParser();
    expect(second.duplicateStarts).toBe(0); // ← module-level state goes red here
    expect(p.duplicateStarts).toBe(2); // ...and the first is untouched by it

    // finish() re-scans no frames, so it cannot re-count.
    expect(p.finish()).toEqual([{ type: 'tool_call_end', id: 'toolu_01' }, { type: 'message_end' }]);
    expect(p.duplicateStarts).toBe(2);

    // Documented boundary (as in Round 54): frames fed after the terminal
    // message_stop are never parsed, so they cannot be counted.
    const ended = new AnthropicStreamParser();
    ended.feed(TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0));
    ended.feed(MSG_STOP); // terminal boundary: the open block is closed here
    ended.feed(TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0)); // ← out of scope by design
    expect(ended.duplicateStarts).toBe(0);
  });

  it('documented scope: the criterion is "the block is OPEN", not "the block has STARTED"', () => {
    // Round 52's permissive "identity-late" wire order delivers TWO
    // content_block_start frames for one index, so by the literal criterion it IS
    // a protocol violation and IS counted — even though the parser recovers from
    // it. Asserted (with the recovery behaviour unchanged below) so the decision
    // is recorded rather than accidental drift.
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ name: 'Read' }, 0), // identity incomplete, block open
      TOOL_DELTA(ARG_A, 0),
      TOOL_DELTA(ARG_B, 0),
      TOOL_START({ id: 'toolu_01', name: 'Read' }, 0), // ← second start on the OPEN index
      TOOL_STOP(0),
      MSG_STOP,
    ]);

    expect(p.duplicateStarts).toBe(1);

    // Round 52's recovery is untouched: the buffered fragments still ride into
    // the eventual start.
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: FULL_ARGS },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
    expect(JSON.parse(String(assembleByConsumer(chunks).get('toolu_01')?.args))).toEqual({ path: 'a.txt' });
  });
});

// ---------------------------------------------------------------------------
// Round 68 — the SHAPE-B half of the duplicate-`content_block_start` violation:
// the repeat carries a DIFFERENT id (and name).
//
// Round 64 stopped the repeated frame from re-emitting `tool_call_start`, but the
// frame still reached feed()'s two identity `set()` calls, which OVERWROTE the
// id/name the block had been registered with. That is not a cosmetic relabel:
// every chunk of the block's remaining life is ADDRESSED from `toolIdByIndex` —
// the folded seed, every streamed `input_json_delta`, and the `tool_call_end`
// produced at the block's own `content_block_stop`. So the rewrite re-addressed
// the entire tail:
//   - the repeat's folded seed went out as `tool_call_delta{id: toolu_02}`, and
//     the consumer's accumulator (AgentLoop.consumeStream `open.get(chunk.id)`,
//     keyed by the START's id = toolu_01) never saw it ⇒ that frame's data LOST;
//   - every later fragment of the block was addressed to toolu_02 as well;
//   - the block's `tool_call_end` came out as toolu_02 — an ORPHAN end (no start
//     ever opened toolu_02) — while toolu_01 received no end of its own and was
//     closed only by AgentLoop's stream-boundary fallback (AgentLoop.ts:661-665).
//
// The fix is "the FIRST start freezes the identity": a repeat may neither
// re-emit the start (Round 64) nor rewrite the id/name the block was registered
// with, and the folded seed is addressed to that frozen identity — i.e. shape B
// becomes shape C, which Round 64 had already made safe.
//
// The guard is deliberately `startedIndexes.has(index)` and NOT "any identity
// was registered": completing the identity of a not-yet-started block from a
// later frame is Round 52's recovery for the identity-late wire order (pinned by
// the "fragments buffered before the identity arrives" case above), and freezing
// that would turn the recovery back into a placeholder-id flush.
// ---------------------------------------------------------------------------

/** The id a shape-B repeat carries — deliberately NOT the first start's. */
const DUP_NEW_ID = 'toolu_02';

describe('AnthropicStreamParser — duplicate content_block_start with a DIFFERENT id (Round 68)', () => {
  it('① 重复帧带不同 id ⇒ identity 冻结在首个 start：seed 挂原 id 送达、tool_call_end 也回原 id（删两处修复任一 ⇒ 红）', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0), // ← the identity that owns this block
      TOOL_DELTA(ARG_A, 0), //                          already accumulated under toolu_01
      TOOL_START({ id: DUP_NEW_ID, name: 'Glob', input: { limit: 2 } }, 0), // ← the repeat: different id AND name
      TOOL_DELTA(ARG_B, 0), //                          the block's later fragments
      TOOL_STOP(0),
      MSG_STOP,
    ]);

    // Two independent lines carry this behaviour — deleting EITHER turns this
    // whole-array assertion red:
    //   1. feed()'s `identityFrozen` guard (drop it ⇒ toolIdByIndex becomes
    //      toolu_02 and every id below flips with it);
    //   2. the folded delta reading `toolIdByIndex` instead of this frame's
    //      `c.id` (revert it ⇒ that one delta goes back to toolu_02).
    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: DUP_SEED }, // ← pre-fix id: 'toolu_02'
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B }, //    ← pre-fix id: 'toolu_02'
      { type: 'tool_call_end', id: 'toolu_01' }, //                             ← pre-fix id: 'toolu_02' (orphan)
      { type: 'message_end' },
    ]);

    // The invariants stated directly, so nobody has to diff arrays to see them.
    expect(chunks.filter((c) => c.type === 'tool_call_start')).toHaveLength(1); // still never re-emitted (Round 64)
    expect(chunks.filter((c) => c.type === 'tool_call_end')).toEqual([{ type: 'tool_call_end', id: 'toolu_01' }]); // no orphan end
    expect(chunks.some((c) => JSON.stringify(c).includes(DUP_NEW_ID))).toBe(false); // the repeat's id appears NOWHERE
    expect(p.duplicateStarts).toBe(1); // the violation is still counted (Round 65, untouched)

    // What the consumer ends up holding: ONE call, carrying the repeat's seed.
    const open = assembleByConsumer(chunks);
    expect([...open.keys()]).toEqual(['toolu_01']);
    expect(open.has(DUP_NEW_ID)).toBe(false); // no start ever opened that id
    expect(open.get('toolu_01')?.name).toBe('Read'); // the repeat's name did not take over either
    expect(String(open.get('toolu_01')?.args)).toBe(ARG_A + DUP_SEED + ARG_B);
    expect(String(open.get('toolu_01')?.args).includes(DUP_SEED)).toBe(true); // ← pre-fix FALSE: lost

    // PRE-FIX TRACE — the chunk sequence the pre-fix parser produced for this
    // exact wire, transcribed, then replayed through the SAME consumer algorithm:
    // the loss is demonstrated without depending on the fix being absent (the
    // same device the Round 64 case uses).
    const preFix: StreamChunk[] = [
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: DUP_NEW_ID, argumentsDelta: DUP_SEED }, // ← the fold hung on the NEW id
      { type: 'tool_call_delta', id: DUP_NEW_ID, argumentsDelta: ARG_B }, //    ← and so did the block's tail
      { type: 'tool_call_end', id: DUP_NEW_ID }, //                             ← orphan: no start opened this id
      { type: 'message_end' },
    ];
    const preFixOpen = assembleByConsumer(preFix);
    expect([...preFixOpen.keys()]).toEqual(['toolu_01']); // only the real start opened a call...
    expect(preFixOpen.has(DUP_NEW_ID)).toBe(false); //        ...so the deltas above landed nowhere
    expect(String(preFixOpen.get('toolu_01')?.args)).toBe(ARG_A); // ← the repeat's seed AND ARG_B are GONE
    expect(String(preFixOpen.get('toolu_01')?.args).includes(DUP_SEED)).toBe(false);
    // ...and toolu_01 has no end of its own in that sequence: the only end belongs
    // to an id nobody opened, so the loop closes toolu_01 through its
    // stream-boundary fallback instead of at the block's own boundary.
    expect(preFix.some((c) => c.type === 'tool_call_end' && c.id === 'toolu_01')).toBe(false);
    expect(preFix.some((c) => c.type === 'tool_call_start' && c.id === DUP_NEW_ID)).toBe(false);
  });

  it('② 负对照：每 index 恰好一次 start 的规范流逐字不变（整数组 toEqual；负对照应保持绿）', () => {
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      sse({ type: 'message_start', model: 'claude-sonnet-4' }),
      sse({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading ' } }),
      sse({ type: 'content_block_stop', index: 0 }),
      TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 1),
      TOOL_DELTA(ARG_A, 1),
      TOOL_DELTA(ARG_B, 1),
      TOOL_STOP(1),
      sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }),
      MSG_STOP,
    ]);

    // The Round 68 guard is dead code on a well-formed wire: a canonical stream
    // carries exactly one start per index, so `identityFrozen` is never true there.
    expect(chunks).toEqual([
      { type: 'message_start', model: 'claude-sonnet-4' },
      { type: 'text_delta', text: 'Reading ' },
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'usage', inputTokens: undefined, outputTokens: 8, cacheReadTokens: undefined, cacheCreationTokens: undefined },
      { type: 'message_end', finishReason: 'tool_calls' },
      { type: 'message_end' },
    ]);
    expect(p.duplicateStarts).toBe(0);
    expect(p.malformedFrames).toBe(0);
  });

  it('③ 负对照：形态 C（同 id 的重复 start）逐字不变 —— 仍与既有夹具一致，且与「无重复」只差折入的那条 seed', () => {
    const wire = (duplicate: boolean): StreamChunk[] => {
      const p = new AnthropicStreamParser();
      return feedAll(p, [
        TOOL_START({ id: 'toolu_01', name: 'Read', input: {} }, 0),
        TOOL_DELTA(ARG_A, 0),
        ...(duplicate ? [TOOL_START({ id: 'toolu_01', name: 'Read', input: { limit: 2 } }, 0)] : []),
        TOOL_DELTA(ARG_B, 0),
        TOOL_STOP(0),
        MSG_STOP,
      ]);
    };

    // Round 64's output, unchanged: the freeze is a no-op on a same-id repeat
    // (it would have re-registered the very same strings), and the fold resolves
    // to the same id it always did.
    expect(wire(true)).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: DUP_SEED },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
    expect(String(assembleByConsumer(wire(true)).get('toolu_01')?.args)).toBe(ARG_A + DUP_SEED + ARG_B);

    expect(wire(false)).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'toolu_01', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
  });

  it('④ 边界：冻结只作用于已 started 的 index —— 未启动块的 identity 补全（Round 52 identity-late）逐字不变', () => {
    // The counter-example that keeps the guard honest. A block whose identity is
    // still incomplete has NO consumer-side call yet, so a later frame completing
    // it must still register the id. A literal "the first start freezes whatever
    // it carried" would freeze the MISSING id and send this wire back to the
    // Round-52 placeholder flush (`anthropic-tool`) — what the assertions below
    // would catch.
    const p = new AnthropicStreamParser();
    const chunks = feedAll(p, [
      TOOL_START({ name: 'Read' }, 0), // identity incomplete: no id ⇒ no call opened
      TOOL_DELTA(ARG_A, 0),
      TOOL_DELTA(ARG_B, 0),
      TOOL_START({ id: 'toolu_01', name: 'Read' }, 0), // completes the identity
      TOOL_STOP(0),
      MSG_STOP,
    ]);

    expect(chunks).toEqual([
      { type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: FULL_ARGS },
      { type: 'tool_call_end', id: 'toolu_01' },
      { type: 'message_end' },
    ]);
    expect(p.duplicateStarts).toBe(1); // still a protocol violation, still counted at the frame
    expect(chunks.some((c) => JSON.stringify(c).includes('anthropic-tool'))).toBe(false);
  });
});