import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAICompatibleProvider, AnthropicProvider, MockProvider } from '../index.js';
import type { StreamChunk } from '@vessel/shared';

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