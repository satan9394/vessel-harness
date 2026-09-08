import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { SessionRegistry, ProjectRegistry, type SessionController } from '@vessel/application';
import { createVesselServer, type VesselServer } from './server.js';
import type { ChatProvider, ChatRequest, ChatResponse, StreamChunk } from '@vessel/shared';

const POLICY = path.resolve('configs/policy.default.yaml');
const BEHAVIOR = path.resolve('configs/behavior.default.yaml');

async function waitFor(fn: () => boolean, timeoutMs = 4000, stepMs = 10): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * Gated streaming provider for interrupt tests: yields a prefix, then pauses on
 * a gate until release() — a deterministic "turn in flight" window.
 */
class GatedServerProvider implements ChatProvider {
  readonly id = 'gated';
  private waiters: (() => void)[] = [];
  private startedResolve!: () => void;
  readonly started = new Promise<void>((r) => (this.startedResolve = r));

  async chat(): Promise<ChatResponse> {
    throw new Error('chat() must not be called when provider.stream is present');
  }

  async *stream(_request: ChatRequest): AsyncGenerator<StreamChunk> {
    this.startedResolve();
    yield { type: 'message_start', model: 'g' };
    yield { type: 'text_delta', text: 'prefix ' };
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    yield { type: 'text_delta', text: 'suffix' };
    yield { type: 'usage', inputTokens: 2, outputTokens: 2 };
    yield { type: 'message_end', finishReason: 'stop' };
  }

  release(): void {
    this.waiters.shift()?.();
  }
}

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

describe('local server — POST /interrupt stops an in-flight turn (task 050)', () => {
  let dir: string;
  let ws: string;
  let home: string;
  let server: VesselServer;
  let base: string;
  let ctl: SessionController | undefined;
  let gated: GatedServerProvider;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-interrupt-server-'));
    ws = path.join(dir, 'workspace');
    home = path.join(dir, 'vessel-home');
    fs.mkdirSync(ws, { recursive: true });

    gated = new GatedServerProvider();
    const sessionRegistry = new SessionRegistry({ vesselHome: home });
    server = createVesselServer({
      port: 0,
      sessionRegistry,
      sessionFactory: async (input) => {
        const { SessionController: SC } = await import('@vessel/application');
        ctl = await SC.create({
          workspaceRoot: input.workspaceRoot,
          provider: gated,
          model: input.model ?? 'default',
          policySystemPath: POLICY,
          behaviorIRPath: BEHAVIOR,
          permission: input.permission ?? 'workspace-write',
          registry: input.registry,
        });
        return ctl;
      },
      staticDir: ws,
    });
    await server.listen();
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    if (server) await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a turn in flight ends kind=interrupted with turn/start → turn/end pairing kept', async () => {
    const create = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { session: { id: string } };
    const id = created.session.id;

    const turnPromise = fetch(`${base}/api/sessions/${id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'stream something' }),
    });

    // wait until the turn's interrupt scope is really open, then stop it
    expect(ctl).toBeDefined();
    await waitFor(() => ctl!.loop.turnActive);
    const interrupt = await fetch(`${base}/api/sessions/${id}/interrupt`, { method: 'POST' });
    expect(interrupt.status).toBe(200);
    expect((await interrupt.json()) as { ok: boolean }).toEqual({ ok: true });

    // release the gate so the in-flight stream settles; the turn must close interrupted
    gated.release();
    const turnRes = await turnPromise;
    expect(turnRes.status).toBe(200);
    const result = (await turnRes.json()) as { finalText: string; kind: string; turnId: string };
    expect(result.kind).toBe('interrupted');

    // session log: turn/start → turn/end{kind:interrupted}, nothing after turn/end
    const records = ctl!.session.replay();
    const kinds = records.filter((r) => r.type === 'turn/start' || r.type === 'turn/end');
    expect(kinds.map((r) => r.type)).toEqual(['turn/start', 'turn/end']);
    const end = kinds[1] as { kind: string; turnId: string };
    expect(end.kind).toBe('interrupted');
    expect(end.turnId).toBe(result.turnId);
    // scope is released once the turn settles → the session can run again
    expect(ctl!.loop.turnActive).toBe(false);
  });
});