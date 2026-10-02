import { afterEach, describe, expect, it, vi } from 'vitest';
import { bearerHeaders, daemonToken, setDaemonToken } from './auth';
import { createApiClient } from './api';
import { createEventStream } from './sse';
const token = 'ab'.repeat(24);
afterEach(() => { setDaemonToken(undefined); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('daemon browser credentials and authenticated transports', () => {
  it('consumes bootstrap token once into memory without persistent storage', () => {
    const page = globalThis as typeof globalThis & { __VESSEL_DAEMON_TOKEN__?: string };
    page.__VESSEL_DAEMON_TOKEN__ = token; expect(daemonToken()).toBe(token); expect(page.__VESSEL_DAEMON_TOKEN__).toBeUndefined();
    expect(bearerHeaders()).toEqual({ Authorization: `Bearer ${token}` });
    expect(() => setDaemonToken('short')).toThrow('Invalid');
  });
  it('authenticates JSON, raw handoff and artifact requests without URL secrets', async () => {
    const fetcher = vi.fn(async () => new Response('{}')); setDaemonToken(token);
    const api = createApiClient({ fetch: fetcher });
    await api.projects(); await api.handoffMarkdown('r'); await api.downloadTeamArtifact('s', 't', 0);
    for (const call of fetcher.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].headers).toMatchObject({ Authorization: `Bearer ${token}` }); expect(call[0]).not.toContain(token);
    }
  });
  it('decodes fragmented UTF8/CRLF SSE using Bearer and cancels on close', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>; const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel });
    const fetcher = vi.fn(async () => new Response(body)); const onEvent = vi.fn(); const onOpen = vi.fn();
    const stream = createEventStream('/api/events', { onEvent, onOpen }, { token, fetch: fetcher });
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
    const data = new TextEncoder().encode('data: {"type":"conversation","delta":{"text":"你好"}}\r\n\r\n');
    for (let index = 0; index < data.length; index += 3) controller.enqueue(data.slice(index, index + 3));
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ delta: { text: '你好' } })));
    stream.close(); await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(call[1].headers).toEqual({ Authorization: `Bearer ${token}` }); expect(call[1].signal?.aborted).toBe(true);
  });
  it('reports unauthorized streaming once without retrying indefinitely', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async () => new Response('unauthorized', { status: 401 })); const onError = vi.fn();
    const stream = createEventStream('/api/events', { onError }, { token, fetch: fetcher });
    await vi.advanceTimersByTimeAsync(5000); expect(fetcher).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledOnce(); stream.close();
  });
  it('reconnects an ended stream, reconciles on open and cancels its retry timer', async () => {
    vi.useFakeTimers(); const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.close(); } })));
    const onOpen = vi.fn(); const stream = createEventStream('/api/events', { onOpen }, { token, fetch: fetcher, reconnectMs: 10 });
    await vi.advanceTimersByTimeAsync(11); expect(fetcher).toHaveBeenCalledTimes(2); expect(onOpen).toHaveBeenCalledTimes(2);
    stream.close(); await vi.advanceTimersByTimeAsync(100); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
