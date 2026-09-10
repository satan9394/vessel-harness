import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { renameWithRetryAsync } from '@vessel/shared';
import type { SessionRecord, SessionRecordBase } from '@vessel/shared';

export interface SessionOptions {
  workspaceRoot: string;
  sessionId?: string;
  /** session dir override; default <workspaceRoot>/.harness/sessions/<id> */
  sessionDir?: string;
}

export interface SessionHandle {
  sessionId: string;
  dir: string;
  logPath: string;
}

/**
 * Session — append-only JSONL event log as the single source of truth
 * (D3 decision point 10 / ARCHITECTURE §4.1 core/session).
 *
 * - resume = replay + synthesize an `interrupted` turn closer for the last
 *   unfinished turn (never truncates long turns).
 * - surface = projection deriving model-visible messages from
 *   user/message, assistant/message, tool/result (EVENT-SPEC §6).
 * - single-writer lease: a lock file guards concurrent writers.
 */
export class Session {
  readonly sessionId: string;
  readonly dir: string;
  readonly logPath: string;
  readonly workspaceRoot: string;

  private records: SessionRecord[] = [];
  private seq = 0;
  private fd: fs.promises.FileHandle | null = null;
  private leasePath: string;

  private constructor(opts: SessionOptions, handle: SessionHandle) {
    this.workspaceRoot = opts.workspaceRoot;
    this.sessionId = handle.sessionId;
    this.dir = handle.dir;
    this.logPath = handle.logPath;
    this.leasePath = path.join(this.dir, '.lease');
  }

  static async open(opts: SessionOptions): Promise<Session> {
    const sessionId = opts.sessionId ?? `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const dir =
      opts.sessionDir ??
      path.join(opts.workspaceRoot, '.harness', 'sessions', sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, 'session.jsonl');

    // single-writer lease (fail-closed: existing lease => refuse)
    const leasePath = path.join(dir, '.lease');
    try {
      const fh = fs.openSync(leasePath, 'wx');
      fs.writeSync(fh, `${process.pid}\n${new Date().toISOString()}\n`);
      fs.closeSync(fh);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EEXIST') {
        throw new Error(`Session is already open by another writer: ${dir}`);
      }
      throw err;
    }

    const session = new Session(opts, { sessionId, dir, logPath });
    await session.loadExisting();
    return session;
  }

  private async loadExisting(): Promise<void> {
    if (!fs.existsSync(this.logPath)) return;
    const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as SessionRecordBase;
        this.records.push(rec as SessionRecord);
        this.seq = Math.max(this.seq, rec.seq);
      } catch {
        // torn tail line: drop it (crash only loses the torn tail, D3 decision 10)
        continue;
      }
    }
    // resume semantics: if the last turn lacks turn/end, synthesize interrupted closer
    const openTurns = this.openTurns();
    for (const turnId of openTurns) {
      this.append({
        type: 'turn/end',
        turnId,
        kind: 'interrupted',
        stats: { steps: 0, toolCalls: 0, durationMs: 0 },
      });
    }
  }

  private openTurns(): string[] {
    const started = new Set<string>();
    const ended = new Set<string>();
    for (const r of this.records) {
      if (r.type === 'turn/start') started.add((r as { turnId: string }).turnId);
      if (r.type === 'turn/end') ended.add((r as { turnId: string }).turnId);
    }
    return [...started].filter((id) => !ended.has(id));
  }

  async append(record: Omit<SessionRecord, 'seq' | 'ts'> & { seq?: number; ts?: string }): Promise<SessionRecord> {
    const full: SessionRecord = {
      ...(record as SessionRecord),
      seq: this.seq + 1,
      ts: record.ts ?? new Date().toISOString(),
    } as SessionRecord;
    this.seq += 1;
    this.records.push(full);
    if (!this.fd) {
      this.fd = await fs.promises.open(this.logPath, 'a');
    }
    await this.fd.write(JSON.stringify(full) + '\n');
    return full;
  }

  /** append + flush (persistence barrier) */
  async appendSync(record: Omit<SessionRecord, 'seq' | 'ts'>): Promise<SessionRecord> {
    const r = await this.append(record);
    await this.fd?.sync();
    return r;
  }

  async flush(): Promise<void> {
    await this.fd?.sync();
  }

  /** all records in order (replay) */
  replay(): readonly SessionRecord[] {
    return this.records;
  }

  /**
   * Surface projection — the only records that derive the model-visible history:
   * user/message, assistant/message, tool/result (EVENT-SPEC §6).
   */
  surface(): SessionRecord[] {
    return this.records.filter(
      (r) => r.type === 'user/message' || r.type === 'assistant/message' || r.type === 'tool/result',
    );
  }

  /** tail records (used by compaction retain-ratio) */
  tail(n: number): SessionRecord[] {
    return this.records.slice(-n);
  }

  get size(): number {
    return this.records.length;
  }

  /**
   * Compaction replace: atomically swap the log's region between `fromSeq` and
   * `toSeq` (inclusive) with a synthetic summary record. Rewrites the file.
   * Returns the removed record count.
   */
  async replaceRegion(fromSeq: number, toSeq: number, summary: UserMessageLike): Promise<number> {
    // close the append handle first — Windows cannot rename an open file
    if (this.fd) {
      await this.fd.close();
      this.fd = null;
    }
    const kept: SessionRecord[] = [];
    let removed = 0;
    for (const r of this.records) {
      if (r.seq >= fromSeq && r.seq <= toSeq) {
        removed += 1;
        continue;
      }
      kept.push(r);
    }
    const marker: SessionRecord = {
      ...summary,
      seq: 0,
      ts: new Date().toISOString(),
    } as SessionRecord;
    kept.push(marker);
    // renumber to keep seq contiguous (invariant: numbering continuous)
    let s = 1;
    const renumbered = kept.map((r) => ({ ...r, seq: s++ }));
    this.records = renumbered;
    this.seq = renumbered.length;
    // rewrite file (append-only violated only by compaction replace — the sanctioned exception)
    const tmp = this.logPath + '.tmp';
    await fs.promises.writeFile(tmp, renumbered.map((r) => JSON.stringify(r)).join('\n') + '\n');
    // task 113: tmp+rename 走共享有界重试（EPERM/EBUSY/EACCES，3 次 5/15ms），
    // Windows 杀软/索引器瞬时锁文件不再偶发失败；原子语义不变。
    await renameWithRetryAsync(tmp, this.logPath);
    return removed;
  }

  async close(): Promise<void> {
    if (this.fd) {
      await this.fd.close();
      this.fd = null;
    }
    try {
      fs.rmSync(this.leasePath, { force: true });
    } catch {
      // best effort
    }
  }
}

export interface UserMessageLike {
  type: 'user/message';
  msgId: string;
  role: 'user';
  content: string;
  source?: 'user' | 'inject' | 'instruction' | 'compacted-summary';
  surface: true;
}
