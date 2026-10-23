import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionEventStream } from './sessionEventStream.js';

const decode = (text: string) => text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
afterEach(() => vi.useRealTimers());

describe('session event replay', () => {
  it('keeps one immutable ordered frame for multiple observers and resumes after 30 seconds offline', () => {
    vi.useFakeTimers();
    const snapshot = vi.fn(() => ({ messages: [], usage: [], run: { active: false } }));
    const stream = new SessionEventStream('one', snapshot);
    const a: string[] = [], b: string[] = [];
    const detach = stream.subscribe(text => a.push(text));
    stream.subscribe(text => b.push(text));
    const delta = { text: 'original' };
    stream.publish('conversation', delta); delta.text = 'mutated';
    expect(a[1]).toBe(b[1]); detach();
    vi.advanceTimersByTime(30_000);
    stream.publish('usage', { inputTokens: 5 });
    const recovered: string[] = [];
    stream.subscribe(text => recovered.push(text), `${stream.streamId}:1`);
    expect(recovered.flatMap(decode).map(frame => [frame.cursor, frame.type])).toEqual([[2, 'usage'], [2, 'transcript']]);
    expect(a.flatMap(decode)[1].delta.text).toBe('original');
    expect(decode(stream.heartbeat())[0].cursor).toBe(2);
    expect(stream.heartbeat()).not.toContain('id:');
    stream.close(); stream.publish('usage', {}); expect(b).toHaveLength(3);
  });

  it('falls back to the authoritative checkpoint for evicted, future and foreign epoch cursors', () => {
    const stream = new SessionEventStream('one', () => ({ current: true }), 1);
    stream.publish('tool', {}); stream.publish('usage', {});
    for (const id of [`${stream.streamId}:0`, `${stream.streamId}:99`, 'other:1', 'bad']) {
      const frames: string[] = []; const detach = stream.subscribe(text => frames.push(text), id, false);
      expect(frames.flatMap(decode)).toMatchObject([{ sessionId: 'one', cursor: 2, type: 'checkpoint', delta: { current: true } }]);
      detach();
    }
    const tiny = new SessionEventStream('two', () => ({}), 512, 1);
    tiny.publish('large', 'oversized');
    const frames: string[] = []; tiny.subscribe(text => frames.push(text), `${tiny.streamId}:0`);
    expect(frames.flatMap(decode).map(frame => frame.type)).toEqual(['transcript']);
  });
});
