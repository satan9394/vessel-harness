import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAICompatibleProvider, AnthropicProvider, MockProvider } from '../index.js';
import type { ChatRequest, StreamChunk } from '@vessel/shared';

/** Boot a local HTTP server that responds with a raw SSE body and records the request. */
function fakeSSEServer(sseBody: string) {
  const received: unknown[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(raw) });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(sseBody);
    });
  });
  return new Promise<{ server: http.Server; received: unknown[]; url: string; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, received, url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('OpenAICompatibleProvider.stream', () => {
  it('POSTs with stream:true and yields typed chunks from an SSE text stream', async () => {
    const sse = [
      'data: {"model":"deepseek-test","choices":[{"delta":{"role":"assistant","content":"Hi"}}]}',
      'data: {"choices":[{"delta":{"content":" there"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}',
      'data: [DONE]',
      '',
    ].join('\n');
    const fake = await fakeSSEServer(sse);
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: fake.url, model: 'deepseek-test', apiKey: 'k' });
      const chunks = await collect(p.stream({ model: 'deepseek-test', messages: [{ role: 'user', content: 'hi' }] }));

      const sent = fake.received[0] as { body: { stream: boolean; messages: unknown[]; model: string } };
      expect(sent.body.stream).toBe(true);
      expect(sent.body.model).toBe('deepseek-test');

      expect(chunks[0]).toEqual({ type: 'message_start' });
      expect(chunks.map((c) => c.type)).toContain('text_delta');
      const text = chunks.filter((c) => c.type === 'text_delta');
      expect(text).toEqual([{ type: 'text_delta', text: 'Hi' }, { type: 'text_delta', text: ' there' }]);
      expect(chunks).toContainEqual({ type: 'usage', inputTokens: 7, outputTokens: 3, cacheReadTokens: undefined });
      expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' });
    } finally {
      fake.close();
    }
  });

  it('yields tool_call chunks from a streaming tool-call exchange', async () => {
    const callPayload = (delta: object, finish?: string) =>
      'data: ' + JSON.stringify({ choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }] });
    const sse = [
      callPayload({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read' } }] }),
      callPayload({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }),
      callPayload({ tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }, 'tool_calls'),
      'data: [DONE]',
    ].join('\n');
    const fake = await fakeSSEServer(sse);
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: fake.url, model: 'm' });
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'read' }] }));
      expect(chunks.map((c) => c.type)).toEqual([
        'message_start',
        'tool_call_start',
        'tool_call_delta',
        'tool_call_delta',
        'tool_call_end',
        'message_end',
      ]);
      const start = chunks[1] as { id: string; name: string };
      expect(start).toMatchObject({ id: 'call_1', name: 'Read' });
      const deltas = chunks.filter((c) => c.type === 'tool_call_delta');
      expect((deltas[0] as { argumentsDelta: string }).argumentsDelta).toBe('{"path":');
      expect((deltas[1] as { argumentsDelta: string }).argumentsDelta).toBe('"a.txt"}');
    } finally {
      fake.close();
    }
  });

  it('surfaces HTTP errors from the stream endpoint', async () => {
    const received: unknown[] = [];
    const server = http.createServer((_req, res) => {
      res.writeHead(401, {});
      res.end('unauthorized');
      received.push(1);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as AddressInfo;
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${addr.port}`, model: 'm' });
      await expect(collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'x' }] }))).rejects.toThrow(/401/);
    } finally {
      server.close();
    }
  });

  it('stream() 请求体带 assistant tool_calls + reasoning_content（task 109 流式路径）', async () => {
    const sse = ['data: {"choices":[{"delta":{"role":"assistant"}}]}', 'data: [DONE]', ''].join('\n');
    const fake = await fakeSSEServer(sse);
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: fake.url, model: 'deepseek-flash', apiKey: 'k' });
      const messages = [
        { role: 'user' as const, content: '任务' },
        {
          role: 'assistant' as const,
          content: '',
          reasoningContent: '想：先读文件',
          toolCalls: [{ id: 'tc1', name: 'Read', arguments: { path: 'a.txt' } }],
        },
        { role: 'tool' as const, toolCallId: 'tc1', name: 'Read', content: 'DATA' },
      ];
      await collect(p.stream({ model: 'deepseek-flash', messages }));

      const sent = fake.received[0] as { body: { messages: Array<Record<string, unknown>>; stream: boolean } };
      expect(sent.body.stream).toBe(true);
      const wireAsst = sent.body.messages.find((m) => m.role === 'assistant') as {
        reasoning_content?: string;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      };
      expect(wireAsst.reasoning_content).toBe('想：先读文件');
      expect(wireAsst.tool_calls).toEqual([{ id: 'tc1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }]);
      const wireTool = sent.body.messages.find((m) => m.role === 'tool') as { tool_call_id?: string };
      expect(wireTool.tool_call_id).toBe('tc1');
    } finally {
      fake.close();
    }
  });
});

describe('AnthropicProvider.stream', () => {
  it('POSTs to /v1/messages with stream:true and yields typed chunks', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","model":"claude-sonnet-4"}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Bonjour"}}',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    const fake = await fakeSSEServer(sse);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'sk-ant', model: 'claude-sonnet-4' });
      const chunks = await collect(p.stream({ model: 'claude-sonnet-4', messages: [{ role: 'user', content: 'hi' }] }));

      const sent = fake.received[0] as { url: string; body: { stream: boolean } };
      expect(sent.url).toBe('/v1/messages');
      expect(sent.body.stream).toBe(true);

      expect(chunks[0]).toEqual({ type: 'message_start', model: 'claude-sonnet-4' });
      expect(chunks).toContainEqual({ type: 'text_delta', text: 'Bonjour' });
      expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' });
    } finally {
      fake.close();
    }
  });

  it('yields tool_call_start/end with the tool id from content_block_start', async () => {
    const sse = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_7","name":"Read","input":{}}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"p\\":"}}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}',
      'data: {"type":"message_stop"}',
    ].join('\n');
    const fake = await fakeSSEServer(sse);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm' });
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'read' }] }));
      expect(chunks.map((c) => c.type)).toContain('tool_call_start');
      expect(chunks.map((c) => c.type)).toContain('tool_call_end');
      const start = chunks.find((c) => c.type === 'tool_call_start') as { id: string; name: string };
      expect(start).toMatchObject({ id: 'toolu_7', name: 'Read' });
      const end = chunks.find((c) => c.type === 'tool_call_end') as { id: string };
      expect(end.id).toBe('toolu_7');
    } finally {
      fake.close();
    }
  });

  it('carries cache_creation_input_tokens from message_start and does not clobber it on message_delta (task 099)', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-sonnet-4","usage":{"input_tokens":12,"cache_creation_input_tokens":2095,"cache_read_input_tokens":1024}}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    const fake = await fakeSSEServer(sse);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'sk-ant', model: 'claude-sonnet-4' });
      const chunks = await collect(p.stream({ model: 'claude-sonnet-4', messages: [{ role: 'user', content: 'hi' }] }));
      const usages = chunks.filter((c) => c.type === 'usage') as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number }[];
      expect(usages).toHaveLength(2);
      // message_start frame: the only frame Anthropic reports cache writes on
      expect(usages[0]!.cacheCreationTokens).toBe(2095);
      expect(usages[0]!.cacheReadTokens).toBe(1024);
      // message_delta frame: output_tokens only → cacheCreationTokens undefined,
      // so AgentLoop's per-field last-wins fold keeps the earlier 2095
      expect(usages[1]!.outputTokens).toBe(5);
      expect(usages[1]!.cacheCreationTokens).toBeUndefined();
    } finally {
      fake.close();
    }
  });
});

describe('OpenAI-compatible wire — no cache write concept (task 099)', () => {
  it('chat() leaves cacheCreationTokens undefined (no 0 fake value)', async () => {
    const body = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as AddressInfo;
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${addr.port}`, model: 'm', apiKey: 'k' });
      const r = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
      expect(r.usage.inputTokens).toBe(10);
      expect(r.usage.cacheCreationTokens).toBeUndefined();
      expect(r.usage.cacheCreationTokens).not.toBe(0);
    } finally {
      server.close();
    }
  });

  it('stream() usage chunk has cacheCreationTokens undefined', async () => {
    const sse = ['data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}', 'data: [DONE]', ''].join('\n');
    const fake = await fakeSSEServer(sse);
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: fake.url, model: 'm', apiKey: 'k' });
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));
      const usage = chunks.find((c) => c.type === 'usage') as { cacheCreationTokens?: number } | undefined;
      expect(usage).toBeDefined();
      expect(usage!.cacheCreationTokens).toBeUndefined();
    } finally {
      fake.close();
    }
  });
});

