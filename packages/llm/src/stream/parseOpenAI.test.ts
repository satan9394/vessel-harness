import { describe, it, expect } from 'vitest';
import {
  parseOpenAIStreamChunk,
  OpenAIStreamParser,
  createOpenAIToolState,
  flushPendingToolCalls,
} from './parseOpenAI.js';
import type { StreamChunk } from '@vessel/shared';

const data = (line: string): string => line.replace(/^data: /, '');

/** One OpenAI SSE payload, already stripped of the `data: ` prefix. */
const payload = (delta: unknown): string => JSON.stringify({ choices: [{ delta }] });

/**
 * OpenAI wire shape for ONE tool-call entry: the entry must sit under
 * `delta.tool_calls` — that is the path the parser reads (parseOpenAI.ts), so
 * passing the entry itself as `delta` parses to zero chunks.
 */
const tcPayload = (tc: unknown): string => payload({ tool_calls: [tc] });

/** The tool-call payload as a raw SSE transport line (how the provider feeds the driver). */
const tcLine = (tc: unknown): string => `data: ${tcPayload(tc)}`;

/**
 * The consumer accumulation AgentLoop.consumeStream() performs (open.set on
 * tool_call_start, append on tool_call_delta, keyed by id) — used so the
 * assertions below are about what a real consumer ends up holding, not about
 * our chunk shape alone.
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

/** Flattened argument text of the single call a plain (non-keyed) consumer sees. */
function assembleArgs(chunks: StreamChunk[]): string {
  let args = '';
  for (const c of chunks) {
    if (c.type === 'tool_call_start') args = c.arguments;
    else if (c.type === 'tool_call_delta') args += c.argumentsDelta;
  }
  return args;
}

describe('parseOpenAIStreamChunk — plain text SSE → text_delta', () => {
  it('maps delta.content to text_delta', () => {
    const state = createOpenAIToolState();
    const chunks = parseOpenAIStreamChunk(data('data: {"choices":[{"delta":{"content":"Hello "}}]}'), state);
    expect(chunks).toEqual([{ type: 'text_delta', text: 'Hello ' }]);
  });

  it('ignores empty content and bare [DONE]', () => {
    const state = createOpenAIToolState();
    expect(parseOpenAIStreamChunk('[DONE]', state)).toEqual([]);
    expect(parseOpenAIStreamChunk(data('data: {"choices":[{"delta":{"content":""}}]}'), state)).toEqual([]);
  });

  it('maps usage to a usage chunk with cache tokens', () => {
    const state = createOpenAIToolState();
    const chunks = parseOpenAIStreamChunk(
      data('data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":2}}}'),
      state,
    );
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 7,
      outputTokens: 3,
      cacheReadTokens: 2,
    });
  });

  it('tolerates malformed JSON (no throw, empty result)', () => {
    const state = createOpenAIToolState();
    expect(parseOpenAIStreamChunk('{not json', state)).toEqual([]);
  });

  it('maps delta.reasoning_content to reasoning_delta (task 109 DeepSeek thinking 流式)', () => {
    const state = createOpenAIToolState();
    const chunks = parseOpenAIStreamChunk(
      data('data: {"choices":[{"delta":{"reasoning_content":"先读文件"}}]}'),
      state,
    );
    expect(chunks).toEqual([{ type: 'reasoning_delta', text: '先读文件' }]);
    // 空增量不产生 chunk
    expect(parseOpenAIStreamChunk(data('data: {"choices":[{"delta":{"reasoning_content":""}}]}'), state)).toEqual([]);
    // reasoning 与 content 并行出现时都映射
    const both = parseOpenAIStreamChunk(
      data('data: {"choices":[{"delta":{"reasoning_content":"想","content":"答"}}]}'),
      createOpenAIToolState(),
    );
    expect(both).toEqual([{ type: 'reasoning_delta', text: '想' }, { type: 'text_delta', text: '答' }]);
  });
});

describe('parseOpenAIStreamChunk — tool_calls across deltas', () => {
  it('emits tool_call_start on first delta, tool_call_delta on continuation', () => {
    const state = createOpenAIToolState();
    const first = parseOpenAIStreamChunk(
      data('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"Read","arguments":""}}]}}]}'),
      state,
    );
    expect(first).toEqual([{ type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: '' }]);

    const cont = parseOpenAIStreamChunk(
      data('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}'),
      state,
    );
    expect(cont).toEqual([{ type: 'tool_call_delta', id: 'call_1', argumentsDelta: '{"path":' }]);

    const cont2 = parseOpenAIStreamChunk(
      data('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]}}]}'),
      state,
    );
    expect(cont2).toEqual([{ type: 'tool_call_delta', id: 'call_1', argumentsDelta: '"a.txt"}' }]);
  });

  it('tracks two tool calls concurrently by index', () => {
    const state = createOpenAIToolState();
    const a = parseOpenAIStreamChunk(
      data('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c0","function":{"name":"Read"}}]}}]}'),
      state,
    );
    expect(a[0]).toMatchObject({ type: 'tool_call_start', id: 'c0', name: 'Read' });
    const b = parseOpenAIStreamChunk(
      data('data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c1","function":{"name":"Glob"}}]}}]}'),
      state,
    );
    expect(b[0]).toMatchObject({ type: 'tool_call_start', id: 'c1', name: 'Glob' });
    const acont = parseOpenAIStreamChunk(data('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}'), state);
    expect(acont[0]).toMatchObject({ type: 'tool_call_delta', id: 'c0', argumentsDelta: '{}' });
  });
});

