import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectRegistry, SessionRegistry } from '@vessel/application';
import type { PermissionActionWidget } from '@vessel/shared';
import { createVesselServer, type VesselServer } from '../server.js';
import { WidgetRoutes } from './widgetRoutes.js';

const action = (id = 'approval'): PermissionActionWidget => ({ id, kind: 'permission_action', turnIndex: 0, timestamp: new Date().toISOString(), status: 'pending', payload: { actionType: 'filesystem_write', description: 'Write patch', options: [{ id: 'allow', label: 'Allow', tone: 'primary' }] } });
describe('widget decision seam', () => {
  it('isolates sessions, validates options, settles once and replays final state', async () => {
    const routes = new WidgetRoutes(() => true);
    const result = routes.request('a', action());
    expect(routes.respond('b', 'approval', { selectedOptionId: 'allow' }).status).toBe(404);
    expect(routes.respond('a', 'approval', { selectedOptionId: 'missing' }).status).toBe(400);
    expect(routes.respond('a', 'approval', { selectedOptionId: 'allow' }).status).toBe(200);
    expect(await result).toMatchObject({ widgetId: 'approval', selectedOptionId: 'allow' });
    expect(routes.respond('a', 'approval', { selectedOptionId: 'allow' }).status).toBe(400);
    const replay: unknown[] = [];
    routes.subscribe('a', (_kind, widget) => replay.push(widget));
    expect(replay).toEqual([expect.objectContaining({ status: 'resolved' })]);
    routes.close();
  });
  it('expires waiting decisions and closes remaining waiters without rejection', async () => {
    const routes = new WidgetRoutes(() => true);
    const result = routes.request('a', action(), 10);
    await expect(result).resolves.toBeUndefined();
    expect(routes.respond('a', 'approval', { selectedOptionId: 'allow' }).status).toBe(404);
    const pending = routes.request('a', action('second'));
    routes.close();
    await expect(pending).resolves.toBeUndefined();
  });
  it('takes ownership of blocks and rejects reuse or invalid requests', () => {
    const routes = new WidgetRoutes(id => id === 'a');
    expect(() => routes.publish('b', action())).toThrow('session');
    expect(() => routes.request('a', action(), 0)).toThrow('invalid');
    const widget = action();
    routes.publish('a', widget);
    widget.payload.options[0]!.id = 'mutated';
    expect(routes.respond('a', widget.id, { selectedOptionId: 'allow' }).status).toBe(200);
    expect(() => routes.publish('a', action())).toThrow('duplicate');
    routes.close();
  });
  it('detaches a failed observer without interrupting publication or response', async () => {
    const routes = new WidgetRoutes(() => true);
    const off = routes.subscribe('a', () => { throw new Error('disconnected'); });
    const pending = routes.request('a', action());
    expect(routes.respond('a', 'approval', { selectedOptionId: 'allow' }).status).toBe(200);
    await expect(pending).resolves.toMatchObject({ selectedOptionId: 'allow' });
    off();
    routes.close();
  });
  it('expires the original request even when the producer later mutates its id', async () => {
    const routes = new WidgetRoutes(() => true);
    const widget = action();
    const pending = routes.request('a', widget, 10);
    widget.id = 'changed-by-producer';
    await expect(pending).resolves.toBeUndefined();
    expect(routes.respond('a', 'approval', { selectedOptionId: 'allow' }).status).toBe(404);
    routes.close();
  });
  it('does not remove replacement subscribers when an old failed observer detaches again', async () => {
    const routes = new WidgetRoutes(() => true);
    const oldOff = routes.subscribe('a', () => { throw new Error('failed observer'); });
    const pending = routes.request('a', action());
    const events: string[] = [];
    routes.subscribe('a', kind => events.push(kind));
    events.length = 0;
    oldOff();
    oldOff();
    expect(routes.respond('a', 'approval', { selectedOptionId: 'allow' }).status).toBe(200);
    await expect(pending).resolves.toMatchObject({ selectedOptionId: 'allow' });
    expect(events).toEqual(['widget_block', 'action_response']);
    routes.close();
  });
  it('settles expiry and shutdown decisions despite throwing observers', async () => {
    const routes = new WidgetRoutes(() => true);
    const expired: string[] = [];
    routes.subscribe('a', (_kind, widget) => { if ('status' in widget && widget.status === 'expired') throw new Error('observer failed'); });
    routes.subscribe('a', (_kind, widget) => { if ('status' in widget && widget.status === 'expired') expired.push(widget.id); });
    const first = routes.request('a', action('first'), 10);
    await expect(first).resolves.toBeUndefined();
    const second = routes.request('a', action('second'));
    routes.subscribe('a', (_kind, widget) => { if ('status' in widget && widget.id === 'second' && widget.status === 'expired') throw new Error('shutdown observer failed'); });
    const third = routes.request('b', action('third'));
    expect(() => routes.close()).not.toThrow();
    await expect(second).resolves.toBeUndefined();
    await expect(third).resolves.toBeUndefined();
    expect(expired).toEqual(['first', 'second']);
  });
});