describe('MockProvider — injectable usage (task 099)', () => {
  it('chat() reports the injected cacheCreationTokens, stream() carries it in the usage chunk', async () => {
    const p = new MockProvider([{ when: /.*/, response: { text: 'ok' } }], {
      model: 'm',
      usage: { inputTokens: 100, outputTokens: 20, cacheCreationTokens: 2095 },
    });
    const r = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheCreationTokens: 2095 });
    const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));
    expect(chunks).toContainEqual({ type: 'usage', inputTokens: 100, outputTokens: 20, cacheCreationTokens: 2095 });
  });

  it('default usage stays exactly {inputTokens, outputTokens} (no padded undefined/0 keys)', async () => {
    const p = new MockProvider([{ when: /.*/, response: { text: 'ok' } }], { model: 'm' });
    const r = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(Object.keys(r.usage).sort()).toEqual(['inputTokens', 'outputTokens']);
    const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));
    const usage = chunks.find((c) => c.type === 'usage')!;
    expect(Object.keys(usage).sort()).toEqual(['inputTokens', 'outputTokens', 'type']);
  });
});

describe('MockProvider.stream', () => {
  it('yields synchronous text + usage + message_end chunks', async () => {
    const p = new MockProvider([{ when: /hello/i, response: { text: 'world' } }], { model: 'mock-model' });
    const chunks = await collect(p.stream({ model: 'mock-model', messages: [{ role: 'user', content: 'say hello' }] }));
    expect(chunks).toEqual([
      { type: 'message_start', model: 'mock-model' },
      { type: 'text_delta', text: 'world' },
      { type: 'usage', inputTokens: 100, outputTokens: 20 },
      { type: 'message_end', finishReason: 'stop' },
    ]);
  });

  it('yields tool_call_start/end when a script entry returns tool calls', async () => {
    const p = new MockProvider(
      [{ when: /read/, response: { toolCalls: [{ name: 'Read', arguments: { path: '{cwd}/f.txt' } }] } }],
      { vars: { cwd: '/ws' } },
    );
    const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'please read' }] }));
    const start = chunks.find((c) => c.type === 'tool_call_start') as { id: string; name: string; arguments: string };
    expect(start.name).toBe('Read');
    expect(JSON.parse(start.arguments)).toEqual({ path: '/ws/f.txt' });
    expect(chunks.map((c) => c.type)).toContain('tool_call_end');
    expect((chunks[chunks.length - 1] as { finishReason: string }).finishReason).toBe('tool_calls');
  });
});

