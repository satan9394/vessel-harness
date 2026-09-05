import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from './Session.js';

describe('Session (append-only JSONL event log)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-session-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends records with monotonic seq and persists to JSONL', async () => {
    const s = await Session.open({ workspaceRoot: dir, sessionId: 's1' });
    await s.appendSync({ type: 'turn/start', turnId: 't1', surface: false });
    await s.appendSync({ type: 'user/message', msgId: 'm1', role: 'user', content: 'hi', surface: true });
    expect(s.size).toBe(2);
    await s.close();

    const raw = fs.readFileSync(path.join(dir, '.harness', 'sessions', 's1', 'session.jsonl'), 'utf8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first.seq).toBe(1);
    expect(first.type).toBe('turn/start');
  });

  it('resume replays and synthesizes an interrupted closer for an unfinished turn', async () => {
    const s = await Session.open({ workspaceRoot: dir, sessionId: 's2' });
    await s.appendSync({ type: 'turn/start', turnId: 't_open', surface: false });
    await s.appendSync({ type: 'user/message', msgId: 'm1', role: 'user', content: 'x', surface: true });
    await s.close();

    const r = await Session.open({ workspaceRoot: dir, sessionId: 's2' });
    const records = r.replay();
    const last = records[records.length - 1]!;
    expect(last.type).toBe('turn/end');
    expect((last as { kind: string }).kind).toBe('interrupted');
    await r.close();
  });

  it('surface projects only user/message, assistant/message, tool/result', async () => {
    const s = await Session.open({ workspaceRoot: dir, sessionId: 's3' });
    await s.appendSync({ type: 'turn/start', turnId: 't1', surface: false });
    await s.appendSync({ type: 'user/message', msgId: 'm1', role: 'user', content: 'q', surface: true });
    await s.appendSync({ type: 'tool/call', toolCallId: 'tc1', toolName: 'Read', arguments: {}, mode: 'auto', surface: false });
    await s.appendSync({ type: 'tool/result', toolCallId: 'tc1', toolName: 'Read', content: 'data', meta: {}, surface: true });
    await s.appendSync({ type: 'turn/end', turnId: 't1', kind: 'success', stats: { steps: 1, toolCalls: 1, durationMs: 1 }, surface: false });
    expect(s.surface().map((r) => r.type)).toEqual(['user/message', 'tool/result']);
    await s.close();
  });

  it('refuses a second concurrent writer (single-writer lease)', async () => {
    const s = await Session.open({ workspaceRoot: dir, sessionId: 's4' });
    await expect(Session.open({ workspaceRoot: dir, sessionId: 's4' })).rejects.toThrow(/already open/);
    await s.close();
  });

  it('replaceRegion swaps a seq range with a summary and keeps numbering continuous', async () => {
    const s = await Session.open({ workspaceRoot: dir, sessionId: 's5' });
    await s.appendSync({ type: 'user/message', msgId: 'm1', role: 'user', content: 'a', surface: true });
    await s.appendSync({ type: 'user/message', msgId: 'm2', role: 'user', content: 'b', surface: true });
    const removed = await s.replaceRegion(1, 1, {
      type: 'user/message', msgId: 'mc', role: 'user', content: '<compacted-summary>…', source: 'compacted-summary', surface: true,
    });
    expect(removed).toBe(1);
    const seqs = s.replay().map((r) => r.seq);
    expect(seqs).toEqual([1, 2]);
    await s.close();
  });
});
