import { afterEach, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../provider/OpenAICompatibleProvider.js';
import { AnthropicProvider } from '../provider/AnthropicProvider.js';
import { OpencodeGoProvider } from '../provider/OpencodeGoProvider.js';
import type { ChatRequest } from '@vessel/shared';
import { canonicalJson } from './canonicalJson.js';

afterEach(() => vi.unstubAllGlobals());
it.each(['openai', 'anthropic', 'go'] as const)('canonical schemas and tool arguments reach %s wire', async kind => {
  const bodies: string[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    bodies.push(init.body as string);
    return new Response(JSON.stringify(kind === 'anthropic'
      ? { content: [], stop_reason: 'end_turn' }
      : { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), { status: 200 });
  });
  const options = { baseUrl: 'https://example.invalid', model: 'deepseek-v3' };
  const provider = kind === 'openai' ? new OpenAICompatibleProvider(options) : kind === 'anthropic' ? new AnthropicProvider(options) : new OpencodeGoProvider(options);
  const request = (reversed: boolean): ChatRequest => ({ model: 'deepseek-v3', messages: [{ role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'Read', arguments: reversed ? { a: 1, z: 2 } : { z: 2, a: 1 } }] }],
    tools: [{ type: 'function', function: { name: 'Read', description: 'Read', parameters: reversed ? { properties: { a: { type: 'string' }, z: { type: 'number' } }, type: 'object' } : { type: 'object', properties: { z: { type: 'number' }, a: { type: 'string' } } } } }] });
  await provider.chat(request(false)); await provider.chat(request(true));
  expect(bodies[0]).toBe(bodies[1]);
  expect(bodies[0]).toBe(canonicalJson(JSON.parse(bodies[0]!)));
});
it.each(['openai', 'anthropic'] as const)('stream requests use canonical bytes for %s', async kind => {
  let body = '';
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    body = init.body as string;
    return new Response(kind === 'openai' ? 'data: [DONE]\n\n' : 'event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });
  const options = { baseUrl: 'https://example.invalid', model: 'm' };
  const provider = kind === 'openai' ? new OpenAICompatibleProvider(options) : new AnthropicProvider(options);
  for await (const _chunk of provider.stream({ model: 'm', messages: [], tools: [{ type: 'function', function: { name: 't', description: '', parameters: { z: 2, a: 1 } } }] })) { /* drain */ }
  expect(body).toBe(canonicalJson(JSON.parse(body)));
});
