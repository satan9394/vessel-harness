import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectRegistry, SessionRegistry } from '@vessel/application';
import type { ChatRequest, ChatProvider } from '@vessel/shared';
import { ProviderStore } from './providers/ProviderStore.js';
import { createVesselServer, type VesselServer } from './server.js';
import { SessionModelHub } from './sessionModelHub.js';
import { TeamStageRoutes } from './teamRoutes.js';

describe('session model hub', () => {
  let dir: string; let server: VesselServer; let base: string; let store: ProviderStore; let registry: SessionRegistry;
  let release: (() => void) | undefined; let stalled = false;
  const calls: { provider: string; request: ChatRequest }[] = [];
  const builder = vi.fn((cfg: { id: string; model: string }): ChatProvider => {
    if (cfg.model === 'broken') throw new Error('key-secret construction failed');
    return { id: cfg.id, chat: async request => {
      calls.push({ provider: cfg.id, request });
      if (stalled) await new Promise<void>(resolve => { release = resolve; });
      return { content: `${cfg.id}:${request.model}`, toolCalls: [], usage: { inputTokens: 2, outputTokens: 1 }, finishReason: 'stop' };
    } };
  });
  const input = { name: 'alpha', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'key-secret', models: ['a', 'b', 'broken'] };
  async function call(route: string, method = 'GET', body?: unknown, origin?: string) {
    return fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  async function create() {
    const response = await call('/api/sessions', 'POST', { workspaceRoot: dir, provider: 'alpha', model: 'a', permission: 'read-only' });
    expect(response.status).toBe(201);
    return (await response.json() as { session: { id: string } }).session.id;
  }
  beforeEach(async () => {
    calls.length = 0; stalled = false; release = undefined; builder.mockClear();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-model-hub-'));
    const secrets = new Map<string, string>();
    store = new ProviderStore({ rootDir: path.join(dir, 'providers'), credentialStore: { backend: 'memory', setSync: (s, a, key) => { secrets.set(`${s}/${a}`, key); }, getSync: (s, a) => secrets.get(`${s}/${a}`) ?? null, deleteSync: (s, a) => { secrets.delete(`${s}/${a}`); } } });
    registry = new SessionRegistry({ vesselHome: dir });
    server = await createVesselServer({ port: 0, providerStore: store, providerBuilder: builder, projectRegistry: new ProjectRegistry({ vesselHome: dir }), sessionRegistry: registry }).listen();
    base = `http://127.0.0.1:${server.port}`;
    await call('/api/providers', 'POST', input);
    await call('/api/providers', 'POST', { ...input, name: 'beta', models: ['c'] });
  });
  // Written exception: only this test's own os.tmpdir directory is removed after server closure.
  afterEach(async () => { release?.(); await server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  it('switches outgoing provider/model while keeping history, policy and open SSE', async () => {
    const id = await create();
    const stream = await fetch(`${base}/api/sessions/${id}/events`);
    const reader = stream.body!.getReader(); await reader.read();
    try {
      expect(await (await call(`/api/sessions/${id}/turns`, 'POST', { prompt: 'first turn' })).json()).toMatchObject({ finalText: 'alpha:a' });
      const switched = await call(`/api/sessions/${id}/model`, 'PATCH', { provider: 'beta', model: 'c' });
      expect(await switched.json()).toMatchObject({ session: { id, model: 'c', provider: 'beta', permission: 'read-only' } });
      expect(registry.get(id)).toMatchObject({ provider: 'beta', model: 'c', permission: 'read-only' });
      expect(await (await call(`/api/sessions/${id}/turns`, 'POST', { prompt: 'second turn' })).json()).toMatchObject({ finalText: 'beta:c' });
      expect(calls.map(call => [call.provider, call.request.model])).toEqual([['alpha', 'a'], ['beta', 'c']]);
      const history = calls[1]!.request.messages.map(message => message.content).join('\n');
      expect(history).toContain('first turn'); expect(history).toContain('alpha:a');
      expect(calls[1]!.request.maxTokens).toBe(4096);
      let received = ''; for (let i = 0; i < 8 && !received.includes('beta:c'); i++) received += new TextDecoder().decode((await reader.read()).value);
      expect(received).toContain('beta:c');
      const audit = fs.readFileSync(path.join(dir, '.harness', 'sessions', id, 'model-delegations.jsonl'), 'utf8');
      expect(audit).toContain('"provider":"beta","model":"c"'); expect(audit).not.toContain('key-secret'); expect(audit).not.toContain('first turn');
      const records = fs.readFileSync(path.join(dir, '.harness', 'sessions', id, 'session.jsonl'), 'utf8');
      expect(records).toContain('first turn'); expect(records).toContain('second turn');
    } finally { await reader.cancel(); }
  });
  it.each([null, [], {}, { provider: 'alpha' }, { provider: 2, model: 'b' }, { provider: 'alpha', model: 'missing' }, { provider: 'missing', model: 'b' }, { provider: 'alpha', model: 'broken' }])('rejects invalid/failed selection %j and preserves current model', async body => {
    const id = await create();
    const response = await call(`/api/sessions/${id}/model`, 'PATCH', body);
    expect(response.status).toBe(400); expect(await response.text()).not.toContain('key-secret');
    expect(await (await call(`/api/sessions/${id}`)).json()).toMatchObject({ session: { provider: 'alpha', model: 'a' } });
    expect(registry.get(id)?.model).toBe('a');
  });
  it('rejects busy turns and permits switching after the active turn finishes', async () => {
    const id = await create(); stalled = true;
    const turn = call(`/api/sessions/${id}/turns`, 'POST', { prompt: 'blocked transport' });
    await vi.waitFor(() => expect(release).toBeDefined());
    expect((await call(`/api/sessions/${id}/model`, 'PATCH', { provider: 'alpha', model: 'b' })).status).toBe(409);
    stalled = false; release!(); await turn;
    expect((await call(`/api/sessions/${id}/model`, 'PATCH', { provider: 'alpha', model: 'b' })).status).toBe(200);
  });
  it('rejects switching while the session has an executing team stage', async () => {
    const id = await create();
    const list = vi.spyOn(TeamStageRoutes.prototype, 'list').mockReturnValue([{ status: 'running', sessionId: id } as NonNullable<ReturnType<TeamStageRoutes['list']>[number]>]);
    try {
      expect((await call(`/api/sessions/${id}/model`, 'PATCH', { provider: 'alpha', model: 'b' })).status).toBe(409);
      expect(registry.get(id)?.model).toBe('a');
    } finally { list.mockRestore(); }
  });
  it('rolls back registry write failure before changing transport', async () => {
    const id = await create(); const put = registry.put.bind(registry); let fail = true;
    vi.spyOn(registry, 'put').mockImplementation(meta => { const result = put(meta); if (fail) { fail = false; throw new Error('disk failure'); } return result; });
    expect((await call(`/api/sessions/${id}/model`, 'PATCH', { provider: 'alpha', model: 'b' })).status).toBe(400);
    expect(registry.get(id)?.model).toBe('a');
    expect(await (await call(`/api/sessions/${id}/turns`, 'POST', { prompt: 'still original' })).json()).toMatchObject({ finalText: 'alpha:a' });
  });
  it('rejects hostile matching Host/Origin and permits loopback origin', async () => {
    const id = await create();
    const hostile = (route: string, method: string, body?: unknown) => new Promise<number>(resolve => {
      const req = http.request(base + route, { method, headers: { Host: 'attacker.example', Origin: 'http://attacker.example', 'Content-Type': 'application/json' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode!)); });
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    for (const [route, method, body] of [['/api/providers', 'GET'], ['/api/providers', 'POST', input], ['/api/providers/alpha', 'DELETE'], ['/api/models', 'GET'], ['/api/sessions', 'POST', { workspaceRoot: dir, provider: 'alpha', model: 'a' }], [`/api/sessions/${id}/model`, 'PATCH', { provider: 'alpha', model: 'b' }]] as [string, string, unknown?][]) expect(await hostile(route, method, body)).toBe(403);
    expect((await call(`/api/sessions/${id}/model`, 'PATCH', { provider: 'alpha', model: 'b' }, 'https://evil.example')).status).toBe(403);
    expect((await call(`/api/sessions/${id}/model`, 'PATCH', { provider: 'alpha', model: 'b' }, base)).status).toBe(200);
  });
  it('audits and delegates compaction/streaming with cancellation intact', async () => {
    const streamed: ChatRequest[] = [];
    const target: ChatProvider = { id: 'actual', chat: builder({ id: 'actual', model: 'c' }).chat, async *stream(request) { streamed.push(request); yield { type: 'text_delta', text: 'streamed' }; } };
    const hub = new SessionModelHub({ provider: 'beta', model: 'c' }, target); hub.attach(dir);
    const controller = new AbortController(); const request: ChatRequest = { model: hub.id, messages: [], requestKind: 'compaction-summary', signal: controller.signal };
    await hub.chat(request); expect(calls[0]!.request).toMatchObject({ model: 'c', requestKind: 'compaction-summary', signal: controller.signal });
    for await (const chunk of hub.stream({ ...request, requestKind: 'main' })) expect(chunk).toEqual({ type: 'text_delta', text: 'streamed' });
    expect(streamed[0]!.model).toBe('c');
    expect(fs.readFileSync(path.join(dir, 'model-delegations.jsonl'), 'utf8')).toContain('compaction-summary');
  });
});