describe('widget HTTP and SSE', () => {
  let server: VesselServer | undefined;
  let dir: string | undefined;
  const streams: AbortController[] = [];
  afterEach(async () => {
    for (const stream of streams) stream.abort();
    streams.length = 0;
    await server?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });
  it('streams and replays actual prefix measurements with an injected workspace fingerprint', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-inspector-sse-'));
    server = await createVesselServer({ port: 0, sessionRegistry: new SessionRegistry({ vesselHome: dir }), projectRegistry: new ProjectRegistry({ vesselHome: dir }),
      observeWorkspace: async () => ({ timestamp: 1, trackedFilesHash: 'b'.repeat(64), fileCount: 2, uncommittedDiffBytes: 3 }) }).listen();
    const base = `http://127.0.0.1:${server.port}`;
    const created = await fetch(`${base}/api/sessions`, { method: 'POST', body: JSON.stringify({ workspaceRoot: dir }) });
    const { session } = await created.json() as { session: { id: string } };
    const turn = await fetch(`${base}/api/sessions/${session.id}/turns`, { method: 'POST', body: JSON.stringify({ prompt: 'private fixture prompt' }) });
    expect(turn.status).toBe(200);
    const stream = new AbortController(); streams.push(stream);
    const events = await fetch(`${base}/api/sessions/${session.id}/events`, { signal: AbortSignal.any([stream.signal, AbortSignal.timeout(5000)]) });
    const reader = events.body!.getReader();
    let data = '';
    while (!data.includes('"type":"inspector"')) data += new TextDecoder().decode((await reader.read()).value);
    expect(data).toContain('"trackedFilesHash":"' + 'b'.repeat(64) + '"');
    expect(data).toContain('"stableBytes":');
    expect(data).not.toContain('private fixture prompt');
    stream.abort(); await reader.cancel().catch(() => {});
  });
  it('streams named frames on singular/plural routes and wakes the pending decision via HTTP', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-widgets-'));
    server = await createVesselServer({ port: 0, sessionRegistry: new SessionRegistry({ vesselHome: dir }), projectRegistry: new ProjectRegistry({ vesselHome: dir }) }).listen();
    const base = `http://127.0.0.1:${server.port}`;
    const created = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: dir }) });
    const { session } = await created.json() as { session: { id: string } };
    expect(created.status).toBe(201);
    const stream = new AbortController(); streams.push(stream);
    const events = await fetch(`${base}/api/session/${session.id}/events`, { signal: stream.signal });
    expect(events.status).toBe(200);
    const reader = events.body!.getReader();
    await reader.read(); // opening ping confirms subscription is attached
    const pending = server.widgets!.request(session.id, action());
    const data = new TextDecoder().decode((await reader.read()).value);
    expect(data).toContain('event: widget_block');
    expect(data).toContain('event: widget\n');
    expect(data).toContain('event: action_request');
    const endpoint = `${base}/api/session/${session.id}/widget/approval/respond`;
    expect((await fetch(endpoint, { method: 'POST', body: '{' })).status).toBe(400);
    const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ selectedOptionId: 'allow' }) });
    expect(await response.json()).toEqual({ success: true });
    expect(await pending).toMatchObject({ selectedOptionId: 'allow' });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: action_response');
    expect((await fetch(endpoint, { method: 'POST', body: JSON.stringify({ selectedOptionId: 'allow' }) })).status).toBe(400);
    expect((await fetch(`${base}/api/sessions/${session.id}/widget/missing/respond`, { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
