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