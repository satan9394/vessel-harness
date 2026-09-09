import { describe, it, expect } from 'vitest';
import { parseAnthropicEvent, AnthropicStreamParser, anthropicFinishReason } from './parseAnthropic.js';
import type { StreamChunk } from '@vessel/shared';

describe('parseAnthropicEvent — content_block_delta → text_delta', () => {
  it('maps text_delta to a text chunk', () => {
    const chunks = parseAnthropicEvent(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }));
    expect(chunks).toEqual([{ type: 'text_delta', text: 'Hello' }]);
  });

  it('maps content_block_start tool_use to tool_call_start', () => {
    const chunks = parseAnthropicEvent(
      JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'Read', input: {} } }),
    );
    expect(chunks).toEqual([{ type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '{}' }]);
  });

  it('maps message_delta usage + stop_reason to usage and message_end', () => {
    const chunks = parseAnthropicEvent(
      JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }),
    );
    expect(chunks).toContainEqual({ type: 'usage', inputTokens: undefined, outputTokens: 9, cacheReadTokens: undefined });
    expect(chunks).toContainEqual({ type: 'message_end', finishReason: 'stop' });
  });

  it('maps message_start to message_start with model', () => {
    const chunks = parseAnthropicEvent(JSON.stringify({ type: 'message_start', model: 'claude-sonnet-4' }));
    expect(chunks).toContainEqual({ type: 'message_start', model: 'claude-sonnet-4' });
  });
});

describe('parseAnthropicEvent — cache write usage (task 099)', () => {
  it('maps message_start message.usage.cache_creation_input_tokens → cacheCreationTokens', () => {
    const chunks = parseAnthropicEvent(
      JSON.stringify({
        type: 'message_start',
        message: { model: 'claude-sonnet-4', usage: { input_tokens: 12, cache_creation_input_tokens: 2095, cache_read_input_tokens: 1024 } },
      }),
    );
    expect(chunks).toContainEqual({
      type: 'usage',
      inputTokens: 12,
      outputTokens: undefined,
      cacheReadTokens: 1024,
      cacheCreationTokens: 2095,
    });
  });

  it('message_delta without cache fields leaves cacheCreationTokens undefined (per-field merge, no clobber)', () => {
    const chunks = parseAnthropicEvent(
      JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }),
    );
    const usage = chunks.find((c) => c.type === 'usage') as { cacheCreationTokens?: number } | undefined;
    expect(usage).toBeDefined();
    expect(usage!.cacheCreationTokens).toBeUndefined();
  });
});

describe('parseAnthropicEvent — finish reason mapping', () => {
  it('maps anthropic stop reasons to ChatResponse-style values', () => {
    expect(anthropicFinishReason('end_turn')).toBe('stop');
    expect(anthropicFinishReason('tool_use')).toBe('tool_calls');
    expect(anthropicFinishReason('max_tokens')).toBe('length');
    expect(anthropicFinishReason('stop_sequence')).toBe('stop');
  });
});

describe('AnthropicStreamParser — full SSE event stream', () => {
  it('assembles a tool-use exchange into typed chunks with real ids', () => {
    const p = new AnthropicStreamParser();
    const lines = [
      'event: message_start',
      'data: {"type":"message_start","model":"claude-sonnet-4"}',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Reading "}}',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"Read","input":{}}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"a.txt\\"}"}}',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":1}',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}',
      'event: message_stop',
      'data: {"type":"message_stop"}',
    ];
    const chunks: StreamChunk[] = [];
    for (const l of lines) chunks.push(...p.feed(l));

    expect(chunks[0]).toEqual({ type: 'message_start', model: 'claude-sonnet-4' });
    expect(chunks.map((c) => c.type)).toContain('text_delta');
    const startIdx = chunks.findIndex((c) => c.type === 'tool_call_start');
    expect(chunks[startIdx]).toEqual({ type: 'tool_call_start', id: 'toolu_01', name: 'Read', arguments: '{}' });
    const deltas = chunks.filter((c) => c.type === 'tool_call_delta') as { id: string; argumentsDelta: string }[];
    expect(deltas).toHaveLength(2);
    expect(deltas.every((d) => d.id === 'toolu_01')).toBe(true);
    expect(deltas[0]!.argumentsDelta).toBe('{"path":');
    expect(deltas[1]!.argumentsDelta).toBe('"a.txt"}');
    const end = chunks.find((c) => c.type === 'tool_call_end');
    expect((end as { id: string }).id).toBe('toolu_01');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'message_end' });
  });

  it('ignores ping/keepalive frames without data payloads', () => {
    const p = new AnthropicStreamParser();
    const chunks = p.feed(': ping');
    expect(chunks).toEqual([]);
  });
});