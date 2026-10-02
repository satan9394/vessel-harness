import type { SessionRecord } from '@vessel/shared';

export interface SessionChunkMeta {
  chunkIndex: number;
  startSeq: number;
  endSeq: number;
  recordCount: number;
  byteSize: number;
  compressed: boolean;
}

export interface StreamingSessionReader {
  listChunks(): Promise<SessionChunkMeta[]>;
  streamRecords(fromSeq?: number, toSeq?: number): AsyncIterable<SessionRecord>;
}

export interface StreamingSessionWriter extends StreamingSessionReader {
  append(record: Omit<SessionRecord, 'seq' | 'ts'> & { ts?: string }): Promise<SessionRecord>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