// ---------------------------------------------------------------------------
// stream() idle timeout — the "upstream goes silent" hang.
//
// PRE-FIX: chat() capped the whole request (`setTimeout ⇒ controller.abort()`,
// OpenAICompatibleProvider.ts:86 / AnthropicProvider.ts:187) but stream() only
// forwarded the caller's signal, so a caller that passed no signal (the normal
// AgentLoop case is a signal that is never aborted) left `reader.read()` pending
// FOREVER when the upstream accepted the TCP connection and then sent nothing:
// no error, no audit event, no UI change — the turn froze silently.
//
// The fix is an IDLE (inter-chunk) timeout, deliberately NOT chat()'s total
// timeout: a long streamed answer is legitimate, so every arriving chunk (and the
// response headers) restarts the window, and only a gap with NO data aborts.
//
// These four criteria are the ones that must stay red-able:
//   ① no data at all   ⇒ explicit idle-timeout error after the threshold
//   ② slow but ALIVE   ⇒ must NEVER be killed (interval < threshold, total > threshold)
//   ③ chat()           ⇒ its existing TOTAL timeout is byte-for-byte unchanged
//   ④ external signal  ⇒ still aborts promptly and is NOT reported as a timeout
// ---------------------------------------------------------------------------

interface FakeUpstream {
  url: string;
  close: () => void;
}

/** Loopback-only listener; `close()` also drops sockets the upstream left hung. */
function listen(server: http.Server): Promise<FakeUpstream> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => {
          server.closeAllConnections(); // the "hung" upstreams keep sockets open on purpose
          server.close();
        },
      });
    });
  });
}

