import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AnthropicProvider } from './AnthropicProvider.js';
import { createProvider } from './createProvider.js';
import type { ChatMessage, StreamChunk } from '@vessel/shared';

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

/** Anthropic reports cache writes beside input/output (task 099). */
const CACHE_WRITE_RESPONSE = {
  content: [{ type: 'text', text: 'cached turn' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 12, output_tokens: 5, cache_creation_input_tokens: 2095, cache_read_input_tokens: 1024 },
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

describe('AnthropicProvider — cache write usage (task 099)', () => {
  it('maps cache_creation_input_tokens → ChatUsage.cacheCreationTokens (non-stream)', async () => {
    const fake = await fakeAnthropicServer(() => CACHE_WRITE_RESPONSE);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'claude-sonnet-4' });
      const r = await p.chat({ model: 'claude-sonnet-4', messages: [{ role: 'user', content: 'hi' }] });
      expect(r.usage.inputTokens).toBe(12);
      expect(r.usage.outputTokens).toBe(5);
      expect(r.usage.cacheReadTokens).toBe(1024);
      expect(r.usage.cacheCreationTokens).toBe(2095);
    } finally {
      fake.close();
    }
  });

  it('leaves cacheCreationTokens undefined (not 0) when the wire omits cache_creation_input_tokens', async () => {
    const fake = await fakeAnthropicServer(() => TEXT_RESPONSE);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'm' });
      const r = await p.chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
      expect(r.usage.cacheCreationTokens).toBeUndefined();
      // 不写 0 假值：下游据 undefined 走「未上报」分支，而非「上报了 0」
      expect(r.usage.cacheCreationTokens).not.toBe(0);
      expect(r.usage.cacheReadTokens).toBeUndefined();
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

// ---------------------------------------------------------------------------
// BRIEF「同一个 wire 值，两个 provider 三套口径」 — 复现 ②（Anthropic **非流式**）。
//
// 同一个 wire 值在同一个 provider 的**两条方法**上得到相反结论：
//   非流式 `chat()`（改前 AnthropicProvider.ts:400-408 的手写三元链）⇒ 未知值 'error'；
//   流式 `parseAnthropic.ts` 的 `anthropicFinishReason`（改前 `default: return stopReason`）
//   ⇒ 原样透传 ⇒ `AgentLoop.normalizeFinishReason` 读成 'stop' ⇒ 真实路径上 kind='success'。
// 本卡后两条方法调用**同一个函数**，所以"同解"是构造出来的、不是靠评审维持的。
// ---------------------------------------------------------------------------

/** Fixed SSE body upstream (`stream()` 用) — sibling of openai-finish-reason.test.ts's fixture. */
function fakeAnthropicSSEServer(sseBody: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(sseBody);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

/**
 * `AgentLoop` 消费侧规则的逐字重放（本包不能 import @vessel/core）：
 *   AgentLoop.ts:641-643 `if (chunk.finishReason) wireFinish = chunk.finishReason;`
 *   AgentLoop.ts:667     `normalizeFinishReason(wireFinish, toolCalls.length > 0)`
 *   AgentLoop.ts:86-90   length/error 透传 → tool_calls/hasToolCalls → 其余 'stop'
 */
function normalizeLikeAgentLoop(chunks: readonly StreamChunk[]): string {
  let wire: string | undefined;
  let hasToolCalls = false;
  for (const c of chunks) {
    if (c.type === 'message_end') {
      if (c.finishReason) wire = c.finishReason;
    } else if (c.type === 'tool_call_start') {
      hasToolCalls = true;
    }
  }
  if (wire === 'length' || wire === 'error') return wire;
  if (wire === 'tool_calls' || hasToolCalls) return 'tool_calls';
  return 'stop';
}

describe('BRIEF「同一个 wire 值，两个 provider 三套口径」— Anthropic chat() 与 stream() 同解', () => {
  /** 最小 Anthropic SSE 体：一段文本 + `message_delta{stop_reason}` + `message_stop`。 */
  function sseBody(stopReason: string | null): string {
    const lines = [
      'event: message_start',
      'data: {"type":"message_start","model":"claude-sonnet-4"}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"半截回答"}}',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
    ];
    if (stopReason !== null) {
      lines.push(
        'event: message_delta',
        `data: {"type":"message_delta","delta":{"stop_reason":${JSON.stringify(stopReason)}},"usage":{"output_tokens":4}}`,
      );
    }
    lines.push('event: message_stop', 'data: {"type":"message_stop"}');
    return lines.join('\n') + '\n';
  }

  /** 非流式：wire `stop_reason` 原样放进 200 响应体。 */
  async function chatVerdict(stopReason: string | undefined): Promise<string> {
    const body: Record<string, unknown> = {
      content: [{ type: 'text', text: '半截回答' }],
      usage: { input_tokens: 5, output_tokens: 4 },
    };
    if (stopReason !== undefined) body.stop_reason = stopReason;
    const fake = await fakeAnthropicServer(() => body);
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'claude-sonnet-4' });
      const r = await p.chat({ model: 'claude-sonnet-4', messages: [{ role: 'user', content: '你好' }] });
      return r.finishReason;
    } finally {
      fake.close();
    }
  }

  /** 流式：真实 SSE 上游 → 真实 AnthropicStreamParser → AgentLoop 逐字重放。 */
  async function streamRun(stopReason: string | null): Promise<{ chunks: StreamChunk[]; loop: string }> {
    const fake = await fakeAnthropicSSEServer(sseBody(stopReason));
    try {
      const p = new AnthropicProvider({ baseUrl: fake.url, apiKey: 'k', model: 'claude-sonnet-4' });
      const chunks: StreamChunk[] = [];
      for await (const c of p.stream({ model: 'claude-sonnet-4', messages: [{ role: 'user', content: '你好' }] })) chunks.push(c);
      return { chunks, loop: normalizeLikeAgentLoop(chunks) };
    } finally {
      fake.close();
    }
  }

  it("② 复现/判别：stop_reason:'refusal' 两条路径**同解**（都 'error'），且流式绝不是 'stop'（改前 chat='error' vs 流式⇒'stop' ⇒ 必红）", async () => {
    const chat = await chatVerdict('refusal');
    const { chunks, loop } = await streamRun('refusal');

    // 判别线 1：流式边界块携带 'error'（改前携带原样透传的 'refusal'）
    expect(chunks).toContainEqual({ type: 'message_end', finishReason: 'error' });
    // 判别线 2：两条路径同解 —— 改前 `chat !== loop`（'error' vs 'stop'），本断言必红
    expect(chat).toBe('error');
    expect(loop).toBe('error');
    expect(chat).toBe(loop);
    // 判别线 3：不得把未知终止原因说成"正常结束"
    expect(loop).not.toBe('stop');
    expect(chunks.some((c) => c.type === 'message_end' && c.finishReason === 'stop')).toBe(false);
  });

  it('②′ 未知值族逐条同解（content_filter / pause_turn / 未来值），且都不是 length', async () => {
    for (const wire of ['content_filter', 'pause_turn', 'model_context_window_exceeded', 'some_future_value']) {
      const chat = await chatVerdict(wire);
      const { loop } = await streamRun(wire);
      expect(chat, `wire=${wire}`).toBe('error');
      expect(loop, `wire=${wire}`).toBe('error');
      expect(chat, `wire=${wire}`).toBe(loop);
      expect(loop, `wire=${wire}`).not.toBe('length');
    }
  });

  it('②″ 负对照：既有映射在两条路径上逐字不变（end_turn/stop_sequence→stop、tool_use→tool_calls、max_tokens→length）', async () => {
    for (const [wire, expected] of [
      ['end_turn', 'stop'],
      ['stop_sequence', 'stop'],
      ['tool_use', 'tool_calls'],
      ['max_tokens', 'length'],
    ] as const) {
      const chat = await chatVerdict(wire);
      const { loop } = await streamRun(wire);
      expect(chat, `wire=${wire}`).toBe(expected);
      expect(loop, `wire=${wire}`).toBe(expected);
      expect(chat, `wire=${wire}`).toBe(loop);
    }
    // 既有的非流式用例钉住的值（anthropic-provider.test.ts 上方三条）不应被本卡改动
    expect(await chatVerdict('end_turn')).toBe('stop');
    expect(await chatVerdict('tool_use')).toBe('tool_calls');
    expect(await chatVerdict('max_tokens')).toBe('length');
  });

  it("③ 负对照：wire **缺失** 的既有语义逐字不变（非流式 'error'、流式不带字段 ⇒ 'stop'）——本卡不顺手“统一”它", async () => {
    // 非流式缺失：改前改后同值 'error'（共享表对 undefined 给 'error'）
    expect(await chatVerdict(undefined)).toBe('error');
    // 流式缺失：message_delta 帧根本不含 stop_reason ⇒ 边界块不带 finishReason ⇒ 既有 'stop'
    const { chunks, loop } = await streamRun(null);
    const ends = chunks.filter((c) => c.type === 'message_end');
    expect(ends).toEqual([{ type: 'message_end' }]);
    expect(loop).toBe('stop');
    // 两条路径的"既有值"不同，但**都不得**变成 'length'
    expect(loop).not.toBe('length');
    expect(await chatVerdict(undefined)).not.toBe('length');
    // 空串：非流式既有 'error'（改前非流式的三元链同样落 'error'），流式仍是"不带字段"
    expect(await chatVerdict('')).toBe('error');
    const emptyStream = await streamRun('');
    expect(emptyStream.chunks.filter((c) => c.type === 'message_end')).toEqual([{ type: 'message_end' }]);
    expect(emptyStream.loop).toBe('stop');
  });
});

