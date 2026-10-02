export interface BoundedOutputOptions { maxBytes?: number; headRatio?: number }
export interface BoundedOutputResult { content: string; truncated: boolean; originalBytes: number; truncatedBytes: number }

/** Scan only the retained edges; never allocate a UTF-8 copy of the full payload. */
function prefixEnd(text: string, budget: number): number {
  let index = 0; let bytes = 0;
  while (index < text.length) {
    const point = text.codePointAt(index)!;
    const size = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    if (bytes + size > budget) break;
    bytes += size; index += point > 65535 ? 2 : 1;
  }
  return index;
}

function suffixStart(text: string, budget: number): number {
  let index = text.length; let bytes = 0;
  while (index > 0) {
    let start = index - 1;
    const last = text.charCodeAt(start);
    if (last >= 0xdc00 && last <= 0xdfff && start > 0) {
      const first = text.charCodeAt(start - 1);
      if (first >= 0xd800 && first <= 0xdbff) start--;
    }
    const point = text.codePointAt(start)!;
    const size = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    if (bytes + size > budget) break;
    bytes += size; index = start;
  }
  return index;
}

export function enforceBoundedOutput(output: string, opts: BoundedOutputOptions = {}): BoundedOutputResult {
  const maxBytes = opts.maxBytes ?? 65536;
  const ratio = opts.headRatio ?? 0.5;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new RangeError('invalid bounded output options');
  const originalBytes = Buffer.byteLength(output, 'utf8');
  if (originalBytes <= maxBytes) return { content: output, truncated: false, originalBytes, truncatedBytes: 0 };
  const marker = (removed: number) => `\n[Output truncated: original ${originalBytes} bytes; removed ${removed} bytes]\n`;
  // Reserve the longest possible marker, including its own bytes in the cap.
  const available = maxBytes - Buffer.byteLength(marker(originalBytes));
  if (available < 0) throw new RangeError('maxBytes cannot hold the truncation marker');
  const head = output.slice(0, prefixEnd(output, Math.floor(available * ratio)));
  const tail = output.slice(suffixStart(output, available - Math.floor(available * ratio)));
  const truncatedBytes = originalBytes - Buffer.byteLength(head) - Buffer.byteLength(tail);
  return { content: head + marker(truncatedBytes) + tail, truncated: true, originalBytes, truncatedBytes };
}