/**
 * An upstream that accepts the request and then goes SILENT.
 * No `prefix` ⇒ not even the response headers are written; with one ⇒ it writes
 * `prefix` and stops. It never calls `res.end()`, so the connection stays open
 * with no further data — the "链路坏了但看起来只是慢" case, on loopback only.
 */
function stalledUpstream(prefix?: string): Promise<FakeUpstream> {
  const server = http.createServer((req, res) => {
    // The client aborts this connection on purpose; late socket errors are noise.
    res.on('error', () => {});
    req.on('data', () => {});
    req.on('end', () => {
      if (prefix === undefined) return; // never respond at all
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(prefix);
    });
  });
  return listen(server);
}

/** An upstream that is SLOW BUT ALIVE: one frame every `gapMs`, then closes. */
function pacedUpstream(frames: string[], gapMs: number): Promise<FakeUpstream> {
  const server = http.createServer((req, res) => {
    res.on('error', () => {});
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      let i = 0;
      const tick = setInterval(() => {
        if (res.destroyed || res.writableEnded) {
          clearInterval(tick); // the test tore the upstream down early
          return;
        }
        if (i < frames.length) {
          res.write(frames[i]! + '\n');
          i += 1;
          return;
        }
        clearInterval(tick);
        res.end();
      }, gapMs);
    });
  });
  return listen(server);
}

type StreamOutcome =
  | { status: 'ok'; chunks: StreamChunk[]; elapsedMs: number }
  | { status: 'error'; error: Error; chunks: StreamChunk[]; elapsedMs: number }
  | { status: 'hung'; chunks: StreamChunk[]; elapsedMs: number };

/**
 * Drain `iter` under a hard deadline. On the PRE-FIX code a silent upstream
 * leaves `reader.read()` pending forever, so this deadline is what turns
 * "silently hung" into a readable red test instead of a hung suite: the outcome
 * comes back as `{status:'hung'}` and the assertion below fails loudly.
 */
async function collectBounded(iter: AsyncIterable<StreamChunk>, deadlineMs: number): Promise<StreamOutcome> {
  const started = Date.now();
  const chunks: StreamChunk[] = [];
  const drained = (async (): Promise<StreamOutcome> => {
    try {
      for await (const c of iter) chunks.push(c);
      return { status: 'ok', chunks, elapsedMs: Date.now() - started };
    } catch (error) {
      return { status: 'error', error: error as Error, chunks, elapsedMs: Date.now() - started };
    }
  })();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<StreamOutcome>((resolve) => {
    deadline = setTimeout(() => resolve({ status: 'hung', chunks, elapsedMs: Date.now() - started }), deadlineMs);
  });
  const outcome = await Promise.race([drained, hung]);
  clearTimeout(deadline);
  return outcome;
}

function userReq(extra: Partial<ChatRequest> = {}): ChatRequest {
  return { model: 'm', messages: [{ role: 'user', content: 'hi' }], ...extra };
}

/** Assert the explicit, machine-readable idle-timeout error (not a bare AbortError). */
function expectIdleTimeoutError(err: Error, providerId: string, idleMs: number): void {
  expect(err.name).toBe('StreamIdleTimeoutError');
  expect(err.message).toContain(`${providerId} stream idle timeout`);
  expect(err.message).toMatch(/no data received for \d+ms/);
  expect(err.message).toContain(`${idleMs}ms`);
  // What AgentLoop.classifyModelError keys on (`/timeout/i` ⇒ errorClass TIMEOUT,
  // so the attempt is retried and the turn closes with finishReason 'error').
  expect(err.message).toMatch(/timeout/i);
}

const OPENAI_IDLE_MS = 150;
const OPENAI_PACED_IDLE_MS = 300;
const HARD_DEADLINE_MS = 3_000;

