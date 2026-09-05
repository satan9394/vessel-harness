import { describe, it, expect } from 'vitest';
import { MockProvider, OpenAICompatibleProvider } from './index.js';
import * as http from 'node:http';

describe('MockProvider', () => {
  it('matches first script entry and substitutes placeholders', async () => {
    const p = new MockProvider(
      [
        { when: /read/i, ifNoToolResult: true, response: { toolCalls: [{ name: 'Read', arguments: { path: '{cwd}/f.txt' } }] } },
        { when: /.*/, response: { text: 'result: {last_tool_result}' } },
      ],
      { vars: { cwd: '/ws' } },
    );
    const r1 = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'please read the file' }] });
    expect(r1.toolCalls).toHaveLength(1);
    expect(r1.toolCalls[0]!.arguments.path).toBe('/ws/f.txt');
    const r2 = await p.chat({
      model: 'm',
      messages: [
        { role: 'user', content: 'please read the file' },
        { role: 'tool', content: 'FILE-BODY', toolCallId: 'tc1', name: 'Read' },
      ],
    });
    expect(r2.content).toContain('FILE-BODY');
  });

  it('ifNoToolResult prevents infinite tool loops', async () => {
    const p = new MockProvider([
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Glob', arguments: {} }] } },
      { when: /.*/, response: { text: 'done' } },
    ]);
    const r1 = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(r1.toolCalls).toHaveLength(1);
    const r2 = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }, { role: 'tool', content: 'ok', toolCallId: 't1' }] });
    expect(r2.toolCalls).toHaveLength(0);
    expect(r2.content).toBe('done');
  });
});

describe('OpenAICompatibleProvider (wire format via local HTTP server)', () => {
  it('POSTs chat/completions and parses function-calling tool calls', async () => {
    const received: unknown[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: null,
              tool_calls: [{ id: 'tc9', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } },
        }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as { port: number };

    const p = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${addr.port}`, model: 'deepseek-test', apiKey: 'k' });
    const resp = await p.chat({
      model: 'deepseek-test',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'read a.txt' },
      ],
      tools: [{ type: 'function', function: { name: 'Read', description: 'd', parameters: { type: 'object' } } }],
    });
    expect(resp.toolCalls[0]).toMatchObject({ id: 'tc9', name: 'Read', arguments: { path: 'a.txt' } });
    expect(resp.usage.inputTokens).toBe(10);
    expect(resp.usage.cacheReadTokens).toBe(3);

    const sent = received[0] as { messages: unknown[]; tools?: unknown[]; model: string };
    expect(sent.model).toBe('deepseek-test');
    expect(sent.messages).toHaveLength(2);
    expect(sent.tools).toHaveLength(1);
    server.close();
  });

  it('maps tool results back to role:tool messages with tool_call_id', async () => {
    const sent: unknown[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        sent.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as { port: number };
    const p = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${addr.port}`, model: 'm' });
    await p.chat({
      model: 'm',
      messages: [{ role: 'tool', content: 'body', toolCallId: 'tc7', name: 'Read' }],
    });
    const m = (sent[0] as { messages: Record<string, unknown>[] }).messages[0]!;
    expect(m.role).toBe('tool');
    expect(m.tool_call_id).toBe('tc7');
    server.close();
  });
});
