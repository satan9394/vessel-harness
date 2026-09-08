import { describe, it, expect } from 'vitest';
import { SidecarFramer, encodeFrame, decodeFrame, MAX_FRAME_BYTES } from './framer.js';
import type { JsonRpcRequest } from './types.js';

describe('sidecar framing (task 070)', () => {
  it('splits newline-delimited frames from arbitrary chunk boundaries', () => {
    const framer = new SidecarFramer();
    const frames: string[] = [];
    // chunk 1: one complete line + the head of the next frame (no newline yet)
    framer.push('{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","id":2', (f) => frames.push(f));
    expect(frames).toEqual(['{"jsonrpc":"2.0","id":1}']); // only the complete line

    // chunk 2: completes frame 2 and delivers a third
    framer.push('}\n{"jsonrpc":"2.0","id":3}\n', (f) => frames.push(f));
    expect(frames).toEqual([
      '{"jsonrpc":"2.0","id":1}',
      '{"jsonrpc":"2.0","id":2}',
      '{"jsonrpc":"2.0","id":3}',
    ]);
  });

  it('strips CRLF line terminator (windows stdio)', () => {
    const framer = new SidecarFramer();
    const frames: string[] = [];
    framer.push('{"id":1}\r\n', (f) => frames.push(f));
    expect(frames).toEqual(['{"id":1}']);
  });

  it('skips blank lines between messages', () => {
    const framer = new SidecarFramer();
    const frames: string[] = [];
    framer.push('{"id":1}\n\n\n{"id":2}\n', (f) => frames.push(f));
    expect(frames).toEqual(['{"id":1}', '{"id":2}']);
  });

  it('rejects a single giant frame over the cap as corrupt', () => {
    const framer = new SidecarFramer(8);
    // build a frame longer than cap (8 bytes) without a newline yet
    expect(() => framer.push('{"id":"abcdefghijklmnop"}', () => undefined)).toThrow(
      /maxBytes/,
    );
  });

  it('encodeFrame produces a single newline-terminated JSON line', () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 42, method: 'ping' };
    const frame = encodeFrame(req);
    expect(frame).toBe('{"jsonrpc":"2.0","id":42,"method":"ping"}\n');
    // JSON stringify escapes embedded \n inside string values → still one line
    const withNewline = encodeFrame({ message: 'a\nb' });
    expect(withNewline).not.toMatch(/\n[^\n]*\n/);
    expect(withNewline.endsWith('\n')).toBe(true);
  });

  it('decodeFrame parses a valid frame and throws on invalid JSON', () => {
    const parsed = decodeFrame('{"id":1,"method":"ping"}');
    expect(parsed).toEqual({ id: 1, method: 'ping' });
    expect(() => decodeFrame('{ not json')).toThrow(/invalid JSON frame/);
  });

  it('exposes MAX_FRAME_BYTES as a sane non-negative default', () => {
    expect(MAX_FRAME_BYTES).toBeGreaterThan(1024);
  });
});