describe('OpenAICompatibleProvider.stream — 空闲超时（idle timeout）', () => {
  it('① 上游完全不发数据 ⇒ 在 idle 阈值后以明确的超时错误结束（修复前：reader.read() 永不返回，静默卡死）', async () => {
    const fake = await stalledUpstream();
    const external = new AbortController();
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: fake.url, model: 'm', apiKey: 'k', streamIdleTimeoutMs: OPENAI_IDLE_MS });
      const outcome = await collectBounded(p.stream(userReq({ signal: external.signal })), HARD_DEADLINE_MS);
      if (outcome.status !== 'error') {
        throw new Error(
          `stream() 在 ${HARD_DEADLINE_MS}ms 内没有结束（status=${outcome.status}）—— 上游挂死时回合静默卡死，这正是修复前的行为`,
        );
      }
      expectIdleTimeoutError(outcome.error, 'openai-compatible', OPENAI_IDLE_MS);
      // 由 idle 定时器触发（而非别的原因立刻失败）：至少要等满阈值。
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(OPENAI_IDLE_MS - 20);
    } finally {
      external.abort(); // 若修复被删，这里负责拆掉仍然挂起的 fetch
      fake.close();
    }
  });

  it('①-2 已到 headers + 一个 chunk 后静默 ⇒ 已产出的 chunk 送达，随后仍以 idle 超时结束', async () => {
    const fake = await stalledUpstream('data: {"choices":[{"delta":{"content":"first"}}]}\n');
    const external = new AbortController();
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: fake.url, model: 'm', apiKey: 'k', streamIdleTimeoutMs: OPENAI_IDLE_MS });
      const outcome = await collectBounded(p.stream(userReq({ signal: external.signal })), HARD_DEADLINE_MS);
      if (outcome.status !== 'error') {
        throw new Error(`流中途静默没有被超时收口（status=${outcome.status}）`);
      }
      expect(outcome.chunks).toContainEqual({ type: 'text_delta', text: 'first' });
      expectIdleTimeoutError(outcome.error, 'openai-compatible', OPENAI_IDLE_MS);
    } finally {
      external.abort();
      fake.close();
    }
  });

  it('② 负对照：慢但持续有数据（间隔 < 阈值、总时长 > 阈值）不得被误杀', async () => {
    const gapMs = 50;
    const textFrames = Array.from({ length: 12 }, (_, i) => `data: {"choices":[{"delta":{"content":"t${i}"}}]}`);
    const fake = await pacedUpstream([...textFrames, 'data: [DONE]'], gapMs);
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: fake.url, model: 'm', apiKey: 'k', streamIdleTimeoutMs: OPENAI_PACED_IDLE_MS });
      const outcome = await collectBounded(p.stream(userReq()), HARD_DEADLINE_MS);
      if (outcome.status !== 'ok') {
        throw new Error(`慢但持续的流被误杀（status=${outcome.status}）：${outcome.status === 'error' ? outcome.error.message : ''}`);
      }
      // 判据本身要成立：总时长确实超过 idle 阈值，靠的是「每片重置」而不是「整体很短」。
      expect(outcome.elapsedMs).toBeGreaterThan(OPENAI_PACED_IDLE_MS);
      const text = outcome.chunks.filter((c) => c.type === 'text_delta');
      expect(text).toHaveLength(textFrames.length);
      expect(outcome.chunks[outcome.chunks.length - 1]).toEqual({ type: 'message_end' });
    } finally {
      fake.close();
    }
  });

  it('③ chat() 的总超时逐字不回归：同一挂死上游仍按 timeoutMs 结束，与 idle 选项无关', async () => {
    const fake = await stalledUpstream();
    try {
      const p = new OpenAICompatibleProvider({
        baseUrl: fake.url,
        model: 'm',
        timeoutMs: 120, // 总超时
        streamIdleTimeoutMs: 10_000, // stream 专用：不得影响 chat
      });
      const started = Date.now();
      let error: unknown;
      try {
        await p.chat(userReq());
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(Error);
      const err = error as Error;
      expect(err.message).toMatch(/abort/i); // 仍然是 chat 的 AbortError 语义
      expect(err.message).not.toMatch(/idle timeout/i); // 不是 stream 的新错误
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      fake.close();
    }
  });

  it('④ 外部 signal 既有语义不变：中断尽快 abort，且不被报告成 idle 超时', async () => {
    const fake = await stalledUpstream();
    const external = new AbortController();
    try {
      const p = new OpenAICompatibleProvider({ baseUrl: fake.url, model: 'm', streamIdleTimeoutMs: 5_000 });
      const timer = setTimeout(() => external.abort(), 50);
      const outcome = await collectBounded(p.stream(userReq({ signal: external.signal })), HARD_DEADLINE_MS);
      clearTimeout(timer);
      if (outcome.status !== 'error') {
        throw new Error(`外部中断未在 ${HARD_DEADLINE_MS}ms 内结束（status=${outcome.status}）`);
      }
      expect(outcome.error.message).not.toMatch(/idle timeout/i);
      expect(outcome.error.name === 'AbortError' || /abort/i.test(outcome.error.message)).toBe(true);
      // 「尽快」= 远早于 5000ms 的 idle 阈值（中断在 50ms 发出）。
      expect(outcome.elapsedMs).toBeLessThan(2_000);
    } finally {
      external.abort();
      fake.close();
    }
  });
});

