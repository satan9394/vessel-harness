import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { SessionRegistry, ProjectRegistry, ReviewHandoffStore, type SessionController } from '@vessel/application';
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

  /** true while a model call is blocked at the gate (a waiter is registered). */
  get holding(): boolean {
    return this.waiters.length > 0;
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

describe('local server — POST /steer caches mid-turn and injects at the next boundary (task 051)', () => {
  let dir: string;
  let ws: string;
  let home: string;
  let server: VesselServer;
  let base: string;
  let ctl: SessionController | undefined;
  let gated: GatedServerProvider;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-steer-server-'));
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

  it('a steer posted while a turn is in flight is cached, then consumed at the next turn boundary as source=steer', async () => {
    const create = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { session: { id: string } };
    const id = created.session.id;

    // turn 1 in flight (single pure-text step gated mid-stream). Wait until the
    // model call is truly blocked at the gate (holding) — that point is AFTER
    // turn 1's step-1 boundary, so a steer landing now is deterministically
    // cached rather than consumed by turn 1.
    const turn1 = fetch(`${base}/api/sessions/${id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'stream something' }),
    });
    await waitFor(() => gated.holding, 15000);

    // steer lands mid-turn: cached, acknowledged with the pending count
    const steer = await fetch(`${base}/api/sessions/${id}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '先别改这个文件' }),
    });
    expect(steer.status).toBe(200);
    const steerBody = (await steer.json()) as { ok: boolean; pendingSteerCount: number };
    expect(steerBody.ok).toBe(true);
    expect(steerBody.pendingSteerCount).toBe(1);

    // turn 1 completes as pure text — it has no further step boundary, so the
    // steer is NOT injected into it and stays pending (steer never interrupts)
    gated.release();
    const turn1Res = await turn1;
    expect(turn1Res.status).toBe(200);
    const result1 = (await turn1Res.json()) as { finalText: string; kind: string };
    expect(result1.kind).toBe('success');
    expect(ctl!.pendingSteerCount).toBe(1);
    const steerRecs = () =>
      ctl!.session.replay().filter((r) => r.type === 'user/message' && (r as { source?: string }).source === 'steer');
    expect(steerRecs()).toHaveLength(0);

    // turn 2 drains the queue at its first step boundary (record appears before
    // its model call) and the steer redirects the next round
    const turn2 = fetch(`${base}/api/sessions/${id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'continue' }),
    });
    await waitFor(() => steerRecs().length > 0, 15000);
    // turn 2's model call is gated again — release in a loop until the turn
    // settles (extra releases are no-ops, so timing is not sensitive)
    const turn2Settled = (async () => {
      const res = await turn2;
      return (await res.json()) as { kind: string };
    })();
    let turn2Done = false;
    turn2Settled.then(
      () => (turn2Done = true),
      () => (turn2Done = true),
    );
    const deadline = Date.now() + 15000;
    while (!turn2Done && Date.now() < deadline) {
      gated.release();
      await new Promise((r) => setTimeout(r, 5));
    }
    const result2 = await turn2Settled;
    expect(result2.kind).toBe('success');

    // consumed + recorded as an auditable source=steer user/message
    expect(ctl!.pendingSteerCount).toBe(0);
    const recs = steerRecs() as { content: string; source?: string; ts?: string }[];
    expect(recs).toHaveLength(1);
    expect(recs[0]!.content).toBe('先别改这个文件');
    expect(recs[0]!.source).toBe('steer');
    expect(typeof recs[0]!.ts).toBe('string');
  });
});

describe('local server — task 060 seams (route mode/pin + team runs + external review)', () => {
  let dir: string;
  let ws: string;
  let home: string;
  let reviewsRoot: string;
  let opened: string[] = [];
  let server: VesselServer;
  let base: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-team-server-'));
    ws = path.join(dir, 'workspace');
    home = path.join(dir, 'vessel-home');
    reviewsRoot = path.join(dir, 'reviews');
    opened = [];
    fs.mkdirSync(ws, { recursive: true });

    const projectRegistry = new ProjectRegistry({ vesselHome: home });
    const sessionRegistry = new SessionRegistry({ vesselHome: home });
    server = createVesselServer({
      port: 0,
      projectRegistry,
      sessionRegistry,
      reviewStore: new ReviewHandoffStore({ reviewsRoot }),
      openFolder: (d) => void opened.push(d),
      sessionFactory: async (input) => {
        const { SessionController: SC } = await import('@vessel/application');
        const provider = new MockProvider([{ when: /.*/, response: { text: `SERVER-ECHO:${input.model ?? 'default'}` } }], {
          model: input.model ?? 'default',
        });
        return SC.create({
          workspaceRoot: input.workspaceRoot,
          provider,
          model: input.model ?? 'default',
          policySystemPath: POLICY,
          behaviorIRPath: BEHAVIOR,
          permission: input.permission ?? 'workspace-write',
          registry: input.registry,
        });
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

  async function createSession(): Promise<string> {
    const create = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws }),
    });
    expect(create.status).toBe(201);
    const body = (await create.json()) as { session: { id: string } };
    return body.session.id;
  }

  it('route defaults to auto/unpinned, mode POST switches the session choice', async () => {
    const id = await createSession();
    const get1 = await fetch(`${base}/api/sessions/${id}/route`);
    expect(get1.status).toBe(200);
    const s1 = (await get1.json()) as { mode: string; pinned: boolean; route: unknown };
    expect(s1).toEqual({ mode: 'auto', pinned: false, route: null });

    const set = await fetch(`${base}/api/sessions/${id}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'pro' }),
    });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { mode: string }).mode).toBe('pro');

    const bad = await fetch(`${base}/api/sessions/${id}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ultra' }),
    });
    expect(bad.status).toBe(400);
  });

  it('resolve returns the actual model chain (Fast/Pro bypass classify; auto uses §8.2 roles)', async () => {
    const id = await createSession();
    // explicit pro → single developer at the pro binding
    const pro = await fetch(`${base}/api/sessions/${id}/route/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: '', mode: 'pro' }),
    });
    expect(pro.status).toBe(200);
    const routePro = (await pro.json()) as {
      route: { mode: string; roles: string[]; roleModels: { role: string; tier: string; model: string }[]; primary: { model: string } };
    };
    expect(routePro.route.mode).toBe('pro');
    expect(routePro.route.roles).toEqual(['developer']);
    expect(routePro.route.roleModels[0]?.tier).toBe('pro');
    expect(routePro.route.primary.model).toBe('mock-pro');

    // auto with a task → roster plan aligned to roleModels (§8.2)
    const auto = await fetch(`${base}/api/sessions/${id}/route/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: '重构导出模块并补测试' }),
    });
    expect(auto.status).toBe(200);
    const routeAuto = (await auto.json()) as {
      route: { mode: string; roles: string[]; roleModels: { role: string; model: string }[]; complexity?: string };
    };
    expect(routeAuto.route.mode).toBe('auto');
    expect(routeAuto.route.roles.length).toBeGreaterThan(0);
    expect(routeAuto.route.roles.length).toBe(routeAuto.route.roleModels.length);
    expect(routeAuto.route.roleModels.every((r) => r.model.startsWith('mock-'))).toBe(true);
  });

  it('pin locks the auto resolution until unpin (session-level, no re-judge)', async () => {
    const id = await createSession();
    const first = await fetch(`${base}/api/sessions/${id}/route/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: '实现一个导出功能' }),
    });
    const firstBody = (await first.json()) as { route: { roles: string[]; roleModels: { model: string }[] } };

    const pin = await fetch(`${base}/api/sessions/${id}/route/pin`, { method: 'POST' });
    expect(pin.status).toBe(200);
    const pinnedState = (await pin.json()) as { pinned: boolean; route: { pinned: boolean; roles: string[] } };
    expect(pinnedState.pinned).toBe(true);
    expect(pinnedState.route.pinned).toBe(true);

    // resolving again (auto) returns the pinned plan — same roster, no re-judge
    const again = await fetch(`${base}/api/sessions/${id}/route/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: '完全不同的一句话任务' }),
    });
    const againBody = (await again.json()) as { pinned: boolean; route: { roles: string[]; roleModels: { model: string }[] } };
    expect(againBody.pinned).toBe(true);
    expect(againBody.route.roles).toEqual(firstBody.route.roles);

    const unpin = await fetch(`${base}/api/sessions/${id}/route/unpin`, { method: 'POST' });
    expect((await unpin.json()) as { pinned: boolean }).toMatchObject({ pinned: false });
  });

  it('POST /team-runs starts a real 057 run; GET current serves the done projection', async () => {
    const id = await createSession();
    const start = await fetch(`${base}/api/sessions/${id}/team-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: '实现一个导出功能', acceptance: ['AC-1: 能导出'] }),
    });
    expect(start.status).toBe(202);
    const started = (await start.json()) as { run: { runId: string; status: string } };
    expect(started.run.status).toBe('running');
    expect(started.run.runId.startsWith('run_')).toBe(true);

    // poll until the run settles
    type RunSnapshot = {
      team: { status: string; outcome?: string; roster: { memberId: string }[]; phases: { phase: string; status: string }[] } | null;
    };
    let state: RunSnapshot | null = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const current = await fetch(`${base}/api/sessions/${id}/team-runs/current`);
      const body = (await current.json()) as RunSnapshot;
      state = body;
      if (state?.team?.status === 'done') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(state?.team?.status).toBe('done');
    expect(state?.team?.outcome).toBe('completed');
    // §8.2 medium plan resolved from the auto chain: developer + reviewer
    expect(state?.team?.roster.map((m) => m.memberId).sort()).toEqual(['developer', 'reviewer']);
    expect(state?.team?.phases.map((p) => p.phase).sort()).toEqual(['evaluate', 'generate']);
    expect(state?.team?.phases.every((p) => p.status === 'completed')).toBe(true);
  });

  it('SSE streams live team snapshot frames while a team run executes', async () => {
    const id = await createSession();
    const res = await fetch(`${base}/api/sessions/${id}/events`);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const startPromise = fetch(`${base}/api/sessions/${id}/team-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: '重构并实现导出' }),
    });
    expect((await startPromise).status).toBe(202);

    let gotTeamDone = false;
    for (let i = 0; i < 400 && !gotTeamDone; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop() ?? '';
      for (const frame of frames) {
        const m = /^data: (.*)$/m.exec(frame);
        if (!m) continue;
        const evt = JSON.parse(m[1]!) as { type: string; delta?: { kind: string; state?: { status?: string } } };
        if (evt.type === 'team' && evt.delta?.state?.status === 'done') {
          gotTeamDone = true;
          break;
        }
      }
    }
    await reader.cancel();
    expect(gotTeamDone).toBe(true);
  });

  it('creates review handoffs, serves raw handoff.md, imports results and reports folder', async () => {
    // create
    const create = await fetch(`${base}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: '实现一个导出功能',
        acceptance: ['AC-1 导出 run'],
        changedFiles: ['src/out.ts'],
        workspaceRoot: ws,
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { review: { id: string; status: string; acceptance: string[] } };
    expect(created.review.status).toBe('pending');
    expect(created.review.acceptance).toEqual(['AC-1 导出 run']);

    // handoff.md artifact is complete (§9.1 eight-section skeleton)
    const md = await fetch(`${base}/api/reviews/${created.review.id}/handoff.md`);
    expect(md.status).toBe(200);
    const text = await md.text();
    expect(text).toContain('# External Review Handoff');
    expect(text).toContain('## Acceptance Criteria');
    expect(text).toContain('## Required Output Schema');

    // import a result (058-compatible JSON) → record flips to imported
    const imp = await fetch(`${base}/api/reviews/${created.review.id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '{"verdict":"not_met","unmet":["AC-1"],"suggestions":["补证据"],"reason":"缺测试","evidence":[]}',
      }),
    });
    expect(imp.status).toBe(200);
    const imported = (await imp.json()) as {
      review: { status: string; results: { source: string; conclusion: { verdict: string } }[] };
    };
    expect(imported.review.status).toBe('imported');
    expect(imported.review.results).toHaveLength(1);
    expect(imported.review.results[0]?.source).toBe('external');
    expect(imported.review.results[0]?.conclusion.verdict).toBe('not_met');

    // folder endpoint + Open Folder action (injected recorder)
    const folder = await fetch(`${base}/api/reviews/${created.review.id}/folder`);
    expect(folder.status).toBe(200);
    const dirRes = (await folder.json()) as { folder: string };
    expect(dirRes.folder).toContain(created.review.id);

    const open = await fetch(`${base}/api/reviews/${created.review.id}/open`, { method: 'POST' });
    expect(open.status).toBe(200);
    expect(opened).toEqual([dirRes.folder]);

    // list shows it once
    const list = await fetch(`${base}/api/reviews`);
    const listed = (await list.json()) as { reviews: { id: string }[] };
    expect(listed.reviews.some((r) => r.id === created.review.id)).toBe(true);
  });

  it('review endpoints validate: missing task 400, unknown id 404, empty import 400', async () => {
    const bad = await fetch(`${base}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);

    const missing = await fetch(`${base}/api/reviews/nope`);
    expect(missing.status).toBe(404);

    const created = await fetch(`${base}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'task' }),
    });
    const { review } = (await created.json()) as { review: { id: string } };
    const emptyImport = await fetch(`${base}/api/reviews/${review.id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    expect(emptyImport.status).toBe(400);
  });
});