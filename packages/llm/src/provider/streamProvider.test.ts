import { describe, it, expect, vi } from 'vitest';
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

// ---------------------------------------------------------------------------
// AnthropicProvider.stream — 流诊断（Round 66）：两个「只读计数」的消费者
//
// 背景（为何这张卡存在）：`AnthropicStreamParser` 自 Round 54/65 起持有两个**每流只读**
// 计数 —— `malformedFrames`（EOF 时被当最后一帧喂进来的残帧：字节不可解析 ⇒ 连接被截断）
// 与 `duplicateStarts`（块还开着又来一次 content_block_start：上游重发帧 ⇒ 协议违规）。
// 两者此前**全仓零消费者**：grep 只命中 parser 自身与 parser 测试，可见性只活在 getter
// 里 —— 运行时没人读，运维看不到。本组用例把这个消费点钉死：**流终止边界**读取两个计数，
// **> 0 才**经 warn 侧信道输出**分因**的一行。
//
// 判据（删掉修复即红）：
//   ① 截断流（EOF 半帧）⇒ 恰一条 cause=truncated-frame（截断/字节不可解析），数字与
//      malformedFrames 一致；旧实现（零消费）此处零输出 ⇒ 必红。
//   ② 块未关闭时重发 content_block_start ⇒ 恰一条 cause=duplicate-start（重发帧/协议
//      违规），**不得**与①同类；两个计数分离的意义正在于此。
//   ③ 负对照：完全规范的流 ⇒ **零输出**（防「每次都警告」，本卡最重要的负对照）。
//   ④ 既有行为不变：诊断只走 warn，不产生任何 chunk；chunk 序列 / message_end 形状 /
//      finish() 语义逐字不变（既有用例原样通过）。
//   ⑤ 文案—行为一致（Round 67 补）：**告警的措辞本身也是判据**。同 id 的重复 start 上
//      seed 折成 `tool_call_delta` 送达 ⇒ 告警**不得**说它「已丢弃」（⑥）；同时告警必须
//      把「会丢」的形态一并写出，只讲其中一种还说得像全部 = 新的谎话（⑦ 从两个方向钉住：
//      既不许「一律丢弃」，也不许「一律未丢」）。
//   ⑤-2 文案—行为一致（Round 68 改向）：不同 id 的重复 start 修好后**也**送达（identity
//      冻结在首次 start，折出的 delta 挂**原 id**）⇒ ⑦ 反向钉住：文案**不得**再把「不同
//      id」说成丢失（只改行为不改文案 ⇒ 红），但真正仍会丢的那一形态（无 id/name）必须
//      仍在场（改成「一律未丢」同样 ⇒ 红）。
//
// 频率策略：**每流每因至多一行**（≤2 行）。刻意**不做跨流去重**——计数是 parser 的每流
// 实例状态，跨流抑制要靠模块级共享状态（正是 parser 明确拒绝的设计），且「每个异常流
// 都上报」本就是运维信号的意义：重复出现是上游的属性，抑制它等于藏起正在进行的事故。
// ---------------------------------------------------------------------------

/** Anthropic provider whose diagnostic outlet RECORDS instead of printing. */
function recordingAnthropic(url: string): { p: AnthropicProvider; warns: string[] } {
  const warns: string[] = [];
  const p = new AnthropicProvider({ baseUrl: url, apiKey: 'k', model: 'm', onWarn: (m) => warns.push(m) });
  return { p, warns };
}

