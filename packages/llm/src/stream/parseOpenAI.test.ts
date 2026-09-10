import { describe, it, expect } from 'vitest';
import {
  parseOpenAIStreamChunk,
  OpenAIStreamParser,
  createOpenAIToolState,
} from './parseOpenAI.js';
import type { StreamChunk } from '@vessel/shared';

const data = (line: string): string => line.replace(/^data: /, '');

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