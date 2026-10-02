import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { SessionRecord } from '@vessel/shared';

export interface IndexedSessionSummary {
  sessionId: string;
  topicId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  recordCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  metadata?: Record<string, unknown>;
}
export interface SessionSearchParams { query: string; limit?: number; offset?: number }
export interface SessionSearchResult { sessionId: string; matchedContent: string; snippet: string; createdAt: number }
/** Application supplies explicit roots and archive readers; memory never imports core runtime. */
export interface SessionIndexSource {
  sessionId: string;
  metadata?: Record<string, unknown>;
  records(): AsyncIterable<SessionRecord>;
}
export interface SessionIndexOptions { sources?: () => AsyncIterable<SessionIndexSource> }

const sqliteRequire = createRequire(import.meta.url);
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const tokens = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
function page(limit = 50, offset = 0): [number, number] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(offset) || offset < 0) throw new RangeError('Invalid session pagination');
  return [limit, offset];
}
const html = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/** Disposable SQLite projection. Every reconciliation replaces cache facts from JSONL. */
export class SessionIndexStore {
  protected db!: DatabaseSync;
  protected queue: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly statements = new Map<string, StatementSync>();
  constructor(readonly dbPath: string, options: SessionIndexOptions = {}) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    // Lazy runtime import preserves ordinary application imports on Node 20.
    const { DatabaseSync: Database } = sqliteRequire('node:sqlite') as typeof import('node:sqlite');
    const open = () => {
      if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
        const fd = fs.openSync(dbPath, 'r'); const header = Buffer.alloc(16);
        try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
        if (header.toString('binary') !== 'SQLite format 3\0') throw new Error('corrupt SQLite projection header');
      }
      this.db = new Database(dbPath);
      const check = this.db.prepare('PRAGMA quick_check').get();
      if (!check || Object.values(check)[0] !== 'ok') throw new Error('corrupt SQLite projection');
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS sessions_meta (
          session_id TEXT PRIMARY KEY, topic_id TEXT, title TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0, record_count INTEGER NOT NULL DEFAULT 0,
          input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0, metadata TEXT);
        CREATE INDEX IF NOT EXISTS sessions_recent ON sessions_meta(updated_at DESC, session_id DESC);
        CREATE INDEX IF NOT EXISTS sessions_topic ON sessions_meta(topic_id);
        CREATE TABLE IF NOT EXISTS records (session_id TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL,
          kind TEXT NOT NULL, turn_id TEXT, fallback_tokens INTEGER NOT NULL,
          ts INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL, PRIMARY KEY(session_id,seq));
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(session_id UNINDEXED,seq UNINDEXED,role,content);`);
      if (!this.db.prepare('PRAGMA table_info(records)').all().some(column => column.name === 'fallback_tokens')) throw new Error('corrupt SQLite projection schema');
      this.db.exec('CREATE INDEX IF NOT EXISTS records_turn ON records(session_id,turn_id,kind);');
    };
    try { open(); }
    catch (error) {
      try { this.db?.close(); } catch { /* damaged handle */ }
      if (!/corrupt|malformed|not a database|file is encrypted/i.test(String(error))) throw error;
      const suffix = '.corrupt-' + randomUUID();
      for (const sidecar of ['', '-wal', '-shm']) {
        const file = dbPath + sidecar; if (fs.existsSync(file)) fs.renameSync(file, dbPath + suffix + sidecar);
      }
      open();
    }
    if (options.sources) void this.rebuild(options.sources).catch(() => { /* failure remains on the queue for readers */ });
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement); }
    return statement;
  }
  private enqueue(work: () => Promise<void> | void): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Session index closed'));
    const next = this.queue.then(work); this.queue = next; return next;
  }
  private async transaction(work: () => Promise<void> | void): Promise<void> {
    this.db.exec('BEGIN IMMEDIATE');
    try { await work(); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private ensure(sessionId: string): void { this.statement('INSERT OR IGNORE INTO sessions_meta(session_id) VALUES (?)').run(sessionId); }
  protected insert(sessionId: string, record: SessionRecord): void {
    if (!sessionId || !Number.isSafeInteger(record.seq) || record.seq < 1 || typeof record.type !== 'string') throw new RangeError('Invalid session record');
    const encoded = JSON.stringify(record);
    const previous = this.statement('SELECT rowid,json FROM records WHERE session_id=? AND seq=?').get(sessionId, record.seq);
    if (previous?.json === encoded) return;
    const usage = record.type === 'model/usage' ? record.usage : undefined;
    this.statement(`INSERT INTO records(session_id,seq,json,kind,turn_id,fallback_tokens,ts,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,seq) DO UPDATE SET json=excluded.json,kind=excluded.kind,turn_id=excluded.turn_id,fallback_tokens=excluded.fallback_tokens,ts=excluded.ts,
      input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,cache_read_tokens=excluded.cache_read_tokens,cache_creation_tokens=excluded.cache_creation_tokens`)
      .run(sessionId, record.seq, encoded, record.type, typeof record.turnId === 'string' ? record.turnId : null,
        record.type === 'turn/end' ? tokens(record.stats.tokensUsed) : 0,
        timestamp(record.ts), tokens(usage?.inputTokens), tokens(usage?.outputTokens), tokens(usage?.cacheReadTokens), tokens(usage?.cacheCreationTokens));
    if (previous) this.statement('DELETE FROM messages_fts WHERE rowid=?').run(previous.rowid!);
    if ((record.type === 'user/message' || record.type === 'assistant/message') && typeof record.content === 'string') {
      const row = this.statement('SELECT rowid FROM records WHERE session_id=? AND seq=?').get(sessionId, record.seq)!;
      this.statement('INSERT INTO messages_fts(rowid,session_id,seq,role,content) VALUES (?,?,?,?,?)').run(row.rowid!, sessionId, record.seq, record.role, record.content);
    }
  }
  private summarize(sessionId: string): void {
    this.ensure(sessionId);
    const sum = this.statement(`SELECT COUNT(*) AS count,MIN(ts) AS created,MAX(ts) AS updated,
      SUM(input_tokens) AS input,SUM(output_tokens) AS output,SUM(cache_read_tokens) AS cache_read,SUM(cache_creation_tokens) AS cache_write,
      SUM(input_tokens+output_tokens) + SUM(CASE WHEN kind='turn/end' AND NOT EXISTS
        (SELECT 1 FROM records usage WHERE usage.session_id=r.session_id AND usage.kind='model/usage' AND usage.turn_id=r.turn_id)
        THEN fallback_tokens ELSE 0 END) AS total
      FROM records r WHERE session_id=?`).get(sessionId)!;
    const metaRow = this.statement('SELECT metadata FROM sessions_meta WHERE session_id=?').get(sessionId)!;
    const metadata = metaRow.metadata ? JSON.parse(String(metaRow.metadata)) as Record<string, unknown> : undefined;
    const topic = metadata?.topic as { topicId?: string; title?: string } | undefined;
    const first = this.statement("SELECT content FROM messages_fts WHERE session_id=? AND role='user' ORDER BY CAST(seq AS INTEGER) LIMIT 1").get(sessionId);
    const title = topic?.title ?? (typeof metadata?.title === 'string' ? metadata.title : String(first?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80));
    this.statement(`UPDATE sessions_meta SET topic_id=?,title=?,created_at=?,updated_at=?,record_count=?,
      input_tokens=?,output_tokens=?,cache_read_tokens=?,cache_creation_tokens=?,total_tokens=? WHERE session_id=?`)
      .run(topic?.topicId ?? null, title, timestamp(metadata?.createdAt) || Number(sum.created ?? 0),
        Math.max(timestamp(metadata?.updatedAt), Number(sum.updated ?? 0)), Number(sum.count), Number(sum.input ?? 0), Number(sum.output ?? 0),
        Number(sum.cache_read ?? 0), Number(sum.cache_write ?? 0), Number(sum.total ?? 0), sessionId);
  }
  private metadata(sessionId: string, metadata: Record<string, unknown>): void {
    this.ensure(sessionId); this.statement('UPDATE sessions_meta SET metadata=? WHERE session_id=?').run(JSON.stringify(metadata), sessionId);
  }
  indexRecords(sessionId: string, records: readonly SessionRecord[]): Promise<void> {
    return this.enqueue(() => this.transaction(() => { for (const record of records) this.insert(sessionId, record); this.summarize(sessionId); }));
  }
  indexMetadata(sessionId: string, metadata: Record<string, unknown> | null): Promise<void> {
    return this.enqueue(() => this.transaction(() => {
      if (!metadata) this.remove(sessionId);
      else { this.metadata(sessionId, metadata); this.summarize(sessionId); }
    }));
  }
  protected remove(sessionId: string): void {
    this.statement('DELETE FROM messages_fts WHERE session_id=?').run(sessionId);
    this.statement('DELETE FROM records WHERE session_id=?').run(sessionId);
    this.statement('DELETE FROM sessions_meta WHERE session_id=?').run(sessionId);
  }
  private async consume(source: SessionIndexSource): Promise<void> {
    for await (const record of source.records()) this.insert(source.sessionId, record);
    if (source.metadata) this.metadata(source.sessionId, source.metadata);
    this.summarize(source.sessionId);
  }
  /** Replacement handles compaction/renumbering, conflicting cache rows and removed tail records. */
  reconcileSession(source: SessionIndexSource): Promise<void> {
    return this.enqueue(() => this.transaction(async () => { this.remove(source.sessionId); await this.consume(source); }));
  }
  protected resetProjection(): void {}
  rebuild(sources: () => AsyncIterable<SessionIndexSource>): Promise<void> {
    return this.enqueue(() => this.transaction(async () => {
      this.resetProjection();
      this.db.exec('DELETE FROM messages_fts; DELETE FROM records; DELETE FROM sessions_meta;');
      for await (const source of sources()) await this.consume(source);
    }));
  }
  async listSessions(limit = 50, offset = 0, topicId?: string): Promise<IndexedSessionSummary[]> {
    const bounds = page(limit, offset); await this.queue;
    const sql = `SELECT * FROM sessions_meta ${topicId === undefined ? '' : 'WHERE topic_id=?'} ORDER BY updated_at DESC,session_id DESC LIMIT ? OFFSET ?`;
    const rows = topicId === undefined ? this.statement(sql).all(...bounds) : this.statement(sql).all(topicId, ...bounds);
    return rows.map(row => ({ sessionId: String(row.session_id), topicId: row.topic_id === null ? undefined : String(row.topic_id), title: String(row.title),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), recordCount: Number(row.record_count),
      inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), cacheReadTokens: Number(row.cache_read_tokens), cacheCreationTokens: Number(row.cache_creation_tokens), totalTokens: Number(row.total_tokens),
      metadata: row.metadata ? JSON.parse(String(row.metadata)) as Record<string, unknown> : undefined }));
  }
  async search(params: SessionSearchParams): Promise<SessionSearchResult[]> {
    const bounds = page(params.limit ?? 20, params.offset ?? 0);
    if (typeof params.query !== 'string' || params.query.length > 256) throw new RangeError('Invalid search query');
    const words = params.query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
    if (!words.length) return [];
    const match = words.map(word => '"' + word + '"*').join(' AND '); await this.queue;
    return this.statement(`SELECT session_id,content,snippet(messages_fts,3,char(1),char(2),'…',24) AS snippet,
      COALESCE((SELECT ts FROM records WHERE records.rowid=messages_fts.rowid),0) AS created
      FROM messages_fts WHERE messages_fts MATCH ? ORDER BY bm25(messages_fts) LIMIT ? OFFSET ?`).all(match, ...bounds)
      .map(row => ({ sessionId: String(row.session_id), matchedContent: String(row.content),
        snippet: html(String(row.snippet)).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>'), createdAt: Number(row.created) }));
  }
  async close(): Promise<void> {
    this.closed = true;
    try { await this.queue; } finally { this.db.close(); }
  }
}