/** A canonical (protocol-clean) Anthropic SSE body: one text block, proper stop. */
const CANONICAL_SSE = [
  'event: message_start',
  'data: {"type":"message_start","model":"claude-sonnet-4"}',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Bonjour"}}',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

/**
 * The TRUNCATED stream: the last `data:` payload is cut mid-JSON and has NO
 * trailing newline, so it stays in the provider's residual buffer and is fed to
 * the parser as one last frame at EOF — exactly the byte loss Round 54 counts.
 * `malformedFrames === 1`, `duplicateStarts === 0`.
 */
const TRUNCATED_SSE = [
  'data: {"type":"message_start","model":"m"}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Bonj"}}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"our',
].join('\n');

/**
 * The PROTOCOL-VIOLATING stream: `content_block_start` for index 0 arrives a
 * SECOND time while that block is still open (no `content_block_stop` yet). The
 * bytes parse perfectly — this is the upstream repeating a forbidden frame, not
 * a broken transport. `duplicateStarts === 1`, `malformedFrames === 0`.
 */
const DUPLICATE_START_SSE = [
  'data: {"type":"message_start","model":"m"}',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"p\\":1}"}}',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{"seed":true}}}',
  'data: {"type":"content_block_stop","index":0}',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

/**
 * The SECOND shape of the same violation: the repeat for the still-open index 0
 * carries a DIFFERENT tool_use id (`toolu_2`). The bytes parse fine.
 *
 * Round 68: the parser freezes the identity of a STARTED block at its first
 * start, so the folded seed is addressed to the ORIGINAL id — the consumer keys
 * its accumulator by the start's id (`AgentLoop.consumeStream`:
 * `open.get(chunk.id)`), so that frame's seed DOES land. This was the "会丢"
 * fixture that ⑦ used to pin; ⑦ now pins the corrected fact (and the wording
 * that has to match it).
 */
const DUPLICATE_START_NEW_ID_SSE = [
  'data: {"type":"message_start","model":"m"}',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"p\\":1}"}}',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_2","name":"Read","input":{"seed":true}}}',
  'data: {"type":"content_block_stop","index":0}',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

