import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { SessionRegistry, ProjectRegistry, type SessionController } from '@vessel/application';
import { createVesselServer, type VesselServer } from './server.js';

const POLICY = path.resolve('configs/policy.default.yaml');
const BEHAVIOR = path.resolve('configs/behavior.default.yaml');

describe('local server HTTP API + SSE', () => {
  let dir: string;
  let ws: string;
  let home: string;
  let server: VesselServer;
  let base: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-local-server-'));
    ws = path.join(dir, 'workspace');
    home = path.join(dir, 'vessel-home');
    fs.mkdirSync(ws, { recursive: true });

    const projectRegistry = new ProjectRegistry({ vesselHome: home });
    const sessionRegistry = new SessionRegistry({ vesselHome: home });

    server = createVesselServer({
      port: 0,
      projectRegistry,
      sessionRegistry,
      sessionFactory: async (input) => {
        const provider = new MockProvider([{ when: /.*/, response: { text: `SERVER-ECHO:${input.model ?? 'default'}` } }], {
          model: input.model ?? 'default',
        });
        return importSession(provider, input);
      },
      staticDir: ws,
    });
    await server.listen();
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function importSession(
    provider: InstanceType<typeof MockProvider>,
    input: { workspaceRoot: string; model?: string; permission?: 'read-only' | 'workspace-write' | 'danger-full-access'; registry?: SessionRegistry },
  ): Promise<SessionController> {
    const { SessionController } = await import('@vessel/application');
    return SessionController.create({
      workspaceRoot: input.workspaceRoot,
      provider,
      model: input.model ?? 'default',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
      permission: input.permission ?? 'workspace-write',
      registry: input.registry,
    });
  }

  it('GET /api/health returns ok + version', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBe('0.10.0');
  });

  it('POST /api/projects/open + GET /api/projects works', async () => {
    const open = await fetch(`${base}/api/projects/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws }),
    });
    expect(open.status).toBe(200);
    const opened = (await open.json()) as { project: { root: string } };
    expect(opened.project.root).toBe(path.resolve(ws));

    const list = await fetch(`${base}/api/projects`);
    const listed = (await list.json()) as { projects: { root: string }[] };
    expect(listed.projects.some((p) => p.root === path.resolve(ws))).toBe(true);
  });

  it('POST /api/sessions → GET /api/sessions/:id → health-like state', async () => {
    const create = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws, model: 'm1', permission: 'read-only' }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { session: { id: string; workspaceRoot: string; provider: string; model: string; permission: string } };
    expect(created.session.provider).toBe('mock');
    expect(created.session.model).toBe('m1');
    expect(created.session.permission).toBe('read-only');

    const get = await fetch(`${base}/api/sessions/${created.session.id}`);
    expect(get.status).toBe(200);
    const state = (await get.json()) as { session: { id: string } };
    expect(state.session.id).toBe(created.session.id);
  });

  it('POST /api/sessions/:id/turns runs a mock turn and returns finalText', async () => {
    const create = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws }),
    });
    const created = (await create.json()) as { session: { id: string } };

    const turn = await fetch(`${base}/api/sessions/${created.session.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'say hello' }),
    });
    expect(turn.status).toBe(200);
    const result = (await turn.json()) as { finalText: string; kind: string; steps: number };
    expect(result.finalText).toBe('SERVER-ECHO:default');
    expect(result.kind).toBe('success');
    expect(typeof result.steps).toBe('number');
  });

  it('POST /api/sessions/:id/interrupt and /steer are safe no-crash seams', async () => {
    const create = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws }),
    });
    const created = (await create.json()) as { session: { id: string } };
    const id = created.session.id;

    const interrupt = await fetch(`${base}/api/sessions/${id}/interrupt`, { method: 'POST' });
    expect(interrupt.status).toBe(200);

    const steer = await fetch(`${base}/api/sessions/${id}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'keep it short' }),
    });
    expect(steer.status).toBe(200);
    const steerBody = (await steer.json()) as { ok: boolean; pendingSteerCount: number };
    expect(steerBody.ok).toBe(true);
    expect(steerBody.pendingSteerCount).toBe(1);
  });

  it('GET /api/sessions/:id/events sends SSE headers + a ping event', async () => {
    const create = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws }),
    });
    const created = (await create.json()) as { session: { id: string } };

    const res = await fetch(`${base}/api/sessions/${created.session.id}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // read at least the initial ping frame (two \n\n terminated data lines)
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let gotPing = false;
    for (let i = 0; i < 50 && !gotPing; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      gotPing = /"type":"ping"/.test(buf);
    }
    expect(gotPing).toBe(true);
    await reader.cancel();
  });

  it('unknown session id → 404', async () => {
    const get = await fetch(`${base}/api/sessions/nope`);
    expect(get.status).toBe(404);
  });

  it('SSE emits a conversation delta after a turn (projection-based)', async () => {
    const create = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws }),
    });
    const created = (await create.json()) as { session: { id: string } };
    const id = created.session.id;

    // open the SSE stream before the turn so its projection events are captured
    const res = await fetch(`${base}/api/sessions/${id}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    // trigger a turn in parallel with the open stream
    const turnPromise = fetch(`${base}/api/sessions/${id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello sse' }),
    });

    // read frames until we see a conversation delta (or bail)
    let gotConversation = false;
    for (let i = 0; i < 200 && !gotConversation; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // split on blank-line-terminated data frames
      const frames = buf.split('\n\n');
      buf = frames.pop() ?? '';
      for (const frame of frames) {
        const m = /^data: (.*)$/m.exec(frame);
        if (!m) continue;
        const evt = JSON.parse(m[1]!) as { type: string; delta?: unknown };
        if (evt.type === 'conversation') {
          gotConversation = true;
          break;
        }
      }
    }
    await turnPromise;
    await reader.cancel();
    expect(gotConversation).toBe(true);
  });
});