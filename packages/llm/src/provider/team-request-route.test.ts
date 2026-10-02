import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { OpencodeGoProvider } from './OpencodeGoProvider.js';

afterEach(() => vi.unstubAllGlobals());
describe('snapshotted route reaches provider wire', () => {
  it.each([false, true])('OpenAI model and reasoning effort reach chat/stream (stream=%s)', async stream => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return stream ? new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
        : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
    });
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://example.invalid/v1', model: 'configured' });
    const request = { model: 'snapshot', messages: [], reasoningEffort: 'high' as const, temperature: 0.4 };
    if (stream) { for await (const _chunk of provider.stream(request)) { /* drain */ } }
    else await provider.chat(request);
    expect(bodies[0]).toMatchObject({ model: 'snapshot', reasoning_effort: 'high', temperature: 0.4 });
  });
  it.each([false, true])('Anthropic preserves configured output reserve and request route (stream=%s)', async stream => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return stream ? new Response('event: message_start\ndata: {"type":"message_start","message":{"model":"snapshot","usage":{"input_tokens":1,"output_tokens":0}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n', { headers: { 'content-type': 'text/event-stream' } }) : new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
    });
    const provider = new AnthropicProvider({ baseUrl: 'https://example.invalid', model: 'configured', defaultMaxTokens: 8192 });
    expect(provider.defaultMaxOutputTokens).toBe(8192);
    const request = { model: 'snapshot', messages: [], temperature: 0.2, reasoningEffort: 'high' as const };
    if (stream) { for await (const _chunk of provider.stream(request)) { /* drain */ } }
    else await provider.chat(request);
    expect(body).toMatchObject({ model: 'snapshot', max_tokens: 8192, temperature: 0.2, output_config: { effort: 'high' } });
  });
  it('OpencodeGo exposes reserve and serializes optional reasoning', () => {
    const provider = new OpencodeGoProvider({ baseUrl: 'https://example.invalid', model: 'deepseek-v3', defaultMaxTokens: 8192 });
    expect(provider.defaultMaxOutputTokens).toBe(8192);
    expect(provider.body('snapshot', { model: 'snapshot', messages: [], reasoningEffort: 'medium' })).toMatchObject({ max_tokens: 8192, reasoning_effort: 'medium' });
  });
});
