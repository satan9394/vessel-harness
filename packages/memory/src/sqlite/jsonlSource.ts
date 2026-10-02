import * as fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { createInterface } from 'node:readline';
import type { SessionRecord } from '@vessel/shared';

/** Streaming replay accepts a torn/malformed line without changing authoritative bytes. */
export async function* streamJsonlRecords(file: string): AsyncIterable<SessionRecord> {
  if (!fs.existsSync(file)) return;
  const input = fs.createReadStream(file); const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try {
        const record = JSON.parse(line) as SessionRecord;
        if (Number.isSafeInteger(record.seq) && record.seq > 0 && typeof record.type === 'string' && typeof record.ts === 'string') yield record;
      } catch { /* ponytail: malformed tail/records are skipped like core replay. */ }
    }
  } finally { lines.close(); input.destroy(); }
}

/** Synchronous metadata registries can stream their append-only journal without full-file buffering. */
export function* jsonlLinesSync(file: string): Generator<string> {
  const fd = fs.openSync(file, 'r'); const decoder = new StringDecoder('utf8'); const buffer = Buffer.alloc(64 * 1024); let pending = '';
  try {
    let bytes: number;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      pending += decoder.write(buffer.subarray(0, bytes));
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) { yield pending.slice(0, end); pending = pending.slice(end + 1); }
    }
    pending += decoder.end(); if (pending.trim()) yield pending;
  } finally { fs.closeSync(fd); }
}
