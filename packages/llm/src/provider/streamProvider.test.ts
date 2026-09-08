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