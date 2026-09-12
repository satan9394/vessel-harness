import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider, AnthropicStreamParser } from '@vessel/llm';
import type { MockScriptEntry } from '@vessel/llm';
import { EventBus, Session, AgentLoop } from '@vessel/core';
import type { ToolResultOutcome } from '@vessel/core';
import type {
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  StreamChunk,
  ToolCall,
} from '@vessel/shared';
import type { ModelStreamEndPayload, ModelStreamStartPayload } from '@vessel/shared';

// ---------------------------------------------------------------------------
// Lightweight loop harness — no fs/tools stack needed: tool calls are answered
// by a stub runTool, so the streaming behavior itself is the unit under test.
// ---------------------------------------------------------------------------

interface Harness {
  session: Session;
  bus: EventBus;
  loop: AgentLoop;
}

async function makeLoop(
  dir: string,
  provider: ChatProvider,
  opts: {
    runTool?: (call: ToolCall) => Promise<ToolResultOutcome>;
    llmRetry?: { maxRetries?: number };
  } = {},
): Promise<Harness> {
  const session = await Session.open({ workspaceRoot: dir, sessionId: 'stream' });
  const bus = new EventBus();
  const loop = new AgentLoop({
    session,
    bus,
    provider,
    model: 'm',
    buildContext: async () => ({
      model: 'm',
      messages: [
        { role: 'system', content: 'test' },
        ...session.surface().map((r) => {
          if (r.type === 'user/message') return { role: 'user' as const, content: r.content };
          if (r.type === 'assistant/message') return { role: 'assistant' as const, content: r.content };
          return {
            role: 'tool' as const,
            content: r.type === 'tool/result' ? (r.content ?? '') : '',
            toolCallId: (r as { toolCallId: string }).toolCallId,
          };
        }),
      ],
      tools: [],
      estimateTokens: 10,
    }),
    runTool: opts.runTool ?? (async (call: ToolCall): Promise<ToolResultOutcome> => {
      void call;
      return { content: 'GOLD', meta: {} };
    }),
    getVisibleTools: () => [],
    llmRetry: opts.llmRetry,
  });
  return { session, bus, loop };
}

/** Watch the model_stream_* family and llm_retry on a bus. */
function watch(bus: EventBus) {
  const starts: ModelStreamStartPayload[] = [];
  const deltas: { turnId: string; step: number; requestId: string; chunk: StreamChunk }[] = [];
  const ends: ModelStreamEndPayload[] = [];
  const retries: { turnId: string; step: number; attempt: number; errorClass: string }[] = [];
  const afterModel: { turnId: string; step: number; usage: unknown }[] = [];
  bus.on('model_stream_start', (p) => {
    starts.push(p as ModelStreamStartPayload);
  });
  bus.on('model_stream_delta', (p) => {
    deltas.push(p as { turnId: string; step: number; requestId: string; chunk: StreamChunk });
  });
  bus.on('model_stream_end', (p) => {
    ends.push(p as ModelStreamEndPayload);
  });
  bus.on('llm_retry', (p) => {
    retries.push(p as { turnId: string; step: number; attempt: number; errorClass: string });
  });
  bus.on('after_model', (p) => {
    afterModel.push(p as { turnId: string; step: number; usage: unknown });
  });
  return { starts, deltas, ends, retries, afterModel };
}

/**
 * Scripted streaming provider: phases selected by how many tool results the
 * request already carries (phase 0 = first model call). `chat()` throws — it
 * must never be invoked while the stream-first path is under test.
 */
class PhasedStreamProvider implements ChatProvider {
  readonly id = 'phased-stream';
  constructor(private readonly phases: ((request: ChatRequest) => StreamChunk[])[]) {}

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const toolResults = request.messages.filter((m) => m.role === 'tool').length;
    const phase = this.phases[Math.min(toolResults, this.phases.length - 1)]!;
    yield* phase(request);
  }
}