describe('AnthropicProvider.stream — 流诊断（malformedFrames / duplicateStarts 的消费者，Round 66）', () => {
  it('① 截断流（EOF 半帧）⇒ 恰一条 cause=truncated-frame，数字与 malformedFrames 一致（删掉消费点 ⇒ 本行零输出变红）', async () => {
    const fake = await fakeSSEServer(TRUNCATED_SSE);
    try {
      const { p, warns } = recordingAnthropic(fake.url);
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));

      // 旧实现（两个计数零消费者）在这里是 []，所以这一行就是本卡的判别线。
      expect(warns).toHaveLength(1);
      // 成因必须落在「字节不可解析/截断」这一类……
      expect(warns[0]!).toContain('cause=truncated-frame');
      // 文案用的是「连接在帧中间被切断」——断言锚在语义token上，而不是与措辞逐字绑死
      // （先前这里写 /截断/ 与文案用词不一致，是测试自己的错）。
      expect(warns[0]!).toMatch(/切断|截断/);
      expect(warns[0]!).toMatch(/字节不可解析/);
      // ……并给出可机读的数字（与 parser 计数一致）。
      expect(warns[0]!).toContain('malformedFrames=1');
      // ……且不得与「上游重发帧」混为一类（两个计数分离的意义）。
      expect(warns[0]!).not.toContain('cause=duplicate-start');
      expect(warns[0]!).not.toContain('duplicateStarts=');

      // 半帧照旧被丢弃，终局语义不变（finish() 补齐 message_end）。
      expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' });
    } finally {
      fake.close();
    }
  });

  it('② 块未关闭时重发 content_block_start ⇒ 恰一条 cause=duplicate-start，且不与①混为一类', async () => {
    const fake = await fakeSSEServer(DUPLICATE_START_SSE);
    try {
      const { p, warns } = recordingAnthropic(fake.url);
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'read' }] }));

      expect(warns).toHaveLength(1);
      // 成因必须落在「上游重发帧/协议违规」这一类……
      expect(warns[0]!).toContain('cause=duplicate-start');
      expect(warns[0]!).toMatch(/重发帧/);
      expect(warns[0]!).toMatch(/协议违规/);
      // ……数字是 duplicateStarts（不是 malformedFrames：字节是好的）。
      expect(warns[0]!).toContain('duplicateStarts=1');
      expect(warns[0]!).not.toContain('cause=truncated-frame');
      expect(warns[0]!).not.toContain('malformedFrames=');

      // 行为不变：重复的 start 不得二次入流（否则消费侧会覆盖已累积的片段），
      // 它携带的非空 seed 折进一条 append-only 的 tool_call_delta。
      const types = chunks.map((c) => c.type);
      expect(types.filter((t) => t === 'tool_call_start')).toHaveLength(1);
      expect(chunks).toContainEqual({ type: 'tool_call_delta', id: 'toolu_1', argumentsDelta: '{"p":1}' });
      expect(chunks).toContainEqual({ type: 'tool_call_delta', id: 'toolu_1', argumentsDelta: '{"seed":true}' });
      expect(types[types.length - 1]!).toBe('message_end');
    } finally {
      fake.close();
    }
  });

  it('③ 负对照：完全规范的流 ⇒ 零输出（删掉 `> 0` 守卫、改成无条件 warn ⇒ 本行变红）', async () => {
    const fake = await fakeSSEServer(CANONICAL_SSE);
    try {
      const { p, warns } = recordingAnthropic(fake.url);
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));

      // 本卡最重要的负对照：健康流必须一声不吭，否则「每次都警告」会把真正
      // 有问题的那条流淹掉。
      expect(warns).toEqual([]);

      expect(chunks[0]).toEqual({ type: 'message_start', model: 'claude-sonnet-4' });
      expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' });
    } finally {
      fake.close();
    }
  });

  it('③-2 负对照：没有 message_stop 的干净 EOF（无半帧）⇒ 仍然零输出（信号锚在计数，不锚在「没收到 message_stop」）', async () => {
    const sse = [
      'data: {"type":"message_start","model":"m"}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
      '',
    ].join('\n');
    const fake = await fakeSSEServer(sse);
    try {
      const { p, warns } = recordingAnthropic(fake.url);
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));

      expect(warns).toEqual([]); // 「截断连接」= 有残帧，不是「没有 message_stop」
      expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' }); // finish() 语义不变
    } finally {
      fake.close();
    }
  });

  it('④ 既有行为不变：诊断只走 warn 侧信道，不产生任何 chunk；chunk 序列与 message_end 形状逐字不变', async () => {
    const fake = await fakeSSEServer(TRUNCATED_SSE);
    try {
      const { p, warns } = recordingAnthropic(fake.url);
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));

      // 异常流上也一样：侧信道有内容，chunk 流一个不多一个不少。
      expect(warns).toHaveLength(1);
      // 注意第三个夹具帧是 `..."our`（从字符串中间被切断）⇒ 该帧**不可解析、不产出任何 chunk**
      // ⇒ 那句 `our` **就是丢了**——这正是 malformedFrames 存在的理由。所以这里是 3 个 chunk
      // 而不是 4 个：先前期望里多算的那个 `text_delta 'our'`，等于假设"截断的片段仍会送达"，
      // 与"截断即丢失"自相矛盾。
      expect(chunks).toEqual([
        { type: 'message_start', model: 'm' },
        { type: 'text_delta', text: 'Bonj' },
        { type: 'message_end' },
      ]);
      // message_end 形状不变：就是 `{type:'message_end'}`，没有多出诊断字段。
      expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' });
    } finally {
      fake.close();
    }
  });

  it('⑤ 未注入 onWarn ⇒ 默认 console.warn（生产运行时无需任何接线即可见）', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fake = await fakeSSEServer(TRUNCATED_SSE);
      try {
        const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm' });
        await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }));

        expect(spy).toHaveBeenCalledTimes(1);
        expect(String(spy.mock.calls[0]![0])).toContain('cause=truncated-frame');
      } finally {
        fake.close();
      }
    } finally {
      spy.mockRestore();
    }
  });

  // -------------------------------------------------------------------------
  // Round 67 — 文案也是判据：「说的和做的不一致」必须立刻变红。
  //
  // 背景（我们自己引入的缺陷）：旧文案写「该重复帧携带的 argument seed 已丢弃」，可
  // **同一个夹具**（DUPLICATE_START_SSE，同 id 的重复 start）走的正是 Round 64 的
  // 「折成 delta」分支，② 的 :767 断言 seed 确实送达 —— 同一条流，日志说丢了、测试
  // 说没丢。修法只动措辞（派生信息，零行为风险）：**不得**断言「已丢弃」，必须按实际
  // 形态如实描述；而 provider 侧只有一个 `duplicateStarts` 数字（计数在 mapper 之前
  // 按帧取，子形态判决在 parser 的 feed() 内部），**无法**得知是哪一子形态，所以文案
  // 写成覆盖全部子形态的中性表述。
  //
  // 这两条与既有 ② **同时存在**才有判别力：② 钉「行为（seed 送达）」，⑥⑦ 钉「文案」。
  // 只留其一，就只是把谎话换个方向。
  //
  // Round 68 — ⑦ 的「会丢」那一半被**行为修复**取代：区分「不同 id」的重复帧现在也送达
  // （parser 把已 started 块的 identity 冻结在首次 start，折出的 delta 挂**原 id**）。
  // 同一条铁律于是反向生效：既不许把「不同 id」说成丢失（行为变了、文案没变 ⇒ 红），也不
  // 许改口成「一律未丢」（真正仍会丢的只有「无 id/name」那一形态 ⇒ 两向都钉住）。
  // -------------------------------------------------------------------------
  it('⑥ 文案—行为一致：同 id 重复 start 的 seed 折成 delta 送达 ⇒ 告警不得自称「已丢弃」（把文案改回「已丢弃」，或删掉「折入/未丢」断言 ⇒ 本行变红）', async () => {
    const fake = await fakeSSEServer(DUPLICATE_START_SSE);
    try {
      const { p, warns } = recordingAnthropic(fake.url);
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'read' }] }));

      // 【行为】与 ② 的 :767 同一事实：同 id 的重复帧，seed 折入 append-only 的 delta 送达。
      expect(chunks).toContainEqual({ type: 'tool_call_delta', id: 'toolu_1', argumentsDelta: '{"seed":true}' });

      // 【文案】既然上一行成立，告警就不得说这个 seed「已丢弃」——这就是判别线：
      // 修前文案含「已丢弃」⇒ 本行 RED。
      expect(warns).toHaveLength(1);
      expect(warns[0]!).toContain('cause=duplicate-start');
      expect(warns[0]!).not.toMatch(/已丢弃/);
      // ……且必须如实写出「折入 / 未丢」，而不是靠一句含糊话躲过去。
      expect(warns[0]!).toMatch(/折入/);
      expect(warns[0]!).toMatch(/未丢/);
    } finally {
      fake.close();
    }
  });

  it('⑦ 文案必须分形态（Round 68 改向）：不同 id 的重复帧也送达 ⇒ 不得再说它「丢失」，但真正会丢的那一形态必须仍在场（只改行为不改文案 ⇒ 红；改成「一律未丢」也 ⇒ 红）', async () => {
    const fake = await fakeSSEServer(DUPLICATE_START_NEW_ID_SSE);
    try {
      const { p, warns } = recordingAnthropic(fake.url);
      const chunks = await collect(p.stream({ model: 'm', messages: [{ role: 'user', content: 'read' }] }));

      // 【行为】不同 id 的重复帧：identity 冻结在**首次 start**（toolu_1），折出的 delta 挂的是
      // **原 id** ⇒ 消费侧那个真正打开的累加器（AgentLoop.consumeStream `open.get(chunk.id)`）
      // 收得到它，该帧 seed 送达。删掉 feed() 的 `identityFrozen` 守卫，或把折出的 id 改回帧
      // 自己的 `c.id` ⇒ 下面四行 RED（回到「挂新 id、谁也没收、end 成孤儿」的旧行为）。
      expect(chunks.filter((c) => c.type === 'tool_call_start')).toHaveLength(1);
      expect(chunks).toContainEqual({ type: 'tool_call_delta', id: 'toolu_1', argumentsDelta: '{"seed":true}' });
      expect(chunks).not.toContainEqual({ type: 'tool_call_delta', id: 'toolu_2', argumentsDelta: '{"seed":true}' });
      // 该 index 的 content_block_stop 也回到原 id：不再产生孤儿 tool_call_end。
      expect(chunks).toContainEqual({ type: 'tool_call_end', id: 'toolu_1' });
      expect(chunks).not.toContainEqual({ type: 'tool_call_end', id: 'toolu_2' });

      // 【文案】行为已变，文案就**不得**再把「不同 id」写成会丢（只改一半 ⇒ 本行 RED）；
      // 但「一律未丢」同样是谎话：真正仍会丢的形态（无 id/name）必须仍在场，所以
      // /未丢/ 与 /丢失/ 都要有，而「不同 id ⇒ …丢失」这种旧措辞不许回来。
      expect(warns).toHaveLength(1);
      expect(warns[0]!).toContain('cause=duplicate-start');
      expect(warns[0]!).toMatch(/未丢/);
      expect(warns[0]!).toMatch(/丢失/);
      expect(warns[0]!).not.toMatch(/已丢弃/);
      expect(warns[0]!).not.toMatch(/不同 id[^；。]*丢失/); // ← Round 68 的新方向锁
    } finally {
      fake.close();
    }
  });
});