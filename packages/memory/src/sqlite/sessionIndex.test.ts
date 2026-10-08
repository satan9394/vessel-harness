import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { SessionRecord } from '@vessel/shared';
import { SessionIndexStore, type SessionIndexSource } from './SessionIndexStore.js';
import { streamJsonlRecords } from './jsonlSource.js';
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>() }));

let root: string; const stores: SessionIndexStore[] = [];
const record = (seq: number, type: string, fields: object = {}): SessionRecord => ({ seq, ts: new Date(1000 + seq).toISOString(), type, ...fields } as SessionRecord);
const source = (sessionId: string, records: SessionRecord[], metadata?: Record<string, unknown>): SessionIndexSource => ({ sessionId, metadata, async *records() { for (const value of records) yield value; } });
const open = (options?: ConstructorParameters<typeof SessionIndexStore>[1]) => { const store = new SessionIndexStore(path.join(root, 'index.db'), options); stores.push(store); return store; };
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-session-index-')); });
afterEach(async () => { vi.restoreAllMocks(); for (const store of stores.splice(0)) await store.close().catch(() => {}); fs.rmSync(root, { recursive: true, force: true }); });

describe('SQLite session projection', () => {
  it('uses WAL/NORMAL and projects seq-idempotent four-dimensional usage without turn-end/cache double counting', async () => {
    const store = open();
    const records = [record(1, 'user/message', { role: 'user', content: 'Original discussion' }),
      record(2, 'model/usage', { turnId: 'modern', step: 1, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheCreationTokens: 4 } }),
      record(3, 'turn/end', { turnId: 'modern', stats: { tokensUsed: 120 } }),
      record(4, 'turn/end', { turnId: 'legacy', stats: { tokensUsed: 7 } })];
    await store.indexRecords('s', records); await store.indexRecords('s', records);
    await store.indexMetadata('s', { id: 's', createdAt: new Date(500).toISOString(), updatedAt: new Date(1500).toISOString(), topic: { topicId: 'topic1', title: 'Renamed topic' } });
    expect(await store.listSessions()).toMatchObject([{ sessionId: 's', topicId: 'topic1', title: 'Renamed topic', createdAt: 500, updatedAt: 1500,
      recordCount: 4, totalTokens: 127, inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheCreationTokens: 4 }]);
    const db = new DatabaseSync(store.dbPath); expect(Object.values(db.prepare('PRAGMA journal_mode').get()!)[0]).toBe('wal'); db.close();
  });
  it('replaces conflicting sequence rows and reconciliation removes stale records/messages', async () => {
    const store = open(); await store.indexRecords('s', [record(1, 'user/message', { role: 'user', content: 'stale unicorn' }), record(2, 'model/usage', { turnId: 't', step: 1, usage: { inputTokens: 100, outputTokens: 0 } })]);
    await store.indexRecords('s', [record(1, 'user/message', { role: 'user', content: 'current architecture' })]);
    expect(await store.search({ query: 'unicorn' })).toEqual([]); expect(await store.search({ query: 'architecture' })).toHaveLength(1);
    await store.reconcileSession(source('s', [record(1, 'user/message', { role: 'user', content: 'authoritative journal' })]));
    expect(await store.listSessions()).toMatchObject([{ recordCount: 1, totalTokens: 0 }]); expect(await store.search({ query: 'architecture' })).toEqual([]);
  });
  it('automatically rebuilds a missing cache from streamed JSONL and ignores a malformed tail', async () => {
    const log = path.join(root, 'session.jsonl'); const expected = record(1, 'user/message', { role: 'user', content: 'restart journal' });
    fs.writeFileSync(log, JSON.stringify(expected) + '\n' + JSON.stringify(expected) + '\n{"seq":');
    const sources = async function* () { yield { sessionId: 's', records: () => streamJsonlRecords(log) }; };
    let store = open({ sources }); expect(await store.listSessions()).toMatchObject([{ recordCount: 1, title: 'restart journal' }]);
    await store.close(); stores.splice(stores.indexOf(store), 1); fs.renameSync(store.dbPath, store.dbPath + '.retained');
    store = open({ sources }); expect(await store.search({ query: 'restart' })).toHaveLength(1);
    expect(fs.readFileSync(log, 'utf8').endsWith('{"seq":')).toBe(true);
  });
  it('quarantines a corrupt database and both sidecars before rebuilding canonical sources', async () => {
    fs.writeFileSync(path.join(root, 'index.db'), 'not a SQLite database'); fs.writeFileSync(path.join(root, 'index.db-wal'), 'old wal'); fs.writeFileSync(path.join(root, 'index.db-shm'), 'old shm');
    const store = open({ sources: async function* () { yield source('s', [record(1, 'assistant/message', { role: 'assistant', content: 'recovered evidence' })]); } });
    expect(await store.search({ query: 'recovered' })).toHaveLength(1);
    const preserved = fs.readdirSync(root).filter(file => file.includes('.corrupt-'));
    expect(preserved).toHaveLength(3); expect(preserved.some(file => file.endsWith('-wal'))).toBe(true); expect(preserved.some(file => file.endsWith('-shm'))).toBe(true);
  });
  it('reconciles even a healthy but stale cache and consumes streaming archive adapters', async () => {
    let store = open(); await store.indexRecords('obsolete', [record(1, 'user/message', { role: 'user', content: 'wrong cache' })]);
    await store.close(); stores.splice(stores.indexOf(store), 1);
    let streamed = 0;
    store = open({ sources: async function* () { yield { sessionId: 'archive', async *records() { for (let seq = 1; seq <= 3; seq++) { streamed++; yield record(seq, 'assistant/message', { role: 'assistant', content: 'archive packet ' + seq }); await Promise.resolve(); } } }; } });
    expect(await store.listSessions()).toMatchObject([{ sessionId: 'archive', recordCount: 3 }]); expect(streamed).toBe(3); expect(await store.search({ query: 'wrong' })).toEqual([]);
  });
  it('reads 50-row and 1000-row hot pages in under5ms using only SQL', async () => {
    const store = open(); const rows = Array.from({ length: 1000 }, (_, index) => source('s' + String(index).padStart(4, '0'), [record(1, 'user/message', { role: 'user', content: 'discussion ' + index })]));
    await store.rebuild(async function* () { yield* rows; }); await store.listSessions(50, 100);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('hot path must not read source files'); });
    for (const limit of [50, 1000]) {
      await store.listSessions(limit);
      const samples: number[] = [];
      for (let run = 0; run < 7; run++) { const start = performance.now(); const result = await store.listSessions(limit); samples.push(performance.now() - start); expect(result).toHaveLength(limit); }
      const median = samples.sort((a, b) => a - b)[3]!;
      console.log(`session index: 1000-session/${limit}-row page median ${median.toFixed(3)}ms`); expect(median).toBeLessThan(5);
    }
  });
  it('rejects invalid page/query/sequence inputs', async () => {
    const store = open(); await expect(store.listSessions(-1)).rejects.toThrow('pagination'); await expect(store.listSessions(1, -1)).rejects.toThrow('pagination');
    await expect(store.search({ query: 'x', limit: 0 })).rejects.toThrow('pagination'); await expect(store.search({ query: 'x'.repeat(257) })).rejects.toThrow('search');
    await expect(store.indexRecords('s', [record(0, 'user/message')])).rejects.toThrow('record');
  });
  it('returns fresh ordered pages, topic filters and independent nested metadata', async () => {
    const store = open();
    for (const sessionId of ['a', 'b', 'c']) await store.indexMetadata(sessionId, {
      topic: { topicId: sessionId === 'c' ? 'other' : 'topic', title: 'Title "' + sessionId },
      updatedAt: new Date(2000).toISOString(), nested: { values: ['unicode 雪', null, true] },
    });
    expect((await store.listSessions(2)).map(row => row.sessionId)).toEqual(['c', 'b']);
    expect((await store.listSessions(1, 1, 'topic')).map(row => row.sessionId)).toEqual(['a']);
    expect(await store.listSessions(1, 3)).toEqual([]);
    expect(await store.listSessions(1, 0, 'missing')).toEqual([]);
    const first = (await store.listSessions(1, 0, 'topic'))[0]!;
    expect(first.title).toBe('Title "b');
    expect(first.metadata?.nested).toEqual({ values: ['unicode 雪', null, true] });
    (first.metadata!.nested as { values: unknown[] }).values.push('caller mutation');
    expect((await store.listSessions(1, 0, 'topic'))[0]!.metadata?.nested).toEqual({ values: ['unicode 雪', null, true] });
    await store.indexMetadata('a', { topic: { topicId: 'other', title: 'changed' }, updatedAt: new Date(3000).toISOString() });
    expect((await store.listSessions(1))[0]).toMatchObject({ sessionId: 'a', title: 'changed', updatedAt: 3000 });
    expect((await store.listSessions(50, 0, 'topic')).map(row => row.sessionId)).toEqual(['b']);
    await store.indexMetadata('a', null);
    expect((await store.listSessions(1))[0]!.sessionId).toBe('c');
  });
  it('preserves native REAL precision for publicly indexed counters beyond int64', async () => {
    const store = open();
    await store.indexRecords('real', [record(1, 'model/usage', { turnId: 't', step: 1,
      usage: { inputTokens: 12345678901234567000, outputTokens: 0 } })]);
    const db = new DatabaseSync(store.dbPath);
    try {
      const native = db.prepare('SELECT input_tokens,total_tokens FROM sessions_meta WHERE session_id=?').get('real')!;
      const listed = (await store.listSessions())[0]!;
      expect(listed.inputTokens).toBe(native.input_tokens);
      expect(listed.totalTokens).toBe(native.total_tokens);
    } finally { db.close(); }
  });
  it('preserves native unsafe INTEGER rejection only for the selected page', async () => {
    const store = open(); await store.indexMetadata('safe', { updatedAt: new Date(3000).toISOString() });
    await store.indexMetadata('unsafe', { updatedAt: new Date(2000).toISOString(), topic: { topicId: 'unsafe' } });
    const db = new DatabaseSync(store.dbPath);
    try {
      for (const value of [9007199254740992n, 9007199254740993n, -9007199254740992n]) {
        db.prepare('UPDATE sessions_meta SET total_tokens=? WHERE session_id=?').run(value, 'unsafe');
        let nativeError: unknown;
        try { db.prepare('SELECT * FROM sessions_meta WHERE session_id=?').all('unsafe'); } catch (error) { nativeError = error; }
        expect(nativeError).toBeInstanceOf(RangeError);
        await expect(store.listSessions(1, 1)).rejects.toMatchObject({ code: (nativeError as NodeJS.ErrnoException).code });
        await expect(store.listSessions(1, 0, 'unsafe')).rejects.toMatchObject({ code: (nativeError as NodeJS.ErrnoException).code });
        expect((await store.listSessions(1))[0]!.sessionId).toBe('safe');
      }
    } finally { db.close(); }
  });
});