const ANTHROPIC_IDLE_MS = 150;
const ANTHROPIC_PACED_IDLE_MS = 300;

describe('AnthropicProvider.stream — 空闲超时（idle timeout，同族同修）', () => {
  it('① 上游完全不发数据 ⇒ 在 idle 阈值后以明确的超时错误结束（修复前：静默卡死）', async () => {
    const fake = await stalledUpstream();
    const external = new AbortController();
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm', streamIdleTimeoutMs: ANTHROPIC_IDLE_MS });
      const outcome = await collectBounded(p.stream(userReq({ signal: external.signal })), HARD_DEADLINE_MS);
      if (outcome.status !== 'error') {
        throw new Error(
          `AnthropicProvider.stream() 在 ${HARD_DEADLINE_MS}ms 内没有结束（status=${outcome.status}）—— 修复前上游挂死即静默卡死`,
        );
      }
      expectIdleTimeoutError(outcome.error, 'anthropic', ANTHROPIC_IDLE_MS);
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(ANTHROPIC_IDLE_MS - 20);
    } finally {
      external.abort();
      fake.close();
    }
  });

  it('② 负对照：慢但持续有数据（间隔 < 阈值、总时长 > 阈值）不得被误杀', async () => {
    const gapMs = 50;
    const textFrames = Array.from(
      { length: 12 },
      (_, i) => `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"t${i}"}}`,
    );
    const frames = ['data: {"type":"message_start","model":"m"}', ...textFrames, 'data: {"type":"message_stop"}'];
    const fake = await pacedUpstream(frames, gapMs);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm', streamIdleTimeoutMs: ANTHROPIC_PACED_IDLE_MS });
      const outcome = await collectBounded(p.stream(userReq()), HARD_DEADLINE_MS);
      if (outcome.status !== 'ok') {
        throw new Error(`慢但持续的流被误杀（status=${outcome.status}）：${outcome.status === 'error' ? outcome.error.message : ''}`);
      }
      expect(outcome.elapsedMs).toBeGreaterThan(ANTHROPIC_PACED_IDLE_MS);
      const text = outcome.chunks.filter((c) => c.type === 'text_delta');
      expect(text).toHaveLength(textFrames.length);
      expect(outcome.chunks[outcome.chunks.length - 1]).toEqual({ type: 'message_end' });
    } finally {
      fake.close();
    }
  });

  it('③ chat() 的总超时逐字不回归：仍按 timeoutMs 结束，与 idle 选项无关', async () => {
    const fake = await stalledUpstream();
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm', timeoutMs: 120, streamIdleTimeoutMs: 10_000 });
      const started = Date.now();
      let error: unknown;
      try {
        await p.chat(userReq());
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/abort/i);
      expect((error as Error).message).not.toMatch(/idle timeout/i);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      fake.close();
    }
  });

  it('④ 外部 signal 既有语义不变：中断尽快 abort，且不被报告成 idle 超时', async () => {
    const fake = await stalledUpstream();
    const external = new AbortController();
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm', streamIdleTimeoutMs: 5_000 });
      const timer = setTimeout(() => external.abort(), 50);
      const outcome = await collectBounded(p.stream(userReq({ signal: external.signal })), HARD_DEADLINE_MS);
      clearTimeout(timer);
      if (outcome.status !== 'error') {
        throw new Error(`外部中断未在 ${HARD_DEADLINE_MS}ms 内结束（status=${outcome.status}）`);
      }
      expect(outcome.error.message).not.toMatch(/idle timeout/i);
      expect(outcome.error.name === 'AbortError' || /abort/i.test(outcome.error.message)).toBe(true);
      expect(outcome.elapsedMs).toBeLessThan(2_000);
    } finally {
      external.abort();
      fake.close();
    }
  });
});