function startChunk(model = 'm'): StreamChunk {
  return { type: 'message_start', model };
}
function textChunk(text: string): StreamChunk {
  return { type: 'text_delta', text };
}
function usageChunk(inputTokens: number, outputTokens: number): StreamChunk {
  return { type: 'usage', inputTokens, outputTokens };
}
function endChunk(finishReason: string): StreamChunk {
  return { type: 'message_end', finishReason };
}

describe('AgentLoop model call — stream first (task 049)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-stream-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('stream path: pure-text MockProvider.stream stops the turn with the same finalText as chat()', async () => {
    const provider = new MockProvider([{ when: /hello/i, response: { text: 'world' } }], { model: 'm' });
    const { session, loop } = await makeLoop(dir, provider);
    const result = await loop.runTurn('say hello');
    expect(result.kind).toBe('success');
    expect(result.steps).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(result.finalText).toBe('world');
    const surface = session.surface();
    expect(surface.some((r) => r.type === 'assistant/message' && r.content === 'world')).toBe(true);
    await session.close();
  });

  it('stream path: emits model_stream_start → delta → end with stable shapes and a shared requestId', async () => {
    const provider = new MockProvider([{ when: /hello/i, response: { text: 'world' } }], { model: 'm' });
    const { session, bus, loop } = await makeLoop(dir, provider);
    const { starts, deltas, ends } = watch(bus);
    const result = await loop.runTurn('say hello');

    expect(starts).toHaveLength(1);
    expect(starts[0]!).toEqual({ turnId: result.turnId, step: 1, requestId: `req_${result.turnId}_step1`, model: 'm' });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!).toMatchObject({ turnId: result.turnId, step: 1, requestId: `req_${result.turnId}_step1` });
    expect(deltas[0]!.chunk).toEqual({ type: 'text_delta', text: 'world' });
    expect(ends).toHaveLength(1);
    expect(ends[0]!).toEqual({
      turnId: result.turnId,
      step: 1,
      requestId: `req_${result.turnId}_step1`,
      finishReason: 'stop',
      text: 'world',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    // one start per end, in order
    expect(starts.length).toBe(ends.length);
    await session.close();
  });

  it('stream path: text split across multiple text_delta chunks accumulates into one finalText', async () => {
    const provider = new PhasedStreamProvider([
      () => [startChunk(), textChunk('Hel'), textChunk('lo, '), textChunk('world!'), usageChunk(10, 5), endChunk('stop')],
    ]);
    const { session, bus, loop } = await makeLoop(dir, provider);
    const { deltas } = watch(bus);
    const result = await loop.runTurn('multi');
    expect(result.finalText).toBe('Hello, world!');
    expect(deltas.map((d) => (d.chunk.type === 'text_delta' ? d.chunk.text : '?'))).toEqual(['Hel', 'lo, ', 'world!']);
    await session.close();
  });

  it('stream path: tool-call chunks drive dispatch; assistant/attempt + tool/result + after_model usage match chat() semantics', async () => {
    const script: MockScriptEntry[] = [
      { when: /read|阅读/i, ifNoToolResult: true, response: { toolCalls: [{ name: 'Stub', arguments: { path: 'README.md' } }] } },
      { when: /.*/, response: { text: 'content: {last_tool_result}' } },
    ];
    const provider = new MockProvider(script, { model: 'm' });
    const dispatched: ToolCall[] = [];
    const { session, bus, loop } = await makeLoop(dir, provider, {
      runTool: async (call) => {
        dispatched.push(call);
        return { content: 'GOLD', meta: {} };
      },
    });
    const { afterModel } = watch(bus);
    const result = await loop.runTurn('请阅读 README.md');

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!).toEqual({ toolCallId: 'tc_mock_1', toolName: 'Stub', arguments: { path: 'README.md' } });
    expect(result.toolCalls).toBe(1);
    expect(result.finalText).toBe('content: GOLD');

    const records = session.replay();
    expect(records.some((r) => r.type === 'assistant/attempt' && (r as { toolCalls: unknown[] }).toolCalls.length === 1)).toBe(true);
    expect(records.some((r) => r.type === 'tool/result' && r.content === 'GOLD')).toBe(true);
    // each step emits after_model with the same usage chat() would have reported
    expect(afterModel).toHaveLength(2);
    for (const am of afterModel) expect(am.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    await session.close();
  });

  it('stream path: tool-call arguments assembled across tool_call_delta fragments (start arg + N deltas)', async () => {
    const provider = new PhasedStreamProvider([
      () => [
        startChunk(),
        { type: 'tool_call_start', id: 'tc_1', name: 'Stub', arguments: '' },
        { type: 'tool_call_delta', id: 'tc_1', argumentsDelta: '{"path":"' },
        { type: 'tool_call_delta', id: 'tc_1', argumentsDelta: 'README.md"}' },
        { type: 'tool_call_end', id: 'tc_1' },
        usageChunk(100, 20),
        endChunk('tool_calls'),
      ],
      () => [startChunk(), textChunk('read done'), usageChunk(100, 20), endChunk('stop')],
    ]);
    const dispatched: ToolCall[] = [];
    const { session, bus, loop } = await makeLoop(dir, provider, {
      runTool: async (call) => {
        dispatched.push(call);
        return { content: 'file', meta: {} };
      },
    });
    const { ends } = watch(bus);
    const result = await loop.runTurn('read it');

    expect(dispatched).toHaveLength(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.arguments).toEqual({ path: 'README.md' });
    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('read done');
    // first (tool) step's terminal event carries the assembled call; last one is text-only
    expect(ends[0]!.toolCalls).toEqual([{ id: 'tc_1', name: 'Stub', arguments: { path: 'README.md' } }]);
    expect(ends[1]!.text).toBe('read done');
    await session.close();
  });

  it('stream path: interleaved parallel tool calls finalize in start order with correct arguments', async () => {
    const provider = new PhasedStreamProvider([
      () => [
        startChunk(),
        { type: 'tool_call_start', id: 'tc_a', name: 'Stub', arguments: '{"x":' },
        { type: 'tool_call_start', id: 'tc_b', name: 'Stub', arguments: '{"y":' },
        { type: 'tool_call_delta', id: 'tc_a', argumentsDelta: '"a"}' },
        { type: 'tool_call_delta', id: 'tc_b', argumentsDelta: '"b"}' },
        { type: 'tool_call_end', id: 'tc_a' },
        { type: 'tool_call_end', id: 'tc_b' },
        usageChunk(100, 20),
        endChunk('tool_calls'),
      ],
      () => [startChunk(), textChunk('all done'), usageChunk(100, 20), endChunk('stop')],
    ]);
    const dispatched: ToolCall[] = [];
    const { session, bus, loop } = await makeLoop(dir, provider, {
      runTool: async (call) => {
        dispatched.push(call);
        return { content: 'ok', meta: {} };
      },
    });
    const { ends } = watch(bus);
    const result = await loop.runTurn('two tools');

    expect(dispatched.map((c) => c.toolCallId)).toEqual(['tc_a', 'tc_b']);
    expect(dispatched.map((c) => c.arguments)).toEqual([{ x: 'a' }, { y: 'b' }]);
    expect(result.kind).toBe('success');
    expect(ends[0]!.toolCalls.map((t: ChatToolCall) => t.id)).toEqual(['tc_a', 'tc_b']);
    await session.close();
  });

  it('stream path: usage split across frames merges per-field (Anthropic-style) into model_stream_end + after_model', async () => {
    const provider = new PhasedStreamProvider([
      () => [
        startChunk(),
        textChunk('merged'),
        { type: 'usage', inputTokens: 100 }, // first frame: input only
        { type: 'usage', outputTokens: 20 }, // second frame: output only
        { type: 'usage', cacheReadTokens: 5 },
        endChunk('stop'),
      ],
    ]);
    const { session, bus, loop } = await makeLoop(dir, provider);
    const { ends, afterModel } = watch(bus);
    await loop.runTurn('usage');
    expect(ends[0]!.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 });
    expect(afterModel[0]!.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 });
    await session.close();
  });

  it('stream path: cacheCreationTokens folds per-field and survives a later frame that omits it (task 099)', async () => {
    const provider = new PhasedStreamProvider([
      () => [
        startChunk(),
        textChunk('cached'),
        // Anthropic message_start frame: input + cache write + cache read
        { type: 'usage', inputTokens: 12, cacheReadTokens: 1024, cacheCreationTokens: 2095 },
        // message_delta frame: output only — must NOT clobber cacheCreationTokens
        { type: 'usage', outputTokens: 5 },
        endChunk('stop'),
      ],
    ]);
    const { session, bus, loop } = await makeLoop(dir, provider);
    const { ends, afterModel } = watch(bus);
    await loop.runTurn('usage');
    expect(ends[0]!.usage).toEqual({ inputTokens: 12, outputTokens: 5, cacheReadTokens: 1024, cacheCreationTokens: 2095 });
    expect(afterModel[0]!.usage).toEqual({ inputTokens: 12, outputTokens: 5, cacheReadTokens: 1024, cacheCreationTokens: 2095 });
    await session.close();
  });

  it('fallback: provider without stream() uses chat() and emits no model_stream_* events', async () => {
    let chatCalls = 0;
    const chatOnly: ChatProvider = {
      id: 'chat-only',
      async chat(): Promise<ChatResponse> {
        chatCalls += 1;
        return { content: 'fallback answer', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const { session, bus, loop } = await makeLoop(dir, chatOnly);
    const { starts, deltas, ends } = watch(bus);
    const result = await loop.runTurn('hello');
    expect(chatCalls).toBe(1);
    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('fallback answer');
    expect(starts).toHaveLength(0);
    expect(deltas).toHaveLength(0);
    expect(ends).toHaveLength(0);
    await session.close();
  });

  it('stream path: retryable mid-stream error → llm_retry then successful retry attempt (start→end pairing per attempt)', async () => {
    let attempts = 0;
    const flaky: ChatProvider = {
      id: 'flaky',
      async chat(): Promise<ChatResponse> {
        throw new Error('chat() must not be called when provider.stream is present');
      },
      async *stream(): AsyncGenerator<StreamChunk> {
        attempts += 1;
        if (attempts === 1) throw new Error('stream timeout mid-flight');
        yield startChunk();
        yield textChunk('recovered');
        yield usageChunk(7, 3);
        yield endChunk('stop');
      },
    };
    const { session, bus, loop } = await makeLoop(dir, flaky, { llmRetry: { maxRetries: 3 } });
    const { starts, ends, retries } = watch(bus);
    const result = await loop.runTurn('retry me');
    expect(result.kind).toBe('success');
    expect(result.finalText).toBe('recovered');
    expect(attempts).toBe(2);
    expect(retries).toHaveLength(1);
    expect(retries[0]!).toMatchObject({ step: 1, attempt: 1, errorClass: 'TIMEOUT' });
    // attempt-level pairing: start/end per attempt; failed attempt closes with 'error'
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    expect(ends[0]!.finishReason).toBe('error');
    expect(ends[1]!).toMatchObject({ finishReason: 'stop', text: 'recovered', usage: { inputTokens: 7, outputTokens: 3 } });
    await session.close();
  });

  it('stream path: retry exhaustion emits llm_retry per attempt and fails the model call', async () => {
    const alwaysFail: ChatProvider = {
      id: 'always-fail',
      async chat(): Promise<ChatResponse> {
        throw new Error('chat() must not be called when provider.stream is present');
      },
      async *stream(): AsyncGenerator<StreamChunk> {
        throw new Error('rate limit 429');
      },
    };
    const { session, bus, loop } = await makeLoop(dir, alwaysFail, { llmRetry: { maxRetries: 1 } });
    const { starts, ends, retries } = watch(bus);
    await expect(loop.runTurn('boom')).rejects.toThrow(/Model call failed after 2 attempt/);
    expect(retries.map((r) => r.attempt)).toEqual([1, 2]);
    expect(retries.every((r) => r.errorClass === 'RATE_LIMITED')).toBe(true);
    // both attempts emitted start → end('error') before the call threw
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    expect(ends.every((e) => e.finishReason === 'error')).toBe(true);
    await session.close();
  });
});

// ---------------------------------------------------------------------------
// Round 53 — consumer-side acceptance over the REAL production chain.
//
// AnthropicProvider.stream() (packages/llm/src/provider/AnthropicProvider.ts:326-346)
// feeds the raw SSE lines of the response into AnthropicStreamParser.feed() and
// yields the resulting StreamChunk[] straight to AgentLoop.consumeStream(), which
// seeds its per-id accumulator from tool_call_start.arguments, APPENDS every
// tool_call_delta, and parses the result with parseToolArguments. The provider
// below runs that exact chain over literal Anthropic wire frames, so these
// assertions are about what runTool finally receives — not about chunk shape.
//
// PRE-FIX: `content_block_start` carries `input:{}` on every canonical frame; the
// parser seeded tool_call_start.arguments with '{}' (parseAnthropic.ts:86) and the
// consumer (AgentLoop.ts:486/493) appended the fragment, holding
// '{}{"path":"a.txt"}'. parseToolArguments failed and the tool was dispatched with
// { _raw: '{}{"path":"a.txt"}' } — `path` unreachable. Because callModel prefers
// stream() whenever a provider exposes it, this was every Anthropic tool call.
// ---------------------------------------------------------------------------

/** A provider that replays literal Anthropic SSE lines through the real parser. */
class AnthropicWireProvider implements ChatProvider {
  readonly id = 'anthropic-wire';
  /** One array of raw SSE lines per model call, selected by tool results seen. */
  constructor(private readonly phases: string[][]) {}

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const toolResults = request.messages.filter((m) => m.role === 'tool').length;
    const lines = this.phases[Math.min(toolResults, this.phases.length - 1)]!;
    const parser = new AnthropicStreamParser();
    for (const line of lines) {
      for (const c of parser.feed(line)) yield c;
    }
    for (const c of parser.finish()) yield c;
  }
}