describe('OpenAIStreamParser — full SSE stream driver', () => {
  it('assembles message_start → text_delta → usage → message_end and [DONE] tolerance', () => {
    const p = new OpenAIStreamParser();
    const lines = [
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hi"}}]}',
      'data: {"choices":[{"delta":{"content":" there"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
      'data: [DONE]',
      '',
    ];
    const chunks: StreamChunk[] = [];
    for (const l of lines) chunks.push(...p.feed(l));
    expect(chunks[0]).toEqual({ type: 'message_start' });
    expect(chunks[1]).toEqual({ type: 'text_delta', text: 'Hi' });
    expect(chunks[2]).toEqual({ type: 'text_delta', text: ' there' });
    expect(chunks).toContainEqual({ type: 'usage', inputTokens: 5, outputTokens: 2, cacheReadTokens: undefined });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' });
  });

  it('emits tool_call_start/end around tool-call deltas and message_end on [DONE]', () => {
    const p = new OpenAIStreamParser();
    const chunks: StreamChunk[] = [];
    chunks.push(
      ...p.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","function":{"name":"Read"}}]}}]}'),
    );
    chunks.push(...p.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]}}]}'));
    chunks.push(...p.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]},"finish_reason":"tool_calls"]}'));
    chunks.push(...p.feed('data: [DONE]'));

    const kinds = chunks.map((c) => c.type);
    expect(kinds).toContain('tool_call_start');
    expect(kinds).toContain('tool_call_delta');
    expect(kinds).toContain('tool_call_end');
    expect(kinds).toContain('message_end');
    const end = chunks.find((c) => c.type === 'tool_call_end');
    expect((end as { id: string }).id).toBe('call_9');
  });

  it('finish() emits trailing tool_call_end and message_end when [DONE] never arrives', () => {
    const p = new OpenAIStreamParser();
    const chunks: StreamChunk[] = [];
    chunks.push(...p.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"F"}}]}}]}'));
    const final = p.finish();
    chunks.push(...final);
    expect(chunks.map((c) => c.type)).toContain('tool_call_end');
    expect(chunks[chunks.length - 1]?.type).toBe('message_end');
  });
});

