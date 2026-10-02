import { describe, expect, it, vi } from 'vitest';
import { enforceBoundedOutput } from './boundedOutput.js';

describe('bounded tool output', () => {
  it('preserves empty, short and exact-cap content', () => {
    for (const output of ['', 'hello 世界', 'x'.repeat(65536)]) expect(enforceBoundedOutput(output)).toEqual({ content: output, truncated: false, originalBytes: Buffer.byteLength(output), truncatedBytes: 0 });
  });
  it('keeps both edges and includes original/removed byte counts within the strict cap', () => {
    const output = 'HEAD' + 'x'.repeat(200000) + 'TAIL';
    const result = enforceBoundedOutput(output);
    expect(result.content.startsWith('HEAD')).toBe(true); expect(result.content.endsWith('TAIL')).toBe(true);
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(65536);
    expect(result.content).toContain(`original ${result.originalBytes} bytes; removed ${result.truncatedBytes} bytes`);
    const marker = result.content.match(/\n\[Output truncated:.*?\]\n/)![0];
    expect(result.truncatedBytes).toBe(result.originalBytes - Buffer.byteLength(result.content) + Buffer.byteLength(marker));
    expect(result.truncated).toBe(true);
  });
  it('never splits emoji surrogate pairs or UTF-8 CJK sequences at either edge', () => {
    const output = '头🙂汉字é'.repeat(20000) + '尾🙂';
    for (const headRatio of [0, 0.2, 0.5, 0.8, 1]) {
      const result = enforceBoundedOutput(output, { maxBytes: 1024, headRatio });
      expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(1024);
      expect(result.content).not.toContain('�');
      expect(Buffer.from(result.content).toString('utf8')).toBe(result.content);
      const [head, tail] = result.content.split(/\n\[Output truncated:.*?\]\n/);
      expect(output.startsWith(head!)).toBe(true); expect(output.endsWith(tail!)).toBe(true);
    }
  });
  it('does not allocate a full payload buffer when truncating a large string', () => {
    const from = vi.spyOn(Buffer, 'from');
    const output = '🙂'.repeat(500000);
    const result = enforceBoundedOutput(output);
    expect(result.originalBytes).toBe(2000000); expect(result.content.length).toBeLessThan(65536);
    expect(from).not.toHaveBeenCalled(); from.mockRestore();
  });
  it('rejects invalid limits/ratios and limits unable to include the required marker', () => {
    for (const maxBytes of [0, -1, NaN, Infinity, 2.5]) expect(() => enforceBoundedOutput('x', { maxBytes })).toThrow(RangeError);
    for (const headRatio of [-0.1, 1.1, NaN]) expect(() => enforceBoundedOutput('x', { headRatio })).toThrow(RangeError);
    expect(() => enforceBoundedOutput('x'.repeat(100), { maxBytes: 1 })).toThrow('truncation marker');
  });
});
