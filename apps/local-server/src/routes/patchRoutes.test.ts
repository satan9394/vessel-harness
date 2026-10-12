import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectRegistry, SessionRegistry } from '@vessel/application';
import type { DiffInspectorWidget } from '@vessel/shared';
import { createVesselServer, type VesselServer } from '../server.js';

const patch = '@@ -1 +1,2 @@\n-a\n+A\n+extra\n@@ -3 +4 @@\n-c\n+C\n';
const widget = (id = 'proposal', filePath = 'a.txt', text = patch): DiffInspectorWidget => ({ id, kind: 'diff_inspector', status: 'pending', timestamp: new Date().toISOString(), turnIndex: 0, payload: { filePath, patch: text, additions: 3, deletions: 2 } });
describe('server-owned selected patch HTTP', () => {
  let root: string; let server: VesselServer | undefined; let base: string; let id: string;
  afterEach(async () => { await server?.close(); if (root) fs.rmSync(root, { recursive: true, force: true }); });
  async function setup(permission = 'workspace-write') {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-patches-')); fs.writeFileSync(path.join(root, 'a.txt'), 'a\nb\nc\n');
    server = await createVesselServer({ port: 0, sessionRegistry: new SessionRegistry({ vesselHome: root }), projectRegistry: new ProjectRegistry({ vesselHome: root }) }).listen();
    base = `http://127.0.0.1:${server.port}`;
    const response = await fetch(`${base}/api/sessions`, { method: 'POST', body: JSON.stringify({ workspaceRoot: root, permission }) });
    id = (await response.json() as { session: { id: string } }).session.id;
    server.widgets!.publish(id, widget());
  }
  const send = (hunk = 0, action = 'accept', extra = {}) => fetch(`${base}/api/session/${id}/patch/apply`, { method: 'POST', body: JSON.stringify({ widgetId: 'proposal', hunkId: `a.txt#hunk-${hunk}`, action, ...extra }) });
  it('cherry-picks out of order, replays decisions, isolates sessions and rejects conflicting decisions', async () => {
    await setup();
    expect((await send(1)).status).toBe(200); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('a\nb\nC\n');
    expect((await send(0)).status).toBe(200); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('A\nextra\nb\nC\n');
    expect((await send(0)).status).toBe(200);
    const replay: unknown[] = []; server!.widgets!.subscribe(id, (_type, block) => replay.push(block));
    expect(replay[0]).toMatchObject({ payload: { hunkStatuses: { 'a.txt#hunk-0': 'accepted', 'a.txt#hunk-1': 'accepted' } } });
    expect((await send(0, 'reject')).status).toBe(200); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('a\nb\nC\n');
    expect((await send(0)).status).toBe(200); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('A\nextra\nb\nC\n');
    const missing = await fetch(`${base}/api/session/missing/patch/apply`, { method: 'POST', body: '{}' }); expect(missing.status).toBe(404);
  });
  it('reviews an already-applied worktree diff, reverts selected hunks out of order and safely reapplies', async () => {
    await setup();
    fs.writeFileSync(path.join(root, 'a.txt'), 'A\nextra\nb\nC\n');
    server!.widgets!.publish(id, widget('worktree'));
    const decide = (index: number, action: string) => fetch(`${base}/api/session/${id}/patch/apply`, { method: 'POST', body: JSON.stringify({ widgetId: 'worktree', hunkId: `a.txt#hunk-${index}`, action }) });
    expect((await decide(0, 'accept')).status).toBe(200); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('A\nextra\nb\nC\n');
    expect((await decide(0, 'reject')).status).toBe(200); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('a\nb\nC\n');
    expect((await decide(1, 'reject')).status).toBe(200); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('a\nb\nc\n');
    expect((await decide(1, 'accept')).status).toBe(200); expect((await decide(0, 'accept')).status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('A\nextra\nb\nC\n');
    fs.appendFileSync(path.join(root, 'a.txt'), 'user edit\n');
    expect((await decide(1, 'reject')).status).toBe(409); expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toContain('user edit');
  });
  it('discards without overwriting user edits and conflicts on stale full file', async () => {
    await setup(); fs.appendFileSync(path.join(root, 'a.txt'), 'user edit\n');
    expect((await send()).status).toBe(409); expect((await send(0, 'reject')).status).toBe(200);
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('a\nb\nc\nuser edit\n');
    expect((await send(0, 'reject')).status).toBe(200);
  });
  it('forbids read-only writes and arbitrary patches/paths/options', async () => {
    await setup('read-only'); expect((await send()).status).toBe(403);
  });
  it.each([
    { bytes: Buffer.from([0x61, 0x0a, 0xff, 0x0a]), error: 'unsupported_patch_encoding' },
    { bytes: Buffer.from('a\r\nb\nc\r\n'), error: 'unsupported_patch_line_endings' },
    { bytes: Buffer.from('a\nb\rc\n'), error: 'unsupported_patch_line_endings' },
  ])('rejects lossy text rewriting before touching any bytes: $error', async ({ bytes, error }) => {
    await setup();
    const filename = path.join(root, 'a.txt');
    fs.writeFileSync(filename, bytes);
    server!.widgets!.publish(id, widget('encoding', 'a.txt', '@@ -1 +1 @@\n-a\n+A\n'));
    const response = await fetch(`${base}/api/session/${id}/patch/apply`, { method: 'POST', body: JSON.stringify({ widgetId: 'encoding', hunkId: 'a.txt#hunk-0', action: 'accept' }) });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error });
    expect(fs.readFileSync(filename)).toEqual(bytes);
  });
  it('preserves UTF8 and uniform CRLF outside an applied hunk', async () => {
    await setup();
    const filename = path.join(root, 'a.txt');
    fs.writeFileSync(filename, 'a\r\n保持\r\nc\r\n');
    server!.widgets!.publish(id, widget('crlf', 'a.txt', '@@ -1 +1 @@\n-a\n+A\n'));
    const response = await fetch(`${base}/api/session/${id}/patch/apply`, { method: 'POST', body: JSON.stringify({ widgetId: 'crlf', hunkId: 'a.txt#hunk-0', action: 'accept' }) });
    expect(response.status).toBe(200); expect(fs.readFileSync(filename)).toEqual(Buffer.from('A\r\n保持\r\nc\r\n'));
  });
  it('validates request ownership and rejects traversal, hardlinks, symlinks, malformed patches', async () => {
    await setup();
    expect((await send(0, 'accept', { patch: patch })).status).toBe(400);
    expect((await send(8)).status).toBe(404); expect((await send(0, 'erase')).status).toBe(400);
    for (const file of ['../a.txt', 'C:/a.txt', '.git/config', '.git./config', '.git /config', 'CON.txt', 'a.txt.']) {
      server!.widgets!.publish(id, widget(file, file));
      const response = await fetch(`${base}/api/session/${id}/patch/apply`, { method: 'POST', body: JSON.stringify({ widgetId: file, hunkId: `${file}#hunk-0`, action: 'accept' }) });
      expect(response.status).toBe(400);
    }
    fs.linkSync(path.join(root, 'a.txt'), path.join(root, 'linked.txt')); server!.widgets!.publish(id, widget('link', 'linked.txt'));
    expect((await fetch(`${base}/api/session/${id}/patch/apply`, { method: 'POST', body: JSON.stringify({ widgetId: 'link', hunkId: 'linked.txt#hunk-0', action: 'accept' }) })).status).toBe(400);
    fs.mkdirSync(path.join(root, 'real')); fs.writeFileSync(path.join(root, 'real', 'f.txt'), 'a\nb\nc\n');
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'alias'), 'junction'); server!.widgets!.publish(id, widget('symlink', 'alias/f.txt'));
    expect((await fetch(`${base}/api/session/${id}/patch/apply`, { method: 'POST', body: JSON.stringify({ widgetId: 'symlink', hunkId: 'alias/f.txt#hunk-0', action: 'accept' }) })).status).toBe(400);
  });
});