// ---------------------------------------------------------------------------
// Round 46 — out-of-order tool-call identity ("arguments before id+name").
//
// REPRO (pre-fix probe, recorded verbatim in docs/product-evolution/
// PRODUCT-GAP-MAP.md §Round 46). Three frames — arguments only, then id+name,
// then a continuation fragment — on the OLD parser produced:
//
//   emitted=start(Read,args="") | delta(".txt\"}")
//   assembledArgs=.txt"}"   assembledIsValidJson=false   firstFragmentLost=true
//
// i.e. the first fragment was dropped forever and the assembled call was
// empty/invalid JSON, with no warning. The tests below are the same probe
// pinned in-repo: they are RED on the pre-fix code (the `continue` that
// discarded the fragment, and the missing terminal flush) and GREEN now.
// ---------------------------------------------------------------------------
describe('parseOpenAIStreamChunk — out-of-order tool-call identity (Round 46)', () => {
  const ARG_A = '{"path":"';
  const ARG_B = 'a.txt"}';
  const FULL_ARGS = '{"path":"a.txt"}';
  /** Identity frame: id + name, no arguments (the canonical first wire frame). */
  const IDENTITY = { index: 0, id: 'call_1', function: { name: 'Read' } };
  const FRAG_A = { index: 0, function: { arguments: ARG_A } };
  const FRAG_B = { index: 0, function: { arguments: ARG_B } };

  it('REPRO (pre-fix firstFragmentLost=true): arguments-first fragments are replayed on tool_call_start', () => {
    const state = createOpenAIToolState();
    const first = parseOpenAIStreamChunk(tcPayload(FRAG_A), state);
    const second = parseOpenAIStreamChunk(tcPayload(IDENTITY), state);
    const third = parseOpenAIStreamChunk(tcPayload(FRAG_B), state);

    // Buffered, not thrown away (pre-fix this was also [] — the loss showed up
    // in `second`, where the start carried arguments: "" instead of ARG_A).
    expect(first).toEqual([]);
    expect(second).toEqual([{ type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: ARG_A }]);
    expect(third).toEqual([{ type: 'tool_call_delta', id: 'call_1', argumentsDelta: ARG_B }]);

    const assembled = assembleArgs([...first, ...second, ...third]);
    expect(assembled).toBe(FULL_ARGS);
    expect(JSON.parse(assembled)).toEqual({ path: 'a.txt' }); // pre-fix: threw (invalid JSON)
  });

  it('id-first / name-later: the id-only fragment is buffered, never emitted as a pre-start delta', () => {
    const state = createOpenAIToolState();
    // Pre-fix: this emitted tool_call_delta BEFORE any start for this id, which
    // AgentLoop discards (no open entry), and the later start only carried ARG_B.
    const first = parseOpenAIStreamChunk(tcPayload({ index: 0, id: 'call_1', function: { arguments: ARG_A } }), state);
    const second = parseOpenAIStreamChunk(tcPayload({ index: 0, function: { name: 'Read', arguments: ARG_B } }), state);

    expect(first).toEqual([]);
    expect(second).toEqual([{ type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: FULL_ARGS }]);
    const open = assembleByConsumer([...first, ...second]);
    expect(open.size).toBe(1);
    expect(open.get('call_1')?.args).toBe(FULL_ARGS);
  });

  it('name-first / id-later: held until the id arrives, then one start with the real id and full arguments', () => {
    const state = createOpenAIToolState();
    // Pre-fix: an immediate start under the placeholder id `tc_0`, then a SECOND
    // start with the real id ⇒ the consumer saw two calls, each with half the args.
    const first = parseOpenAIStreamChunk(tcPayload({ index: 0, function: { name: 'Read', arguments: ARG_A } }), state);
    const second = parseOpenAIStreamChunk(tcPayload({ index: 0, id: 'call_1', function: { arguments: ARG_B } }), state);

    expect(first).toEqual([]);
    expect(second).toEqual([{ type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: FULL_ARGS }]);
    const open = assembleByConsumer([...first, ...second]);
    expect([...open.keys()]).toEqual(['call_1']); // exactly one call, real id
    expect(open.get('call_1')?.args).toBe(FULL_ARGS);
  });

  it('negative control — normal order (id+name first, fragments after) is chunk-for-chunk unchanged', () => {
    // Variant 1: identity frame carries no arguments field at all.
    const s1 = createOpenAIToolState();
    const a1 = parseOpenAIStreamChunk(tcPayload(IDENTITY), s1);
    const b1 = parseOpenAIStreamChunk(tcPayload(FRAG_A), s1);
    const c1 = parseOpenAIStreamChunk(tcPayload(FRAG_B), s1);
    expect([...a1, ...b1, ...c1]).toEqual([
      { type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'call_1', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'call_1', argumentsDelta: ARG_B },
    ]);

    // Variant 2: identity frame also carries the first fragment (OpenAI shape).
    const s2 = createOpenAIToolState();
    const a2 = parseOpenAIStreamChunk(tcPayload({ ...IDENTITY, function: { name: 'Read', arguments: ARG_A } }), s2);
    const b2 = parseOpenAIStreamChunk(tcPayload(FRAG_B), s2);
    expect([...a2, ...b2]).toEqual([
      { type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: ARG_A },
      { type: 'tool_call_delta', id: 'call_1', argumentsDelta: ARG_B },
    ]);
  });

  it('order-independence: the identity frame may sit anywhere among the fragments', () => {
    // The three order-preserving permutations of (identity, fragment A, fragment B).
    const orders: ('id' | 'a' | 'b')[][] = [
      ['id', 'a', 'b'],
      ['a', 'id', 'b'],
      ['a', 'b', 'id'],
    ];
    for (const order of orders) {
      const state = createOpenAIToolState();
      const out: StreamChunk[] = [];
      for (const step of order) {
        const delta = step === 'id' ? IDENTITY : step === 'a' ? FRAG_A : FRAG_B;
        out.push(...parseOpenAIStreamChunk(tcPayload(delta), state));
      }
      out.push(...flushPendingToolCalls(state)); // terminal boundary, as the driver does
      const open = assembleByConsumer(out);
      expect([...open.keys()], `order=${order.join(',')}`).toEqual(['call_1']);
      expect(open.get('call_1')?.args, `order=${order.join(',')}`).toBe(FULL_ARGS);
      expect(JSON.parse(String(open.get('call_1')?.args))).toEqual({ path: 'a.txt' });
    }
  });

  it('boundary: fragments keep their WIRE order (swapping A and B is unrecoverable, not silently "fixed")', () => {
    // [B, identity, A]: no parser can know the intended order of two fragments
    // it receives in the wrong order — so the guarantee is "nothing lost, wire
    // order preserved", not "JSON magically repaired".
    const state = createOpenAIToolState();
    const out: StreamChunk[] = [];
    out.push(...parseOpenAIStreamChunk(tcPayload(FRAG_B), state));
    out.push(...parseOpenAIStreamChunk(tcPayload(IDENTITY), state));
    out.push(...parseOpenAIStreamChunk(tcPayload(FRAG_A), state));
    expect(assembleArgs(out)).toBe(ARG_B + ARG_A);
    expect(() => JSON.parse(assembleArgs(out))).toThrow();
  });

  it('identity never arrives: the terminal flush surfaces an explicit call instead of dropping the fragments', () => {
    const state = createOpenAIToolState();
    const before = [...parseOpenAIStreamChunk(tcPayload(FRAG_A), state), ...parseOpenAIStreamChunk(tcPayload(FRAG_B), state)];
    expect(before).toEqual([]); // held in state, not emitted yet — and not discarded

    const flushed = flushPendingToolCalls(state);
    expect(flushed).toEqual([
      { type: 'tool_call_start', id: 'tc_0', name: '', arguments: FULL_ARGS },
      { type: 'tool_call_end', id: 'tc_0' },
    ]);
    // Explicit, never silent: the fragments are intact and the call is visible.
    // The empty name is not a resolvable tool name, so the registry answers with
    // a machine-readable `INVALID_ARGS: unknown tool: …` instead of nothing.
    expect(flushed.filter((c) => c.type === 'tool_call_start').length).toBe(1);
    expect(JSON.parse((flushed[0] as { arguments: string }).arguments)).toEqual({ path: 'a.txt' });
    // Flushing is idempotent — a second boundary cannot re-emit the same call.
    expect(flushPendingToolCalls(state)).toEqual([]);
  });

  it('name-only call that never gets an id is still surfaced at the flush (pre-fix emitted it immediately)', () => {
    const state = createOpenAIToolState();
    // Deferred now (it may still acquire a real id), but never dropped:
    expect(parseOpenAIStreamChunk(tcPayload({ index: 0, function: { name: 'Read' } }), state)).toEqual([]);
    expect(flushPendingToolCalls(state)).toEqual([
      { type: 'tool_call_start', id: 'tc_0', name: 'Read', arguments: '' },
      { type: 'tool_call_end', id: 'tc_0' },
    ]);
  });

  it('frames missing `index` keep the default-0 semantics, before and after the identity arrives', () => {
    const state = createOpenAIToolState();
    const a = parseOpenAIStreamChunk(tcPayload({ function: { arguments: ARG_A } }), state);
    const b = parseOpenAIStreamChunk(tcPayload({ id: 'call_1', function: { name: 'Read' } }), state);
    const c = parseOpenAIStreamChunk(tcPayload({ function: { arguments: ARG_B } }), state);
    expect(a).toEqual([]);
    expect(b).toEqual([{ type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: ARG_A }]);
    expect(c).toEqual([{ type: 'tool_call_delta', id: 'call_1', argumentsDelta: ARG_B }]);
    expect(assembleArgs([...a, ...b, ...c])).toBe(FULL_ARGS);
  });

  it('empty / missing arguments fields never erase buffered fragments or invent data', () => {
    const state = createOpenAIToolState();
    const a = parseOpenAIStreamChunk(tcPayload(FRAG_A), state);
    // Identity frame with an explicit empty arguments string: the buffer survives.
    const b = parseOpenAIStreamChunk(tcPayload({ index: 0, id: 'call_1', function: { name: 'Read', arguments: '' } }), state);
    const c = parseOpenAIStreamChunk(tcPayload(FRAG_B), state);
    // Identity-only frame (no `function` at all): contributes nothing.
    const d = parseOpenAIStreamChunk(tcPayload({ index: 0 }), state);
    expect(a).toEqual([]);
    expect(b).toEqual([{ type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: ARG_A }]);
    expect(c).toEqual([{ type: 'tool_call_delta', id: 'call_1', argumentsDelta: ARG_B }]);
    expect(d).toEqual([]);
    expect(assembleArgs([...a, ...b, ...c, ...d])).toBe(FULL_ARGS);
  });

  it('a frame repeating id+name after the start yields a delta, not a second start (no accumulator overwrite)', () => {
    const state = createOpenAIToolState();
    const a = parseOpenAIStreamChunk(tcPayload({ index: 0, id: 'call_1', function: { name: 'Read', arguments: ARG_A } }), state);
    // Pre-fix: a second tool_call_start ⇒ consumer open.set overwrote ARG_A.
    const b = parseOpenAIStreamChunk(tcPayload({ index: 0, id: 'call_1', function: { name: 'Read', arguments: ARG_B } }), state);
    expect(a).toEqual([{ type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: ARG_A }]);
    expect(b).toEqual([{ type: 'tool_call_delta', id: 'call_1', argumentsDelta: ARG_B }]);
    expect(assembleByConsumer([...a, ...b]).get('call_1')?.args).toBe(FULL_ARGS);
  });

  it('two calls at different indices keep independent buffers (out-of-order per index)', () => {
    const state = createOpenAIToolState();
    // index 1's fragment arrives before any identity; index 0 is identified first.
    const a = parseOpenAIStreamChunk(tcPayload({ index: 1, function: { arguments: '{"y":' } }), state);
    const b = parseOpenAIStreamChunk(tcPayload({ index: 0, id: 'c0', function: { name: 'Read', arguments: '{"x":' } }), state);
    const c = parseOpenAIStreamChunk(tcPayload({ index: 1, id: 'c1', function: { name: 'Glob' } }), state);
    const d = parseOpenAIStreamChunk(tcPayload({ index: 1, function: { arguments: '1}' } }), state);
    expect(a).toEqual([]);
    expect(b).toEqual([{ type: 'tool_call_start', id: 'c0', name: 'Read', arguments: '{"x":' }]);
    expect(c).toEqual([{ type: 'tool_call_start', id: 'c1', name: 'Glob', arguments: '{"y":' }]);
    expect(d).toEqual([{ type: 'tool_call_delta', id: 'c1', argumentsDelta: '1}' }]);
    const open = assembleByConsumer([...a, ...b, ...c, ...d]);
    expect(open.get('c0')?.args).toBe('{"x":');
    expect(open.get('c1')?.args).toBe('{"y":1}');
    expect(JSON.parse(String(open.get('c1')?.args))).toEqual({ y: 1 });
  });
});

