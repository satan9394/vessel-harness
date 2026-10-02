import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChunkedSession } from './ChunkedSession.js';

const roots: string[] = [];
const sessions: ChunkedSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.interrupt();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function open(compressed = true, maxChunkBytes = 512) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vessel-frames-'));
  roots.push(dir);
  const session = await ChunkedSession.open({ dir, compressed, maxChunkBytes });
  sessions.push(session);
  return session;
}
const message = (i: number) => ({ type: 'user/message' as const, msgId: `m${i}`, role: 'user' as const, content: `${i} ${'x'.repeat(60)}`, surface: true as const });
async function read(session: ChunkedSession, from?: number, to?: number) {
  const records = [];
  for await (const record of session.streamRecords(from, to)) records.push(record);
  return records;
}

describe('bounded chunked session archive', () => {
  it.each([true, false])('streams ranges, seals bounded chunks and reopens (compressed=%s)', async (compressed) => {
    const session = await open(compressed);
    await Promise.all(Array.from({ length: 20 }, (_, i) => session.append(message(i))));
    await session.close();
    const chunks = await session.listChunks();
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.compressed === compressed && chunk.recordCount <= 2)).toBe(true);
    const reopened = await ChunkedSession.open({ dir: session.dir }); sessions.push(reopened);
    expect((await read(reopened, 7, 10)).map((record) => record.seq)).toEqual([7, 8, 9, 10]);
    expect((await reopened.append(message(20))).seq).toBe(21);
    await reopened.close();
  });
  it('serializes append/flush/close and snapshots queued input', async () => {
    const session = await open();
    const input = message(1);
    const append = session.append(input);
    input.content = 'changed';
    const flush = session.flush();
    const close = session.close();
    await Promise.all([append, flush, close]);
    expect((await read(session))[0]!.content).not.toBe('changed');
    await expect(session.append(message(2))).rejects.toThrow('closed');
    expect(await session.close()).toBeUndefined();
  });
  it('recovers complete durable frames beyond stale metadata and abandons only unflushed tail', async () => {
    const session = await open();
    await session.append(message(0)); await session.flush();
    await fs.writeFile(path.join(session.dir, 'chunks.json'), '[]');
    await session.append(message(1)); await session.interrupt();
    const reopened = await ChunkedSession.open({ dir: session.dir }); sessions.push(reopened);
    expect((await read(reopened)).map((record) => record.seq)).toEqual([1]);
    expect((await reopened.append(message(2))).seq).toBe(2);
  });
  it('quarantines an incomplete unindexed last frame without deleting state', async () => {
    const session = await open(); await session.append(message(0)); await session.close();
    await fs.writeFile(path.join(session.dir, 'chunk-00000001.frame'), 'VESSEL01');
    const reopened = await ChunkedSession.open({ dir: session.dir }); sessions.push(reopened);
    expect(await read(reopened)).toHaveLength(1);
    expect((await fs.readdir(session.dir)).some((name) => name.includes('.torn-'))).toBe(true);
    await reopened.append(message(1)); await reopened.flush();
    expect(await read(reopened)).toHaveLength(2);
  });
  it.each(['checksum', 'interior', 'metadata'])('fails closed on %s corruption', async (kind) => {
    const session = await open();
    for (let i = 0; i < 3; i++) { await session.append(message(i)); await session.flush(); }
    await session.close();
    if (kind === 'checksum') {
      const file = path.join(session.dir, 'chunk-00000000.frame');
      const bytes = await fs.readFile(file); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; await fs.writeFile(file, bytes);
    } else if (kind === 'interior') {
      await fs.rename(path.join(session.dir, 'chunk-00000001.frame'), path.join(session.dir, 'moved.frame'));
    } else await fs.writeFile(path.join(session.dir, 'chunks.json'), '{bad');
    await expect(ChunkedSession.open({ dir: session.dir })).rejects.toThrow();
  });
  it('rejects duplicate writers, oversized records and invalid ranges', async () => {
    const session = await open();
    await expect(ChunkedSession.open({ dir: session.dir })).rejects.toThrow('already open');
    await expect(read(session, 0, 2)).rejects.toThrow('Invalid sequence');
    await session.append(message(1));
    await expect(session.append({ ...message(0), content: 'x'.repeat(1000) })).rejects.toThrow('budget');
    await session.close();
    const reopened = await ChunkedSession.open({ dir: session.dir }); sessions.push(reopened);
    expect((await read(reopened)).map(record => record.msgId)).toEqual(['m1']);
  });
  it('reclaims dead writers under an exclusive acquisition gate, but never steals a live writer', async () => {
    const session = await open(); await session.append(message(1)); await session.close();
    await fs.writeFile(path.join(session.dir, 'writer.json'), JSON.stringify({ pid: process.pid, active: true }));
    await expect(ChunkedSession.open({ dir: session.dir })).rejects.toThrow('alive');
    // pid 2147483647 cannot be allocated by the OS; emulate a killed producer.
    await fs.writeFile(path.join(session.dir, 'writer.json'), JSON.stringify({ pid: 2147483647, active: true }));
    const reopened = await ChunkedSession.open({ dir: session.dir }); sessions.push(reopened);
    expect(await read(reopened)).toHaveLength(1);
  });
  it('does not move a marker while another process owns the acquisition gate', async () => {
    const session = await open(); await session.close();
    const marker = path.join(session.dir, 'writer.json');
    await fs.writeFile(marker, JSON.stringify({ pid: 2147483647, active: true }));
    await fs.writeFile(path.join(session.dir, 'writer.claim'), 'other claimant');
    await expect(ChunkedSession.open({ dir: session.dir })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(JSON.parse(await fs.readFile(marker, 'utf8')).pid).toBe(2147483647);
  });
});
