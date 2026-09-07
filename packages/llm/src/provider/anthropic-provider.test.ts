import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AnthropicProvider } from './AnthropicProvider.js';
import { createProvider } from './createProvider.js';
import type { ChatMessage } from '@cah/shared';

/** Boot a local HTTP server that records requests and responds with a canned body. */
function fakeAnthropicServer(handler: (body: unknown) => unknown) {
  const received: unknown[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handler(JSON.parse(raw))));
    });
  });
  return new Promise<{ server: http.Server; received: unknown[]; url: string; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        received,
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}

const TEXT_RESPONSE = {
  content: [{ type: 'text', text: '你好，我是 Claude' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 12, output_tokens: 5 },
};

const TOOL_USE_RESPONSE = {
  content: [
    { type: 'text', text: '我来读取文件' },
    { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { path: 'a.txt' } },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 20, output_tokens: 8 },
};

describe('AnthropicProvider — wire format (local fake /v1/messages)', () => {
  it('POSTs to /v1/messages with x-api-key + anthropic-version, system as top-level', async () => {
    const fake = await fakeAnthropicServer(() => TEXT_RESPONSE);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'sk-ant-test', model: 'claude-sonnet-4' });
      const messages: ChatMessage[] = [
        { role: 'system', content: '你是编码代理。' },
        { role: 'user', content: '你好' },
      ];
      const r = await p.chat({ model: 'claude-sonnet-4', messages });
      const sent = fake.received[0] as { url: string; headers: Record<string, string>; body: { system: string; messages: unknown[]; max_tokens: number } };
      expect(sent.url).toBe('/v1/messages');
      expect(sent.headers['x-api-key']).toBe('sk-ant-test');
      expect(sent.headers['anthropic-version']).toBe('2023-06-01');
      expect(sent.body.system).toContain('编码代理');
      expect(sent.body.max_tokens).toBeGreaterThan(0); // Anthropic REQUIRES max_tokens
      // system message is NOT inside messages[]
      expect(sent.body.messages).toHaveLength(1);
      expect(r.content).toContain('你好，我是 Claude');
      expect(r.finishReason).toBe('stop');
      expect(r.usage.inputTokens).toBe(12);
      expect(r.usage.outputTokens).toBe(5);
    } finally {
      fake.close();
    }
  });

  it('parses tool_use blocks into toolCalls and maps stop_reason=tool_use → tool_calls', async () => {
    const fake = await fakeAnthropicServer(() => TOOL_USE_RESPONSE);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm' });
      const r = await p.chat({ model: 'm', messages: [{ role: 'user', content: '读文件' }] });
      expect(r.toolCalls).toHaveLength(1);
      expect(r.toolCalls[0]!.id).toBe('toolu_01');
      expect(r.toolCalls[0]!.name).toBe('Read');
      expect(r.toolCalls[0]!.arguments).toEqual({ path: 'a.txt' });
      expect(r.finishReason).toBe('tool_calls');
      expect(r.content).toContain('我来读取文件');
    } finally {
      fake.close();
    }
  });

  it('sends tool definitions as input_schema and tool results as user tool_result blocks', async () => {
    const fake = await fakeAnthropicServer(() => TEXT_RESPONSE);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm' });
      const messages: ChatMessage[] = [
        { role: 'user', content: '读 a.txt' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'toolu_01', name: 'Read', arguments: { path: 'a.txt' } }] },
        { role: 'tool', content: 'FILE-BODY', toolCallId: 'toolu_01', name: 'Read' },
      ];
      await p.chat({
        model: 'm',
        messages,
        tools: [{ type: 'function', function: { name: 'Read', description: 'read', parameters: { type: 'object', properties: {} } } }],
      });
      const sent = fake.received[0] as { body: { tools: unknown[]; messages: { role: string; content: unknown }[] } };
      const toolDef = (sent.body.tools as { name: string; input_schema: unknown }[])[0]!;
      expect(toolDef.name).toBe('Read');
      expect(toolDef.input_schema).toBeDefined();
      // last message is the user carrying a tool_result block
      const last = sent.body.messages[sent.body.messages.length - 1]!;
      expect(last.role).toBe('user');
      const blocks = last.content as { type: string; tool_use_id: string; content: string }[];
      expect(blocks[0]!.type).toBe('tool_result');
      expect(blocks[0]!.tool_use_id).toBe('toolu_01');
      expect(blocks[0]!.content).toContain('FILE-BODY');
    } finally {
      fake.close();
    }
  });

  it('maps max_tokens stop_reason → length; surfaces API errors', async () => {
    const fakeMax = await fakeAnthropicServer(() => ({ content: [{ type: 'text', text: 't' }], stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 1 } }));
    try {
      const p = new AnthropicProvider({ baseUrl: fakeMax.url, apiKey: 'k', model: 'm' });
      const r = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
      expect(r.finishReason).toBe('length');
    } finally {
      fakeMax.close();
    }
  });

  it('merges OpenAI-style [assistant(toolCalls)][tool×N][user] into [assistant(tool_use)][user(tool_result merged)]', async () => {
    const fake = await fakeAnthropicServer(() => TEXT_RESPONSE);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm' });
      const messages: ChatMessage[] = [
        { role: 'user', content: '读两个文件' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'ta', name: 'Read', arguments: { path: 'a' } }, { id: 'tb', name: 'Read', arguments: { path: 'b' } }] },
        { role: 'tool', content: 'A-BODY', toolCallId: 'ta', name: 'Read' },
        { role: 'tool', content: 'B-BODY', toolCallId: 'tb', name: 'Read' },
        { role: 'user', content: '请继续' },
      ];
      await p.chat({ model: 'm', messages });
      const sent = fake.received[0] as { body: { messages: { role: string; content: unknown }[] } };
      const roles = sent.body.messages.map((m) => m.role);
      // user, assistant(tool_use), user(tool_result merged + 继续) — no standalone tool messages
      expect(roles).toEqual(['user', 'assistant', 'user']);
      const assistant = sent.body.messages[1]!;
      const aBlocks = assistant.content as { type: string; id: string }[];
      expect(aBlocks.filter((b) => b.type === 'tool_use')).toHaveLength(2);
      const finalUser = sent.body.messages[2]!;
      const uBlocks = finalUser.content as { type: string; tool_use_id: string; content: string }[];
      const results = uBlocks.filter((b) => b.type === 'tool_result');
      expect(results).toHaveLength(2); // both tool results merged into one user message
      expect(results.map((r) => r.tool_use_id).sort()).toEqual(['ta', 'tb']);
    } finally {
      fake.close();
    }
  });
});

describe('createProvider — multi-vendor factory', () => {
  it('returns an AnthropicProvider for "anthropic"', () => {
    const p = createProvider('anthropic', { baseUrl: 'http://x', apiKey: 'k', model: 'm' });
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p.id).toBe('anthropic');
  });

  it('throws for an unknown provider name', () => {
    expect(() => createProvider('unknown-vendor', { model: 'm' })).toThrow(/unknown provider/);
  });

  it('anthropic requires baseUrl', () => {
    expect(() => createProvider('anthropic', { model: 'm' })).toThrow(/requires baseUrl/);
  });
});