describe('OpenAIStreamParser — out-of-order identity (Round 46, driver)', () => {
  const ARG_A = '{"path":"';
  const ARG_B = 'a.txt"}';
  const FULL_ARGS = '{"path":"a.txt"}';
  const IDENTITY = { index: 0, id: 'call_1', function: { name: 'Read' } };
  const FRAG_A = { index: 0, function: { arguments: ARG_A } };
  const FRAG_B = { index: 0, function: { arguments: ARG_B } };

  it('REPRO through the driver: arguments-first lines still yield the complete, valid call', () => {
    const p = new OpenAIStreamParser();
    const chunks: StreamChunk[] = [];
    chunks.push(...p.feed(tcLine(FRAG_A)));
    chunks.push(...p.feed(tcLine(IDENTITY)));
    chunks.push(...p.feed(tcLine(FRAG_B)));
    chunks.push(...p.feed('data: [DONE]'));

    // Pre-fix this was start(arguments="") + delta(ARG_B) ⇒ assembled = ARG_B only.
    expect(chunks.map((c) => c.type)).toEqual([
      'message_start',
      'tool_call_start',
      'tool_call_delta',
      'tool_call_end',
      'message_end',
    ]);
    const start = chunks.find((c) => c.type === 'tool_call_start') as { arguments: string };
    expect(start.arguments).toBe(ARG_A);
    expect(JSON.parse(assembleArgs(chunks))).toEqual({ path: 'a.txt' });
    expect((chunks.find((c) => c.type === 'tool_call_end') as { id: string }).id).toBe('call_1');
  });

  it('negative control through the driver: normal order keeps the exact chunk sequence', () => {
    const p = new OpenAIStreamParser();
    const chunks: StreamChunk[] = [];
    chunks.push(...p.feed(tcLine(IDENTITY)));
    chunks.push(...p.feed(tcLine(FRAG_A)));
    chunks.push(...p.feed(tcLine(FRAG_B)));
    chunks.push(...p.feed('data: [DONE]'));
    expect(chunks).toEqual([
      { type: 'message_start' },
      { type: 'tool_call_start', id: 'call_1', name: 'Read', arguments: '' },
      { type: 'tool_call_delta', id: 'call_1', argumentsDelta: ARG_A },
      { type: 'tool_call_delta', id: 'call_1', argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: 'call_1' },
      { type: 'message_end' },
    ]);
  });

  it('fragments buffered before the identity survive an interleaved non-tool frame', () => {
    const p = new OpenAIStreamParser();
    const chunks: StreamChunk[] = [];
    chunks.push(...p.feed(tcLine(FRAG_A))); // identity not yet seen ⇒ mid-stream boundary runs
    chunks.push(...p.feed(`data: ${payload({ content: 'thinking' })}`)); // text frame ⇒ another mid-stream boundary
    chunks.push(...p.feed(tcLine(IDENTITY)));
    chunks.push(...p.feed(tcLine(FRAG_B)));
    chunks.push(...p.feed('data: [DONE]'));
    expect(chunks.map((c) => c.type)).toEqual([
      'message_start',
      'text_delta',
      'tool_call_start',
      'tool_call_delta',
      'tool_call_end',
      'message_end',
    ]);
    expect(JSON.parse(assembleArgs(chunks))).toEqual({ path: 'a.txt' });
  });

  it('EOF without [DONE] (finish()) surfaces a never-identified call explicitly, after the fragments', () => {
    const p = new OpenAIStreamParser();
    const chunks: StreamChunk[] = [];
    chunks.push(...p.feed(tcLine(FRAG_A)));
    chunks.push(...p.feed(tcLine(FRAG_B)));
    chunks.push(...p.finish());
    // Pre-fix: message_start + message_end only — both fragments vanished silently.
    expect(chunks).toEqual([
      { type: 'message_start' },
      { type: 'tool_call_start', id: 'tc_0', name: '', arguments: FULL_ARGS },
      { type: 'tool_call_end', id: 'tc_0' },
      { type: 'message_end' },
    ]);
  });

  it('finish() is not double-reported when the stream already ended via [DONE]', () => {
    const p = new OpenAIStreamParser();
    p.feed(tcLine(FRAG_A));
    p.feed('data: [DONE]');
    expect(p.finish()).toEqual([]);
  });

  it('id-first identity split across a mid-stream boundary still completes, without a stray tool_call_end', () => {
    const p = new OpenAIStreamParser();
    const chunks: StreamChunk[] = [];
    chunks.push(...p.feed(tcLine({ index: 0, id: 'call_1', function: { arguments: ARG_A } }))); // id + fragment, no name
    chunks.push(...p.feed(`data: ${payload({ content: 'x' })}`)); // non-tool frame ⇒ mid-stream boundary
    chunks.push(...p.feed(tcLine({ index: 0, function: { name: 'Read', arguments: ARG_B } }))); // name arrives later
    chunks.push(...p.feed('data: [DONE]'));

    // A boundary may only close calls that actually started: emitting an end for
    // the still-identity-less index 0 here would be a `tool_call_end` with no
    // matching start, and clearing its id is how the identity got lost pre-fix.
    expect(chunks.map((c) => c.type)).toEqual([
      'message_start',
      'text_delta',
      // 帧 3 同时带来 name 与 ARG_B ⇒ 身份到齐：ARG_B 与缓存里的 ARG_A 一起并进
      // `tool_call_start.arguments`（即下面 `start.arguments === FULL_ARGS` 的含义），
      // 故**不再**单独产出 tool_call_delta —— 若此处仍期望一个 delta，ARG_B 会被计两次，
      // assembleArgs 的 JSON 断言也会跟着崩。
      'tool_call_start',
      'tool_call_end',
      'message_end',
    ]);
    const start = chunks.find((c) => c.type === 'tool_call_start') as { id: string; arguments: string };
    expect(start.id).toBe('call_1');
    expect(start.arguments).toBe(FULL_ARGS); // pre-fix: '' (buffer + id wiped by the boundary)
    expect(JSON.parse(assembleArgs(chunks))).toEqual({ path: 'a.txt' });
  });
});

