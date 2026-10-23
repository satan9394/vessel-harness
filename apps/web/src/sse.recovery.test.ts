import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventStream } from './sse';

class Source {
  static all: Source[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { Source.all.push(this); }
  close() { this.closed = true; }
  emit(type: string, cursor: number, delta: unknown = {}, sessionId = 'one', streamId = 'epoch') {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ version: 1, sessionId, streamId, cursor, eventId: `${streamId}:${cursor}`, type, delta }) }));
  }
}
afterEach(() => { Source.all = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('session stream recovery', () => {
  it('recreates native transports through temporary HTTP failures for 30 seconds and cancels retries on close', async () => {
    vi.useFakeTimers(); vi.stubGlobal('EventSource', Source);
    const stream = createEventStream('/api/sessions/one/events?hydrate=1');
    Source.all[0].emit('transcript', 4, { messages: [], usage: [] });
    for (let second = 0; second < 30; second++) {
      Source.all.at(-1)!.onerror?.();
      await vi.advanceTimersByTimeAsync(1000);
      expect(Source.all.at(-1)!.url).toContain('cursor=epoch%3A4');
    }
    expect(Source.all).toHaveLength(31);
    Source.all.at(-1)!.emit('transcript', 8, { messages: [], usage: [] });
    Source.all.at(-1)!.onerror?.(); stream.close();
    await vi.advanceTimersByTimeAsync(30_000); expect(Source.all).toHaveLength(31);
  });
  it('deduplicates two copies, resumes a dropped or reordered frame, rejects foreign sessions and ignores obsolete transports', () => {
    vi.stubGlobal('EventSource', Source);
    const onUsage = vi.fn(), onTranscript = vi.fn(), onDisconnect = vi.fn(), onError = vi.fn();
    const stream = createEventStream('/api/sessions/one/events?hydrate=1', { onUsage, onTranscript, onDisconnect, onError });
    const first = Source.all[0];
    first.emit('ping', 0);
    first.emit('transcript', 0, { messages: [], usage: [] });
    first.emit('usage', 1, { inputTokens: 5 }); first.emit('usage', 1); first.emit('usage', 1);
    expect(onUsage).toHaveBeenCalledTimes(1);
    first.emit('usage', 3); // frame two was dropped or reordered
    expect(first.closed).toBe(true);
    expect(Source.all[1].url).toContain('cursor=epoch%3A1');
    first.emit('usage', 2); expect(onUsage).toHaveBeenCalledTimes(1);
    const resumed = Source.all[1]; resumed.emit('usage', 2, { inputTokens: 7 }); resumed.emit('usage', 3);
    resumed.emit('transcript', 3, { messages: [], usage: [{ inputTokens: 12 }] });
    resumed.emit('usage', 4, {}, 'two'); expect(onError).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledTimes(3);
    expect(onTranscript).toHaveBeenCalledTimes(2);
    stream.close(); resumed.emit('usage', 4); expect(onUsage).toHaveBeenCalledTimes(3);
  });

  it('detects a lost final frame from a heartbeat watermark and accepts a new epoch checkpoint', () => {
    vi.stubGlobal('EventSource', Source);
    const onRun = vi.fn();
    createEventStream('/api/sessions/one/events', { onRun });
    Source.all[0].emit('checkpoint', 5, { run: { active: true } });
    Source.all[0].emit('ping', 6);
    expect(Source.all).toHaveLength(2);
    Source.all[1].emit('checkpoint', 0, { run: { active: false, kind: 'interrupted' } }, 'one', 'new-epoch');
    expect(onRun.mock.calls).toEqual([[{ active: true }], [{ active: false, kind: 'interrupted' }]]);
  });

  it('resumes the Bearer transport with Last-Event-ID after 30 seconds and stops after auth rejection', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const payload = 'id: epoch:1\ndata: ' + JSON.stringify({ version: 1, sessionId: 'one', streamId: 'epoch', cursor: 1, type: 'transcript', delta: { messages: [], usage: [] } }) + '\n\n';
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode(payload)); c.close(); } })))
      .mockResolvedValue(new Response('', { status: 401 }));
    const onTranscript = vi.fn(), onDisconnect = vi.fn();
    const stream = createEventStream('/api/sessions/one/events?hydrate=1', { onTranscript, onDisconnect }, { token: 'fixture-token', fetch: fetcher, reconnectMs: 30_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onTranscript).toHaveBeenCalledTimes(1); expect(onDisconnect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher.mock.calls[1][1].headers['Last-Event-ID']).toBe('epoch:1');
    await vi.advanceTimersByTimeAsync(90_000); expect(fetcher).toHaveBeenCalledTimes(2);
    stream.close();
  });
});
