import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectRegistry, SessionRegistry, SessionController } from '@vessel/application';
import { createVesselServer, type VesselServer } from '../server.js';
import { DAEMON_LOGIN_HTML } from './authMiddleware.js';
import { createNativeNotifier } from './notifications.js';

const token = 'ab'.repeat(24);
let root: string, server: VesselServer, base: string;
const notify = vi.fn();
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-daemon-auth-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/assets/app.js"></script>');
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("fixture Web bundle");');
  server = createVesselServer({ port: 0, staticDir: root, authToken: token, notify,
    projectRegistry: new ProjectRegistry({ vesselHome: root }), sessionRegistry: new SessionRegistry({ vesselHome: root }) });
  await server.listen(); base = `http://127.0.0.1:${server.port}`;
});
afterEach(async () => { await server.close(); fs.rmSync(root, { recursive: true, force: true }); notify.mockClear(); vi.restoreAllMocks(); });

describe('daemon strict Bearer HTTP/SSE authentication', () => {
  it('protects static assets, every API and SSE; rejects missing/forged/query tokens', async () => {
    for (const endpoint of ['/', '/api/projects', '/api/events', '/api/subagents/events', '/api/team/stages', '/api/sessions/x/events', '/api/health/']) {
      expect((await fetch(base + endpoint)).status).toBe(401);
      expect((await fetch(base + endpoint + '?token=' + token)).status).toBe(401);
      expect((await fetch(base + endpoint, { headers: { Authorization: 'Bearer ' + 'cd'.repeat(24) } })).status).toBe(401);
    }
    expect((await fetch(base + '/api/health', { method: 'POST' })).status).toBe(401);
    expect((await fetch(base + '/api/projects', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(base + '/', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(base + '/assets/app.js')).status).toBe(401);
    const bundle = await fetch(base + '/assets/app.js', { headers: { Authorization: `Bearer ${token}` } });
    expect(bundle.headers.get('content-type')).toContain('text/javascript'); expect(await bundle.text()).toContain('fixture Web bundle');
  });
  it('only health is public; HTML entry contains a token form but no secret', async () => {
    expect(await (await fetch(base + '/api/health')).json()).toEqual({ ok: true, version: '0.10.0', webUi: false });
    const response = await fetch(base + '/api/health', { headers: { Accept: 'text/html' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text(); expect(html).toBe(DAEMON_LOGIN_HTML);
    expect(html).toContain('type="password"'); expect(html).toContain("Authorization:'Bearer '+token");
    expect(html).not.toContain(token); expect(html).not.toContain('?token='); expect(html).not.toContain('localStorage');
  });
  it('accepts authenticated SSE and closes it during graceful server shutdown', async () => {
    const response = await fetch(base + '/api/events', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200); const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await server.close(); await reader.cancel();
  });
  it('notifies when a mock session task finishes', async () => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const created = await (await fetch(base + '/api/sessions', { method: 'POST', headers, body: JSON.stringify({ workspaceRoot: root }) })).json() as { session: { id: string } };
    const response = await fetch(`${base}/api/sessions/${created.session.id}/turns`, { method: 'POST', headers, body: JSON.stringify({ prompt: 'hello' }) });
    expect(response.status).toBe(200); expect(notify).toHaveBeenCalledWith('Vessel task finished', expect.stringContaining('success'));
  });
  it('notifies for a staged approval gate and completed offline team without an SSE subscriber', async () => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const created = await (await fetch(base + '/api/sessions', { method: 'POST', headers, body: JSON.stringify({ workspaceRoot: root }) })).json() as { session: { id: string } };
    const staged = await fetch(`${base}/api/sessions/${created.session.id}/team-stages`, { method: 'POST', headers, body: JSON.stringify({ task: 'Write a greeting' }) });
    expect(staged.status).toBe(201);
    const { stage } = await staged.json() as { stage: { id: string } };
    expect(notify).toHaveBeenCalledWith('Vessel approval required', expect.stringContaining(stage.id));
    expect((await fetch(`${base}/api/team/stages/${stage.id}/approve`, { method: 'POST', headers, body: '{}' })).status).toBe(200);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('Vessel team completed', expect.stringContaining(stage.id)));
  });
  it('notifies for an ask policy decision on the session bus without changing core', async () => {
    const capture = vi.spyOn(SessionController, 'create');
    await fetch(base + '/api/sessions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: root }) });
    const ctl = await capture.mock.results[0]!.value;
    await ctl.bus.emit('policy_decision', { toolCallId: 'fixture', toolName: 'Write', verdict: 'ask', decisionPath: [] });
    expect(notify).toHaveBeenCalledWith('Vessel approval required', expect.stringContaining('Write needs approval'));
  });
});

describe('native notification command dispatch (mocked)', () => {
  it('uses Windows WinRT without a BurntToast dependency and escapes task text', () => {
    const execute = vi.fn(); createNativeNotifier('win32', execute)('Vessel', "O'Brien <done> & \"ready\"");
    const [command, args] = execute.mock.calls[0]!; expect(command).toBe('powershell.exe');
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    expect(script).toContain('ToastNotificationManager'); expect(script).not.toContain('BurntToast');
    expect(script).toContain('&apos;'); expect(script).toContain('&lt;done&gt;');
  });
  it('uses native macOS/Linux commands and tolerates an unavailable desktop', () => {
    const execute = vi.fn(); createNativeNotifier('darwin', execute)('Vessel', 'done'); createNativeNotifier('linux', execute)('Vessel', 'done');
    expect(execute.mock.calls.map(call => call[0])).toEqual(['osascript', 'notify-send']);
    expect(() => createNativeNotifier('linux', () => { throw new Error('missing executable'); })('Vessel', 'done')).not.toThrow();
  });
});