// ---------------------------------------------------------------------------
// Round 69 — the OpenAI counterpart of the Anthropic Round 68 fix: a repeated
// tool-call frame carrying a DIFFERENT id for an index that has ALREADY started.
//
// The pre-fix parser registered the repeat's id (`if (tc.id) state.idByIndex.set(…)`
// ran unconditionally, even for a started index). `idByIndex` is the ADDRESS map
// for the whole remainder of the call — the continuation `tool_call_delta`s and
// the `tool_call_end`s the driver derives from that very map — so the rewrite
// re-addressed the entire tail to an id no consumer ever opened:
//   - the repeat's fragment went out as `tool_call_delta{id: call_2}` while the
//     consumer's accumulator is keyed by the START's id (`AgentLoop.consumeStream`
//     `open.get(chunk.id)`, `open` filled by `open.set(chunk.id, …)` at the start)
//     ⇒ that frame's arguments (and every fragment after it) landed NOWHERE;
//   - the call's `tool_call_end` came out as `call_2` — an ORPHAN end (no start
//     ever opened `call_2`) — while `call_1` never received an end of its own and
//     was closed only by AgentLoop's stream-boundary fallback
//     (AgentLoop.ts:661-665), i.e. with a truncated argument string.
// The fix is "the first start freezes the identity": a frame arriving for a
// started index may neither re-emit `tool_call_start` (Round 46) nor rewrite the
// id/name it was registered with; the folded fragment is addressed to that
// frozen id.
//
// The guard is deliberately `startedIndexes.has(index)` — the same state the
// Anthropic side uses — and NOT "any identity was registered". OpenAI splits
// `id` and `name` across DIFFERENT frames (the identity-late wire order Round 46
// handles) and only emits the start once BOTH are known, so a started index is
// exactly "a consumer-side accumulator is open under `idByIndex.get(index)`".
// Freezing on "any identity registered" would freeze the MISSING half of an
// identity-late call and send it back to the placeholder-id (`tc_<index>`) flush
// — case ③ below is the lock that makes that mistake red.
//
// REACHABILITY of the shape under test (delivered as part of this card, not
// assumed): the canonical `api.openai.com` wire announces a call's identity ONCE
// (first delta only), so an upstream that is byte-faithful to it will not produce
// this frame. It is reachable on the population this parser already commits to —
// the Round 46 header names "gateways/proxies that reorder frames, and some
// 'OpenAI-compatible' implementations" — for any peer that re-sends the identity
// on later deltas: the frame is schema-valid (the schema only says the id is set
// on the first chunk; it never says it is repeated verbatim afterwards), nothing
// in this parser validates index↔id stability, and an existing case pins the
// SAME-ID variant of the repeat as a shape that must be handled
// (`a frame repeating id+name after the start…` above). The different-id variant
// is the same frame with a different string; it is also reachable within a SINGLE
// frame, by one `delta.tool_calls[]` array carrying two entries with the same
// `index` — a purely structural shape that needs no particular third-party wire
// order; case ① exercises it as its second variant.
// ---------------------------------------------------------------------------