describe('AgentLoop — Anthropic streaming tool arguments, end to end (Round 53)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-anthropic-e2e-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('canonical Anthropic SSE stream ⇒ runTool receives { path: "a.txt" } (pre-fix: { _raw })', async () => {
    const provider = new AnthropicWireProvider([
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":11,"output_tokens":0}}}',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"Stub","input":{}}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"a.txt\\"}"}}',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}',
        'event: message_stop',
        'data: {"type":"message_stop"}',
      ],
      [
        'event: message_start',
        'data: {"type":"message_start","model":"m"}',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"read done"}}',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
        'event: message_stop',
        'data: {"type":"message_stop"}',
      ],
    ]);

    const dispatched: ToolCall[] = [];
    const { session, bus, loop } = await makeLoop(dir, provider, {
      runTool: async (call) => {
        dispatched.push(call);
        return { content: 'GOLD', meta: {} };
      },
    });
    const { ends } = watch(bus);
    const result = await loop.runTurn('read a.txt');

    // The acceptance criterion: the streamed tool call reached the tool with its
    // real arguments. Pre-fix `arguments` was { _raw: '{}{"path":"a.txt"}' }.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.toolCallId).toBe('toolu_01');
    expect(dispatched[0]!.toolName).toBe('Stub');
    expect(dispatched[0]!.arguments).not.toHaveProperty('_raw');
    expect(dispatched[0]!.arguments.path).toBe('a.txt');
    expect(dispatched[0]!.arguments).toEqual({ path: 'a.txt' });

    // The same call is on the model_stream_end terminal payload (what the GUI and
    // the assistant/attempt record see).
    expect(ends[0]!.toolCalls).toEqual([{ id: 'toolu_01', name: 'Stub', arguments: { path: 'a.txt' } }]);

    expect(result.kind).toBe('success');
    expect(result.toolCalls).toBe(1);
    expect(result.finalText).toBe('read done');
    await session.close();
  });
});
