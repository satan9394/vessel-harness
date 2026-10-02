import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { renameWithRetryAsync, type SessionRecord } from '@vessel/shared';
import type { SessionChunkMeta, StreamingSessionWriter } from './types.js';

const MAGIC = 'VESSEL01';
const HEADER_BYTES = 44;
const MAX_BYTES = 16 * 1024 * 1024;
const writers = new Set<string>();
const digest = (value: Buffer): Buffer => createHash('sha256').update(value).digest();

export interface ChunkedSessionOptions {
  dir: string;
  maxChunkBytes?: number;
  compressed?: boolean;
}

/** Explicit alternative event archive. It does not change Session JSONL/replay semantics.
 * append is buffered; flush/close are durable barriers. One writer per directory,
 * with cross-process ownership enforced by an exclusive marker (never hard-deleted).
 */
export class ChunkedSession implements StreamingSessionWriter {
  private chunks: SessionChunkMeta[] = [];
  private pending: SessionRecord[] = [];
  private pendingBytes = 0;
  private seq = 0;
  private queue: Promise<void> = Promise.resolve();
  private failure: unknown;
  private closing = false;
  private closePromise?: Promise<void>;
  private readonly maxBytes: number;
  private readonly compressed: boolean;
  private constructor(readonly dir: string, options: ChunkedSessionOptions) {
    this.maxBytes = options.maxChunkBytes ?? 256 * 1024;
    this.compressed = options.compressed ?? true;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 256 || this.maxBytes > MAX_BYTES) {
      throw new RangeError('maxChunkBytes must be 256..16777216');
    }
  }

  static async open(options: ChunkedSessionOptions): Promise<ChunkedSession> {
    const dir = path.resolve(options.dir);
    const session = new ChunkedSession(dir, options);
    if (writers.has(dir)) throw new Error('Streaming session already open');
    writers.add(dir);
    let claim: fs.FileHandle | undefined;
    let ownsMarker = false;
    try {
      await fs.mkdir(dir, { recursive: true });
      const marker = path.join(dir, 'writer.json');
      // Serialize ownership changes across processes. A crashed acquisition is
      // fail-closed; a steady-state dead writer can be reclaimed under this gate.
      claim = await fs.open(path.join(dir, 'writer.claim'), 'wx');
      try {
        const owner = JSON.parse(await fs.readFile(marker, 'utf8')) as { pid: number; active: boolean };
        if (!Number.isSafeInteger(owner.pid) || typeof owner.active !== 'boolean') throw new Error('Corrupt writer metadata');
        if (owner.active) {
          let alive = true;
          try { process.kill(owner.pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
          if (alive) throw new Error('Streaming session writer is alive');
        }
        // Archive stale/released ownership; do not delete user state.
        await renameWithRetryAsync(marker, path.join(dir, `writer-${Date.now()}-${Math.random().toString(16).slice(2)}.closed`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const lease = await fs.open(marker, 'wx');
      ownsMarker = true;
      try { await lease.writeFile(JSON.stringify({ pid: process.pid, active: true })); await lease.sync(); } finally { await lease.close(); }
      await session.recover();
      return session;
    } catch (error) {
      if (ownsMarker) await session.releaseWriter();
      writers.delete(dir);
      throw error;
    } finally {
      if (claim) {
        await claim.close();
        await renameWithRetryAsync(path.join(dir, 'writer.claim'), path.join(dir, 'writer.claim.closed'));
      }
    }
  }

  private async releaseWriter(): Promise<void> {
    try {
      await renameWithRetryAsync(path.join(this.dir, 'writer.json'), path.join(this.dir, 'writer.closed'));
    } finally { writers.delete(this.dir); }
  }

  private framePath(index: number): string { return path.join(this.dir, `chunk-${String(index).padStart(8, '0')}.frame`); }

  private async readFrame(index: number): Promise<{ records: SessionRecord[]; compressed: boolean; bytes: number }> {
    const file = this.framePath(index);
    const stat = await fs.stat(file);
    if (stat.size > MAX_BYTES + 65536) throw new Error('Oversized frame');
    const frame = await fs.readFile(file);
    if (frame.length < HEADER_BYTES || frame.subarray(0, 8).toString() !== MAGIC) throw new Error('Incomplete frame');
    const length = frame.readUInt32BE(8);
    if (frame.length !== HEADER_BYTES + length) throw new Error('Incomplete frame');
    const payload = frame.subarray(HEADER_BYTES);
    if (!digest(payload).equals(frame.subarray(12, 44))) throw new Error('Corrupt frame checksum');
    const compressed = payload[0] === 0x1f && payload[1] === 0x8b;
    const json = compressed ? gunzipSync(payload, { maxOutputLength: MAX_BYTES }) : payload;
    const records = JSON.parse(json.toString()) as SessionRecord[];
    if (!Array.isArray(records) || records.length === 0) throw new Error('Invalid frame records');
    for (const record of records) {
      if (!record || !Number.isSafeInteger(record.seq) || record.seq < 1 || typeof record.type !== 'string' || typeof record.ts !== 'string') {
        throw new Error('Invalid frame record');
      }
    }
    return { records, compressed, bytes: frame.length };
  }

  private async recover(): Promise<void> {
    let cached: SessionChunkMeta[] = [];
    try {
      cached = JSON.parse(await fs.readFile(path.join(this.dir, 'chunks.json'), 'utf8')) as SessionChunkMeta[];
      if (!Array.isArray(cached)) throw new Error('Corrupt chunk metadata');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const names = (await fs.readdir(this.dir)).filter((name) => /^chunk-\d{8}\.frame$/.test(name)).sort();
    for (let i = 0; i < names.length; i++) {
      if (names[i] !== path.basename(this.framePath(i))) throw new Error('Missing interior frame');
      let frame: Awaited<ReturnType<ChunkedSession['readFrame']>>;
      try { frame = await this.readFrame(i); } catch (error) {
        // Only an unindexed, incomplete final frame is an uncommitted torn write.
        if (i !== names.length - 1 || i < cached.length || !(error instanceof Error) || error.message !== 'Incomplete frame') throw error;
        await renameWithRetryAsync(this.framePath(i), `${this.framePath(i)}.torn-${Date.now()}`);
        break;
      }
      for (const record of frame.records) if (record.seq !== ++this.seq) throw new Error('Non-monotonic session sequence');
      this.chunks.push({ chunkIndex: i, startSeq: frame.records[0]!.seq, endSeq: this.seq, recordCount: frame.records.length, byteSize: frame.bytes, compressed: frame.compressed });
    }
    if (cached.length > this.chunks.length || cached.some((meta, i) => JSON.stringify(meta) !== JSON.stringify(this.chunks[i]))) {
      throw new Error('Corrupt chunk metadata');
    }
    await this.writeMetadata();
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => { if (this.failure) throw this.failure; return action(); });
    this.queue = result.then(() => {}, (error: unknown) => { this.failure = error; });
    return result;
  }

  append(record: Omit<SessionRecord, 'seq' | 'ts'> & { ts?: string }): Promise<SessionRecord> {
    if (this.closing) return Promise.reject(new Error('Streaming session closed'));
    // Snapshot at invocation, so callers cannot mutate queued data.
    let input: typeof record;
    try {
      input = structuredClone(record);
      if (typeof input.type !== 'string' || (input.ts !== undefined && typeof input.ts !== 'string')) throw new TypeError('Invalid session record');
      // Reserve the largest sequence representation so a rejected input never
      // poisons the write queue or loses earlier accepted buffered records.
      const preview = { ...input, seq: Number.MAX_SAFE_INTEGER, ts: input.ts ?? new Date().toISOString() };
      if (Buffer.byteLength(JSON.stringify(preview)) + 3 > this.maxBytes) throw new RangeError('Record exceeds chunk byte budget');
    } catch (error) { return Promise.reject(error); }
    return this.enqueue(async () => {
      const full = { ...input, seq: this.seq + 1, ts: input.ts ?? new Date().toISOString() } as SessionRecord;
      const bytes = Buffer.byteLength(JSON.stringify(full)) + 1;
      if (bytes + 2 > this.maxBytes) throw new RangeError('Record exceeds chunk byte budget');
      if (this.pendingBytes + bytes + 2 > this.maxBytes) await this.seal();
      this.seq++;
      this.pending.push(full);
      this.pendingBytes += bytes;
      return structuredClone(full);
    });
  }

  private async writeMetadata(): Promise<void> {
    const target = path.join(this.dir, 'chunks.json');
    const temporary = `${target}.next`;
    const handle = await fs.open(temporary, 'w');
    try { await handle.writeFile(JSON.stringify(this.chunks)); await handle.sync(); } finally { await handle.close(); }
    await renameWithRetryAsync(temporary, target);
  }

  private async seal(): Promise<void> {
    if (!this.pending.length) return;
    const json = Buffer.from(JSON.stringify(this.pending));
    const payload = this.compressed ? gzipSync(json) : json;
    const header = Buffer.alloc(HEADER_BYTES);
    header.write(MAGIC);
    header.writeUInt32BE(payload.length, 8);
    digest(payload).copy(header, 12);
    const index = this.chunks.length;
    const handle = await fs.open(this.framePath(index), 'wx');
    try { await handle.writeFile(Buffer.concat([header, payload])); await handle.sync(); } finally { await handle.close(); }
    this.chunks.push({ chunkIndex: index, startSeq: this.pending[0]!.seq, endSeq: this.pending.at(-1)!.seq, recordCount: this.pending.length, byteSize: header.length + payload.length, compressed: this.compressed });
    this.pending = [];
    this.pendingBytes = 0;
    await this.writeMetadata();
  }

  flush(): Promise<void> {
    if (this.closing) return this.closePromise ?? Promise.reject(new Error('Streaming session closed'));
    return this.enqueue(() => this.seal());
  }

  async listChunks(): Promise<SessionChunkMeta[]> { await this.queue; if (this.failure) throw this.failure; return structuredClone(this.chunks); }

  async *streamRecords(fromSeq = 1, toSeq = Number.MAX_SAFE_INTEGER): AsyncIterable<SessionRecord> {
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 1 || !Number.isSafeInteger(toSeq) || toSeq < fromSeq) throw new RangeError('Invalid sequence range');
    // Reads a durable snapshot only; pending records require an explicit flush.
    const chunks = await this.listChunks();
    for (const meta of chunks) {
      if (meta.endSeq < fromSeq || meta.startSeq > toSeq) continue;
      const frame = await this.readFrame(meta.chunkIndex);
      if (frame.records.length !== meta.recordCount || frame.records[0]!.seq !== meta.startSeq || frame.records.at(-1)!.seq !== meta.endSeq) throw new Error('Corrupt frame index');
      for (let i = 0; i < frame.records.length; i++) {
        const record = frame.records[i]!;
        if (record.seq !== meta.startSeq + i) throw new Error('Non-monotonic session sequence');
        if (record.seq >= fromSeq && record.seq <= toSeq) yield record;
      }
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.enqueue(() => this.seal()).finally(async () => {
      await this.releaseWriter();
    });
    return this.closePromise;
  }

  /** Release an interrupted writer without sealing buffered records. Only prior
   * flush barriers are durable. Useful to abandon a failed external producer. */
  interrupt(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.queue.then(async () => {
      this.pending = [];
      this.pendingBytes = 0;
      await this.releaseWriter();
    });
    return this.closePromise;
  }
}
