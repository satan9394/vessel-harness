import { describe, expect, it, vi } from 'vitest';
import type { ChatProvider, ChatRequest, ChatResponse, StreamChunk } from '@vessel/shared';
import { EndpointFailoverProvider, isEndpointFailure } from './EndpointFailoverProvider.js';
import { capabilitiesFor } from '../capabilities.js';

const request: ChatRequest = { model: 'm', messages: [] };
const response: ChatResponse = { content: 'ok', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
const endpoint = (url: string, chat = vi.fn(async () => response)) => ({ url, provider: { id: 'test', chat } });

describe('endpoint failure classification', () => {
  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'])("recognizes %s at top level and under fetch cause", code => {
    expect(isEndpointFailure({ code })).toBe(true);
    expect(isEndpointFailure(new TypeError('fetch failed', { cause: { code } }))).toBe(true);
  });
  it.each([408, 429, 500, 502, 503, 599])('recognizes HTTP %i in supported fields', status => {
    for (const error of [{ status }, { statusCode: status }, { response: { status } }]) expect(isEndpointFailure(error)).toBe(true);
  });
  it.each([400, 401, 403, 404, 422, 600])('does not switch for HTTP %i', status => {
    expect(isEndpointFailure({ status, cause: { code: 'ECONNRESET' } })).toBe(false);
  });
  it.each([new Error('503 ECONNREFUSED'), { name: 'AbortError', code: 'ECONNRESET' }, { cause: { name: 'AbortError' }, code: 'ECONNRESET' }, null, 'ECONNREFUSED'])('rejects unknown and aborted errors: %j', error => {
    expect(isEndpointFailure(error)).toBe(false);
  });
});

it('visits endpoints in order, remembers success, then visits remaining endpoints in registration order', async () => {
  const error = { status: 503 };
  const a = endpoint('a', vi.fn().mockRejectedValue(error));
  const b = endpoint('b', vi.fn().mockRejectedValue(error));
  const c = endpoint('c');
  const switched = vi.fn();
  const provider = new EndpointFailoverProvider([a, b, c], switched);
  expect(await provider.chat(request)).toBe(response);
  expect(switched.mock.calls).toEqual([['a', 'b'], ['b', 'c']]);
  await provider.chat(request);
  expect(a.provider.chat).toHaveBeenCalledTimes(1);
  expect(c.provider.chat).toHaveBeenCalledTimes(2);
  c.provider.chat.mockRejectedValueOnce(error);
  a.provider.chat.mockResolvedValueOnce(response);
  await provider.chat(request);
  expect(switched.mock.calls.at(-1)).toEqual(['c', 'a']);
  expect(b.provider.chat).toHaveBeenCalledTimes(1);
});

it.each([{ status: 401 }, new Error('unknown'), { name: 'AbortError', code: 'ECONNRESET' }])('rethrows non-endpoint error identity: %j', async error => {
  const a = endpoint('a', vi.fn().mockRejectedValue(error));
  const b = endpoint('b');
  await expect(new EndpointFailoverProvider([a, b]).chat(request)).rejects.toBe(error);
  expect(b.provider.chat).not.toHaveBeenCalled();
});

it('throws the last error after trying each endpoint once', async () => {
  const last = { status: 502 };
  const a = endpoint('a', vi.fn().mockRejectedValue({ status: 503 }));
  const b = endpoint('b', vi.fn().mockRejectedValue(last));
  await expect(new EndpointFailoverProvider([a, b]).chat(request)).rejects.toBe(last);
  expect(a.provider.chat).toHaveBeenCalledTimes(1);
  expect(b.provider.chat).toHaveBeenCalledTimes(1);
});

it.each([false, true])('stream failover respects emitted chunk = %s', async emitted => {
  const error = { status: 503 };
  const chunk: StreamChunk = { type: 'message_start' };
  const a: ChatProvider = { id: 'a', chat: vi.fn(), stream: vi.fn(async function* () { if (emitted) yield chunk; throw error; }) };
  const b: ChatProvider = { id: 'b', chat: vi.fn(), stream: vi.fn(async function* () { yield chunk; }) };
  const provider = new EndpointFailoverProvider([{ url: 'a', provider: a }, { url: 'b', provider: b }]);
  const received: StreamChunk[] = [];
  const consume = async () => { for await (const value of provider.stream!(request)) received.push(value); };
  if (emitted) {
    await expect(consume()).rejects.toBe(error);
    expect(b.stream).not.toHaveBeenCalled();
  } else {
    await consume();
    await consume();
    expect(a.stream).toHaveBeenCalledTimes(1);
    expect(b.stream).toHaveBeenCalledTimes(2);
  }
  expect(received).toEqual(emitted ? [chunk] : [chunk, chunk]);
});

it('does not switch on cancellation even when the transport reports a network code', async () => {
  const controller = new AbortController();
  const error = { code: 'ECONNRESET' };
  const a = endpoint('a', vi.fn(async () => { controller.abort(); throw error; }));
  const b = endpoint('b');
  await expect(new EndpointFailoverProvider([a, b]).chat({ ...request, signal: controller.signal })).rejects.toBe(error);
  expect(b.provider.chat).not.toHaveBeenCalled();
});

it('preserves metadata and leaves stream absent for chat-only providers', () => {
  const capabilities = capabilitiesFor('openai-compatible');
  const a = { url: 'a', provider: { ...endpoint('a').provider, capabilities, defaultMaxOutputTokens: 123 } };
  const provider = new EndpointFailoverProvider([a, endpoint('b')]);
  expect(provider.id).toBe(a.provider.id);
  expect(provider.capabilities).toBe(capabilities);
  expect(provider.defaultMaxOutputTokens).toBe(123);
  expect(provider.stream).toBeUndefined();
});