describe('parseOpenAIStreamChunk / OpenAIStreamParser — 重复 tool-call 帧带不同 id（Round 69）', () => {
  const ORIG_ID = 'call_1';
  /** The id the repeated frame carries — deliberately NOT the first start's. */
  const DUP_ID = 'call_2';
  const ARG_A = '{"path":"';
  const ARG_B = 'a.txt"}';
  const FULL_ARGS = '{"path":"a.txt"}';

  /** One `data: {json}` SSE transport line for a frame carrying `choices[0].delta`. */
  const frame = (delta: unknown, finish?: string): string =>
    'data: ' + JSON.stringify({ choices: [{ delta, ...(finish !== undefined ? { finish_reason: finish } : {}) }] });
  const usageFrame = (usage: unknown): string => 'data: ' + JSON.stringify({ choices: [], usage });

  const feedAll = (p: OpenAIStreamParser, lines: readonly string[]): StreamChunk[] => {
    const out: StreamChunk[] = [];
    for (const l of lines) out.push(...p.feed(l));
    return out;
  };

  it('①-a 重复帧（不同 id）的 arguments 挂在**原 id** 的 delta 上（删掉 identityFrozen ⇒ 挂新 id、消费侧收不到 ⇒ 红）', () => {
    const state = createOpenAIToolState();
    const a = parseOpenAIStreamChunk(
      tcPayload({ index: 0, id: ORIG_ID, function: { name: 'Read', arguments: ARG_A } }),
      state,
    );
    const b = parseOpenAIStreamChunk(
      tcPayload({ index: 0, id: DUP_ID, function: { name: 'Glob', arguments: ARG_B } }),
      state,
    );

    expect(a).toEqual([{ type: 'tool_call_start', id: ORIG_ID, name: 'Read', arguments: ARG_A }]);
    // 判别线：删掉 `identityFrozen`（恢复无条件 `set`）⇒ 这里变成 id: 'call_2'。
    expect(b).toEqual([{ type: 'tool_call_delta', id: ORIG_ID, argumentsDelta: ARG_B }]);

    // 消费侧实际拿到的东西：只有一个调用，且它**收到了**重复帧的片段。
    const open = assembleByConsumer([...a, ...b]);
    expect([...open.keys()]).toEqual([ORIG_ID]);
    expect(open.has(DUP_ID)).toBe(false); // 从没有 start 打开过这个 id
    expect(open.get(ORIG_ID)?.args).toBe(FULL_ARGS);
    expect(JSON.parse(String(open.get(ORIG_ID)?.args))).toEqual({ path: 'a.txt' });

    // 旧实现的轨迹（逐字转录，再用**同一个**消费侧算法重放）：不依赖"修复不存在"也能
    // 证明损失 —— 重复帧的片段挂在没人打开过的新 id 上，于是谁也没收到。
    const preFix: StreamChunk[] = [
      { type: 'tool_call_start', id: ORIG_ID, name: 'Read', arguments: ARG_A },
      { type: 'tool_call_delta', id: DUP_ID, argumentsDelta: ARG_B }, // ← 挂在新 id 上
    ];
    const preFixOpen = assembleByConsumer(preFix);
    expect([...preFixOpen.keys()]).toEqual([ORIG_ID]);
    expect(preFixOpen.has(DUP_ID)).toBe(false);
    expect(String(preFixOpen.get(ORIG_ID)?.args)).toBe(ARG_A); // ← ARG_B 丢了
    expect(() => JSON.parse(String(preFixOpen.get(ORIG_ID)?.args))).toThrow();

    // 同一帧内的变体：一个 `delta.tool_calls[]` 数组里两个同 `index` 的条目 —— 这是**结构性
    // 可达**的（解析器按数组顺序逐条处理，schema 不禁止同 index 出现两次），无需依赖任何
    // 第三方网关的线序。两条条目走的是同一条修复线：第二条被冻结在首个 start 的身份上。
    const s3 = createOpenAIToolState();
    const c = parseOpenAIStreamChunk(
      payload({
        tool_calls: [
          { index: 0, id: ORIG_ID, function: { name: 'Read', arguments: ARG_A } },
          { index: 0, id: DUP_ID, function: { name: 'Glob', arguments: ARG_B } },
        ],
      }),
      s3,
    );
    expect(c).toEqual([
      { type: 'tool_call_start', id: ORIG_ID, name: 'Read', arguments: ARG_A },
      { type: 'tool_call_delta', id: ORIG_ID, argumentsDelta: ARG_B }, // ← pre-fix: id 'call_2'
    ]);
  });

  it('①-b 驱动路径：tool_call_end 也回到**原 id**（删掉冻结 ⇒ 孤儿 end、原 id 永无 end ⇒ 红）', () => {
    const p = new OpenAIStreamParser();
    const chunks = feedAll(p, [
      tcLine({ index: 0, id: ORIG_ID, function: { name: 'Read', arguments: ARG_A } }),
      tcLine({ index: 0, id: DUP_ID, function: { name: 'Glob', arguments: ARG_B } }),
      'data: [DONE]',
    ]);

    expect(chunks).toEqual([
      { type: 'message_start' },
      { type: 'tool_call_start', id: ORIG_ID, name: 'Read', arguments: ARG_A },
      { type: 'tool_call_delta', id: ORIG_ID, argumentsDelta: ARG_B },
      // ← 旧实现挂 DUP_ID（孤儿 end）：删掉 `identityFrozen` 或把 closeToolCalls 的
      //    id 源改回"帧自己的 id"，这一行立刻红。
      { type: 'tool_call_end', id: ORIG_ID },
      { type: 'message_end' },
    ]);

    // 不变式直说，免得读者去 diff 数组：
    expect(chunks.filter((c) => c.type === 'tool_call_start')).toHaveLength(1); // 仍然不重发 start（Round 46）
    expect(chunks.filter((c) => c.type === 'tool_call_end')).toEqual([{ type: 'tool_call_end', id: ORIG_ID }]);
    expect(chunks.some((c) => JSON.stringify(c).includes(DUP_ID))).toBe(false); // 重复帧的 id 全流不出现
    expect(JSON.parse(assembleArgs(chunks))).toEqual({ path: 'a.txt' });
    expect(assembleByConsumer(chunks).size).toBe(1);

    // 旧实现的驱动级轨迹：end 是孤儿，原 id 只能靠 AgentLoop 的流末兜底收场。
    const preFix: StreamChunk[] = [
      { type: 'message_start' },
      { type: 'tool_call_start', id: ORIG_ID, name: 'Read', arguments: ARG_A },
      { type: 'tool_call_delta', id: DUP_ID, argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: DUP_ID }, // ← 孤儿：没有 start 打开过它
      { type: 'message_end' },
    ];
    expect(preFix.some((c) => c.type === 'tool_call_end' && c.id === ORIG_ID)).toBe(false); // 原 id 无 end
    expect(preFix.some((c) => c.type === 'tool_call_start' && c.id === DUP_ID)).toBe(false);
    // 片段丢失必须用**按 id 作用域**的组装器证明：`assembleArgs` 是不分 id 的扁平拼接，
    // 它会把 DUP_ID 上的 ARG_B 也拼进来 ⇒ 结构上表达不了"丢失"（原先这里用它断言 `toBe(ARG_A)`，
    // 必然得到 ARG_A+ARG_B ⇒ 红；这是用例自己的错，与实现无关）。
    // 消费侧（AgentLoop.consumeStream）是按 id 建表并在 `open.get(c.id)` 命中才累加的，
    // 所以正确的证据是：原 id 只拿到 ARG_A，而 DUP_ID 上根本没有被打开过的累加器。
    expect(assembleByConsumer(preFix).get(ORIG_ID)?.args).toBe(ARG_A); // 兜底 flush 只能拿半截参数收尾
    expect(assembleByConsumer(preFix).has(DUP_ID)).toBe(false); // 重复帧的片段落在了没人打开的 id 上
  });

  it('② 负对照：规范流（每 index 恰好一次 start）逐字不变 —— 删掉修复也必须绿', () => {
    // 负对照的意义：它钉的是"修复的适用面"，不是修复本身 ⇒ 有修复/无修复都必须绿
    // （`identityFrozen` 在良构线序上永不涉及已 started 的 index，是死代码分支）。
    const p = new OpenAIStreamParser();
    const chunks = feedAll(p, [
      frame({ role: 'assistant', content: 'Reading ' }),
      frame({ content: 'two files' }),
      tcLine({ index: 0, id: 'call_a', type: 'function', function: { name: 'Read', arguments: '{"path":"a' } }),
      tcLine({ index: 0, function: { arguments: '.txt"}' } }),
      tcLine({ index: 1, id: 'call_b', type: 'function', function: { name: 'Glob', arguments: '{"pattern":"' } }),
      tcLine({ index: 1, function: { arguments: '*.ts"}' } }),
      frame({}, 'tool_calls'),
      usageFrame({ prompt_tokens: 11, completion_tokens: 9 }),
      'data: [DONE]',
    ]);

    expect(chunks).toEqual([
      { type: 'message_start' },
      { type: 'text_delta', text: 'Reading ' },
      { type: 'text_delta', text: 'two files' },
      { type: 'tool_call_start', id: 'call_a', name: 'Read', arguments: '{"path":"a' },
      { type: 'tool_call_delta', id: 'call_a', argumentsDelta: '.txt"}' },
      { type: 'tool_call_start', id: 'call_b', name: 'Glob', arguments: '{"pattern":"' },
      { type: 'tool_call_delta', id: 'call_b', argumentsDelta: '*.ts"}' },
      { type: 'tool_call_end', id: 'call_a' },
      { type: 'tool_call_end', id: 'call_b' },
      { type: 'usage', inputTokens: 11, outputTokens: 9, cacheReadTokens: undefined },
      { type: 'message_end', finishReason: 'tool_calls' },
    ]);
  });

  it('③ 负对照：identity-late（先 id 后 name / 先 name 后 id 的补全）逐字不变 —— 冻结条件取成"任何身份已登记"即红', () => {
    // (a) id-first / name-later：补全帧到来时该 index **尚未 started** ⇒ 不得被冻结。
    const s1 = createOpenAIToolState();
    const a1 = parseOpenAIStreamChunk(tcPayload({ index: 0, id: ORIG_ID, function: { arguments: ARG_A } }), s1);
    const b1 = parseOpenAIStreamChunk(tcPayload({ index: 0, function: { name: 'Read', arguments: ARG_B } }), s1);
    expect(a1).toEqual([]);
    // 判别线：把 `identityFrozen` 改成"idByIndex/nameByIndex 任一已登记" ⇒ 这里 name 写不进去、
    // 永不出 start（下面 flush 会吐 `tc_0`），本行与下一行同时红。
    expect(b1).toEqual([{ type: 'tool_call_start', id: ORIG_ID, name: 'Read', arguments: FULL_ARGS }]);
    expect(flushPendingToolCalls(s1)).toEqual([]); // 身份到齐 ⇒ 没有占位 id 的第二次调用
    expect(assembleArgs([...a1, ...b1])).toBe(FULL_ARGS);

    // (b) name-first / id-later：同一把锁的另一半。
    const s2 = createOpenAIToolState();
    const a2 = parseOpenAIStreamChunk(tcPayload({ index: 0, function: { name: 'Read', arguments: ARG_A } }), s2);
    const b2 = parseOpenAIStreamChunk(tcPayload({ index: 0, id: ORIG_ID, function: { arguments: ARG_B } }), s2);
    expect(a2).toEqual([]);
    expect(b2).toEqual([{ type: 'tool_call_start', id: ORIG_ID, name: 'Read', arguments: FULL_ARGS }]);
    expect(flushPendingToolCalls(s2)).toEqual([]);
    const open2 = assembleByConsumer([...a2, ...b2]);
    expect([...open2.keys()]).toEqual([ORIG_ID]); // 恰好一个调用，真 id
    expect(open2.get(ORIG_ID)?.args).toBe(FULL_ARGS);
  });

  it('④ 负对照：同 id 的重复帧（Round 64 形态 C）逐字不变；且冻结**只**作用于已 started 的 index', () => {
    // (a) 同 id 重复：冻结对它是 no-op（写回去的是同一批字符串），行为与 Round 46/64 一致。
    const p = new OpenAIStreamParser();
    const chunks = feedAll(p, [
      tcLine({ index: 0, id: ORIG_ID, function: { name: 'Read', arguments: ARG_A } }),
      tcLine({ index: 0, id: ORIG_ID, function: { name: 'Read', arguments: ARG_B } }),
      'data: [DONE]',
    ]);
    expect(chunks).toEqual([
      { type: 'message_start' },
      { type: 'tool_call_start', id: ORIG_ID, name: 'Read', arguments: ARG_A },
      { type: 'tool_call_delta', id: ORIG_ID, argumentsDelta: ARG_B },
      { type: 'tool_call_end', id: ORIG_ID },
      { type: 'message_end' },
    ]);

    // (b) 反向锁：冻结不得"跨 index"生效。index 0 已 started 之后，index 1 的**首个**身份帧
    //     仍必须登记自己的 id（把守卫写成"已有任何调用 started 就冻结"⇒ 下面第二行红，
    //     index 1 会退化成占位 id 的流末 flush）。
    const s = createOpenAIToolState();
    const first = parseOpenAIStreamChunk(tcPayload({ index: 0, id: 'c0', function: { name: 'Read', arguments: '{"x":' } }), s);
    const second = parseOpenAIStreamChunk(tcPayload({ index: 1, id: 'c1', function: { name: 'Glob', arguments: '{"y":' } }), s);
    const third = parseOpenAIStreamChunk(tcPayload({ index: 0, function: { arguments: '1}' } }), s);
    const fourth = parseOpenAIStreamChunk(tcPayload({ index: 1, function: { arguments: '2}' } }), s);
    expect(first).toEqual([{ type: 'tool_call_start', id: 'c0', name: 'Read', arguments: '{"x":' }]);
    expect(second).toEqual([{ type: 'tool_call_start', id: 'c1', name: 'Glob', arguments: '{"y":' }]);
    expect(third).toEqual([{ type: 'tool_call_delta', id: 'c0', argumentsDelta: '1}' }]);
    expect(fourth).toEqual([{ type: 'tool_call_delta', id: 'c1', argumentsDelta: '2}' }]);
    const open = assembleByConsumer([...first, ...second, ...third, ...fourth]);
    expect(JSON.parse(String(open.get('c0')?.args))).toEqual({ x: 1 });
    expect(JSON.parse(String(open.get('c1')?.args))).toEqual({ y: 2 });
  });
});