import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionRecord } from '@vessel/shared';
import { SessionIndexStore } from './SessionIndexStore.js';
let root: string, store: SessionIndexStore;
const message = (seq: number, content: string): SessionRecord => ({ seq, ts: '2026-10-01T00:00:00Z', type: 'user/message', role: 'user', msgId: 'm' + seq, content, surface: true });
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-fts-')); store = new SessionIndexStore(path.join(root, 'index.db')); });
afterEach(async () => { await store.close(); fs.rmSync(root, { recursive: true, force: true }); });
describe('FTS5 keyword search', () => {
  it('matches case-insensitive multiword prefixes with safe highlighted snippets', async () => {
    await store.indexRecords('match', [message(1, 'Designing resilient architecture <script>alert("x")</script>')]);
    await store.indexRecords('other', [message(1, 'Designing a small interface')]);
    const results = await store.search({ query: 'RESIL arch' });
    expect(results).toHaveLength(1); expect(results[0]).toMatchObject({ sessionId: 'match', createdAt: Date.parse('2026-10-01T00:00:00Z') });
    expect(results[0]!.snippet).toContain('<mark>resilient</mark>'); expect(results[0]!.snippet).toContain('<mark>architecture</mark>');
    expect(results[0]!.snippet).toContain('&lt;script&gt;'); expect(results[0]!.snippet).not.toContain('<script>');
  });
  it('quotes keyword syntax, handles empty/non-word input, and paginates duplicate hits', async () => {
    await store.indexRecords('s', [message(1, 'architecture design'), message(2, 'architecture second design')]);
    expect(await store.search({ query: '' })).toEqual([]); expect(await store.search({ query: '"*()' })).toEqual([]);
    expect(await store.search({ query: 'architecture OR unrelated' })).toEqual([]);
    const first = await store.search({ query: 'arch', limit: 1 }); const next = await store.search({ query: 'arch', limit: 1, offset: 1 });
    expect(first).toHaveLength(1); expect(next).toHaveLength(1); expect(first[0]!.matchedContent).not.toBe(next[0]!.matchedContent);
  });
  it('searches 1000-message history in under10ms', async () => {
    await store.indexRecords('history', Array.from({ length: 1000 }, (_, index) => message(index + 1, 'Industrial resilience architecture journal ' + index)));
    await store.search({ query: 'resil arch' }); const samples: number[] = [];
    for (let run = 0; run < 7; run++) { const start = performance.now(); const result = await store.search({ query: 'resil arch' }); samples.push(performance.now() - start); expect(result).toHaveLength(20); }
    const median = samples.sort((a, b) => a - b)[3]!; console.log(`FTS5: 1000-message search median ${median.toFixed(3)}ms`); expect(median).toBeLessThan(10);
  });
});
