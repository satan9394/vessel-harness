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