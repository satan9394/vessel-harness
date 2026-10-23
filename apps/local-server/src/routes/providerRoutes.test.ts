import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectRegistry, SessionRegistry } from '@vessel/application';
import { MockProvider, capabilitiesFor } from '@vessel/llm';
import { ProviderStore } from '../providers/ProviderStore.js';
import { createVesselServer, type VesselServer } from '../server.js';
import { ProviderRoutes, normalizeProviderInput } from './providerRoutes.js';

describe('provider HTTP routes', () => {
  let dir: string;
  let store: ProviderStore;
  let server: VesselServer;
  let base: string;
  const probe = vi.fn<typeof fetch>();
  const builder = vi.fn((cfg: { model: string }) => new MockProvider([{ when: /.*/, response: { text: `actual:${cfg.model}` } }], { model: cfg.model }));
  const input = { name: 'deepseek', protocol: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'test-secret-1234', models: ['deepseek-chat', 'deepseek-reasoner'] };
  async function call(route: string, method = 'GET', body?: unknown, origin?: string) {
    return fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  beforeEach(async () => {
    vi.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-provider-routes-'));
    const secrets = new Map<string, string>();
    store = new ProviderStore({ rootDir: path.join(dir, 'providers'), credentialStore: { backend: 'memory', setSync: (s, a, key) => { secrets.set(`${s}/${a}`, key); }, getSync: (s, a) => secrets.get(`${s}/${a}`) ?? null, deleteSync: (s, a) => { secrets.delete(`${s}/${a}`); } } });
    server = await createVesselServer({ port: 0, providerStore: store, providerFetch: probe, providerBuilder: builder, projectRegistry: new ProjectRegistry({ vesselHome: dir }), sessionRegistry: new SessionRegistry({ vesselHome: dir }) }).listen();
    base = `http://127.0.0.1:${server.port}`;
  });
  afterEach(async () => { await server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  it('keeps Mock built in and rejects configurable Mock protocol without network probing', async () => {
    expect(normalizeProviderInput(input).protocol).toBe('openai-compatible');
    expect(normalizeProviderInput({ ...input, protocol: 'anthropic' }).protocol).toBe('anthropic');
    const rejected = await call('/api/providers', 'POST', { ...input, name: 'offline', protocol: 'mock' });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: 'invalid_protocol' });
    expect(store.get('mock')).toMatchObject({ id: 'mock', protocol: 'mock', model: 'mock' });
    expect(probe).not.toHaveBeenCalled();
  });
  it('shares explicit model capabilities between registry and dispatch, preserving unknown and clearing stale endpoint metadata', async () => {
    await call('/api/providers', 'POST', { ...input, models: { 'deepseek-chat': { capabilities: { tools: false, context_window: 64000 } }, 'deepseek-reasoner': {} } });
    const catalog = await (await call('/api/models')).json() as { models: Array<{ id: string; capabilities: unknown }> };
    expect(catalog.models.find(model => model.id === 'deepseek-chat')?.capabilities).toMatchObject({ tools: { status: 'declared', value: false }, contextWindow: { status: 'declared', value: 64000 }, promptCache: { status: 'unknown' } });
    await call('/api/sessions', 'POST', { workspaceRoot: dir, provider: input.name, model: 'deepseek-chat' });
    expect(builder).toHaveBeenLastCalledWith(expect.objectContaining({ modelCapabilities: expect.objectContaining({ 'deepseek-chat': expect.objectContaining({ tools: { status: 'declared', value: false, source: 'model metadata' } }) }) }));
    const providers = await (await call('/api/providers')).text();
    expect(providers).toContain('modelCapabilities'); expect(providers).not.toContain(input.apiKey);
    expect((await call('/api/providers', 'POST', { ...input, models: ['deepseek-chat'] })).status).toBe(201);
    expect(Object.keys(store.get(input.name)!.modelCapabilities!)).toEqual(['deepseek-chat']);
    await call('/api/providers', 'POST', { ...input, baseUrl: 'https://different.example/v1' });
    expect(store.get(input.name)?.modelCapabilities).toBeUndefined();
  });
  it('does not certify client supplied detection and strips arbitrary metadata', async () => {
    await call('/api/providers', 'POST', { ...input, modelCapabilities: { 'deepseek-chat': { tools: { status: 'detected', value: false, source: 'private credential' } } } });
    const response = await (await call('/api/models')).text();
    expect(response).toContain('declared'); expect(response).not.toContain('detected'); expect(response).not.toContain('private credential');
  });
  it('uses the dispatch adapter identity for variant-provider capabilities', async () => {
    await call('/api/providers', 'POST', { ...input, name: 'opencode-go' });
    const response = await (await call('/api/models')).json() as { models: Array<{ providerName: string; capabilities: unknown }> };
    expect(response.models.find(model => model.providerName === 'opencode-go')?.capabilities).toMatchObject({ streaming: { status: 'declared', value: false }, toolCallStreaming: { status: 'declared', value: false } });
  });
  it('creates, masks, lists, updates and removes credential-backed configurations', async () => {
    const created = await call('/api/providers', 'POST', input);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ provider: { apiKeyMasked: '****1234', models: input.models } });
    expect(fs.readFileSync(store.providersFile, 'utf8')).not.toContain(input.apiKey);
    expect(await (await call('/api/providers')).json()).toMatchObject({ providers: [{ name: 'deepseek', protocol: input.protocol }] });
    expect((await call('/api/providers', 'POST', { ...input, apiKey: 'abc' })).status).toBe(201);
    expect(store.get('deepseek')?.apiKey).toBe('abc');
    const listed = await (await call('/api/providers')).text();
    expect(listed).toContain('****'); expect(listed).not.toContain('abc'); expect(listed).not.toContain('secretRef');
    expect(await (await call('/api/models')).json()).toMatchObject({ models: [{ id: 'mock', providerName: 'mock' }, { id: 'deepseek-chat', providerName: 'deepseek' }, { id: 'deepseek-reasoner' }] });
    store.setCurrent('deepseek');
    expect(await (await call('/api/providers/deepseek', 'DELETE')).json()).toEqual({ ok: true });
    expect(store.getCurrent()).toBe('mock');
    expect((await call('/api/providers/deepseek', 'DELETE')).status).toBe(404);
    expect((await call('/api/providers/mock', 'DELETE')).status).toBe(400);
  });
  it.each([{ name: 'mock' }, { name: '../bad' }, { models: [] }, { models: [4] }, { protocol: 'bad' }, { baseUrl: 'file:///tmp' }, { baseUrl: 'https://key:secret@example.com' }, { baseUrl: 'https://example.com?key=secret' }, { apiKey: '' }, { apiKey: 'key\nheader' }])('rejects invalid inputs %j without leaking credentials', async patch => {
    const res = await call('/api/providers', 'POST', { ...input, ...patch });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(input.apiKey);
    expect(store.load()).toEqual([]);
  });
  it('denies cross-origin credential operations and real session creation', async () => {
    expect((await call('/api/providers', 'POST', input, 'https://evil.example')).status).toBe(403);
    expect((await call('/api/providers', 'GET', undefined, 'https://evil.example')).status).toBe(403);
    expect((await call('/api/sessions', 'POST', { workspaceRoot: dir, provider: 'deepseek' }, 'https://evil.example')).status).toBe(403);
    expect((await call('/api/providers', 'POST', input, base)).status).toBe(201);
  });
  it('uses authenticated bounded probes for both protocols and validates discovered models', async () => {
    probe.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 }));
    expect(await (await call('/api/providers/test', 'POST', input)).json()).toMatchObject({ ok: true, availableModels: ['m1'], modelCapabilities: { m1: expect.objectContaining({ tools: expect.objectContaining({ status: 'declared', value: true }) }) }, latencyMs: expect.any(Number) });
    expect(probe).toHaveBeenLastCalledWith('https://api.deepseek.com/v1/models', expect.objectContaining({ headers: { Authorization: `Bearer ${input.apiKey}` }, redirect: 'error', signal: expect.any(AbortSignal) }));
    await call('/api/providers/test', 'POST', { ...input, protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' });
    expect(probe).toHaveBeenLastCalledWith('https://api.anthropic.com/v1/models', expect.objectContaining({ headers: { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' } }));
    probe.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 9 }] })));
    expect(await (await call('/api/providers/test', 'POST', input)).json()).toEqual({ ok: false, error: 'invalid_models_response' });
  });
  it('reports auth and transport failures without upstream bodies or keys', async () => {
    probe.mockResolvedValue(new Response(input.apiKey, { status: 401 }));
    expect(await (await call('/api/providers/test', 'POST', input)).json()).toEqual({ ok: false, error: 'http_401' });
    probe.mockRejectedValue(new Error(`failed ${input.apiKey}`));
    expect(await (await call('/api/providers/test', 'POST', input)).json()).toEqual({ ok: false, error: 'connection_failed' });
  });
  it('sanitizes corrupt stores and credential-bearing legacy URLs', async () => {
    fs.mkdirSync(store.rootDir, { recursive: true });
    fs.writeFileSync(store.providersFile, input.apiKey);
    const corrupt = await call('/api/providers');
    expect(corrupt.status).toBe(400);
    expect(await corrupt.text()).toBe(JSON.stringify({ error: 'provider_store_corrupted' }));
    fs.writeFileSync(store.providersFile, JSON.stringify([{ ...input, id: input.name, model: input.models[0], baseUrl: `https://example.com?key=${input.apiKey}` }]));
    expect(await (await call('/api/providers')).text()).not.toContain(input.apiKey);
  });
  it('permits keyless loopback Ollama and aborts a stalled probe', async () => {
    expect((await call('/api/providers', 'POST', { ...input, name: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' })).status).toBe(201);
    const stalled = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)); }));
    const result = await new ProviderRoutes(() => store, stalled, 10).test(input);
    expect(result).toEqual({ ok: false, error: 'connection_timeout' });
  });
  it('binds the actual configured provider and chosen model to a session and turn', async () => {
    await call('/api/providers', 'POST', input);
    const created = await call('/api/sessions', 'POST', { workspaceRoot: dir, provider: 'deepseek', model: 'deepseek-reasoner', permission: 'read-only' });
    expect(created.status).toBe(201);
    const { session } = await created.json() as { session: { id: string; provider: string; model: string; permission: string } };
    expect(session).toMatchObject({ provider: 'deepseek', model: 'deepseek-reasoner', permission: 'read-only' });
    expect(builder).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek', apiKey: input.apiKey, model: 'deepseek-reasoner' }));
    const result = await (await call(`/api/sessions/${session.id}/turns`, 'POST', { prompt: 'hello' })).json();
    expect(result).toMatchObject({ finalText: 'actual:deepseek-reasoner', kind: 'success' });
  });
  it.each([{ provider: 'unknown' }, { provider: 'deepseek', model: 'unknown' }, { provider: 4 }, { model: {} }, { permission: 'admin' }, { workspaceRoot: 3 }])('rejects invalid session selection %j', async patch => {
    await call('/api/providers', 'POST', input);
    expect((await call('/api/sessions', 'POST', { workspaceRoot: dir, ...patch })).status).toBe(400);
    expect(builder).not.toHaveBeenCalled();
  });
  it('normalizes AI-SDK / OpenCode nested configs with dictionary models (task 215)', async () => {
    const key = 'y8nqgu5ojwpsebrma4c2ld6zkxv9f7i01th3';
    const workbuddy = {
      name: 'workbuddy',
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: 'http://127.0.0.1:7863/v1', apiKey: key, setCacheKey: false },
      models: {
        'deepseek-v4.1-flash': { name: 'deepseek-v4.1-flash', limit: { context: 1000000, input: 800000, output: 32000 } },
        'hy4-preview': { name: 'hy4-preview' },
        'hy4-preview-f': { name: 'hy4-preview-f' },
        'kimi-k3-1': { name: 'kimi-k3-1' },
      },
    };
    expect(normalizeProviderInput(workbuddy)).toMatchObject({
      name: 'workbuddy', protocol: 'openai-compatible', baseUrl: 'http://127.0.0.1:7863/v1', apiKey: key,
      models: ['deepseek-v4.1-flash', 'hy4-preview', 'hy4-preview-f', 'kimi-k3-1'],
    });
    // npm 声明 anthropic ⇒ anthropic；显式非法 protocol 仍严格拒收（fail loud）
    expect(normalizeProviderInput({ name: 'x', npm: '@ai-sdk/anthropic', options: { baseURL: 'https://api.anthropic.com' }, models: ['c'] }).protocol).toBe('anthropic');
    expect(() => normalizeProviderInput({ name: 'x', protocol: 'bad', baseUrl: 'https://a.com/v1', apiKey: 'k', models: ['m'] })).toThrow('invalid_protocol');
    // 逗号（中英）分隔字符串照旧兼容
    expect(normalizeProviderInput({ name: 'x', baseUrl: 'https://a.com/v1', apiKey: 'k', models: 'a, b，c' }).models).toEqual(['a', 'b', 'c']);
    const created = await call('/api/providers', 'POST', workbuddy);
    expect(created.status).toBe(201);
    const body = await created.json() as { provider: { models: string[]; baseUrl: string; apiKeyMasked: string } };
    expect(body.provider.models).toEqual(['deepseek-v4.1-flash', 'hy4-preview', 'hy4-preview-f', 'kimi-k3-1']);
    expect(body.provider.baseUrl).toBe('http://127.0.0.1:7863/v1');
    expect(body.provider.apiKeyMasked).toBe('****1th3');
    expect(store.get('workbuddy')?.apiKey).toBe(key);
    expect(fs.readFileSync(store.providersFile, 'utf8')).not.toContain(key);
  });
  it('pulls the live model list and reports specific transport failures (task 215)', async () => {
    probe.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm1' }] }), { status: 200 }));
    const pulled = await (await call('/api/providers/pull-models', 'POST', input)).json();
    expect(pulled).toMatchObject({ ok: true, models: ['m1', 'm2'], latencyMs: expect.any(Number) });
    expect(probe).toHaveBeenLastCalledWith('https://api.deepseek.com/v1/models', expect.objectContaining({ headers: { Authorization: `Bearer ${input.apiKey}` } }));
    probe.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    expect(await (await call('/api/providers/pull-models', 'POST', input)).json()).toEqual({ ok: false, error: 'http_401' });
    const rejected = await call('/api/providers/pull-models', 'POST', { ...input, baseUrl: 'file:///tmp' });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'invalid_base_url' });
  });
  it('deletes a secretRef-backed provider, clears its credential and surfaces concrete error codes (task 215)', async () => {
    expect((await call('/api/providers', 'POST', input)).status).toBe(201);
    const persisted = JSON.parse(fs.readFileSync(store.providersFile, 'utf8')) as { id: string; apiKey?: string; secretRef?: string }[];
    expect(persisted[0]).toMatchObject({ id: 'deepseek', secretRef: 'credential:vessel/deepseek' });
    expect(persisted[0]!.apiKey).toBeUndefined();
    const cred = store.credentialStore as unknown as { getSync(s: string, a: string): string | null };
    expect(cred.getSync('vessel', 'deepseek')).toBe(input.apiKey);
    const removed = await call('/api/providers/deepseek', 'DELETE');
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    expect(store.get('deepseek')).toBeUndefined();
    expect(cred.getSync('vessel', 'deepseek')).toBeNull();
    // 具体错误码透传，不再千篇一律 provider_request_failed
    expect(await (await call('/api/providers', 'POST', { ...input, models: [] })).json()).toEqual({ error: 'invalid_models' });
    expect(await (await call('/api/providers/mock', 'DELETE')).json()).toEqual({ error: 'builtin_provider' });
    expect(await (await call('/api/providers/nope', 'DELETE')).json()).toEqual({ error: 'unknown_provider' });
    // 文件损坏 / 条目非法 → 具体且可操作的码，绝不泄露路径或密钥
    fs.writeFileSync(store.providersFile, `{not json ${input.apiKey}`);
    expect(await (await call('/api/providers')).json()).toEqual({ error: 'provider_store_corrupted' });
    expect(await (await call('/api/providers')).text()).not.toContain(input.apiKey);
    fs.writeFileSync(store.providersFile, JSON.stringify([{ id: 'bad', name: 'bad', protocol: 'openai-compatible', baseUrl: 'https://a.example.com/v1', models: ['m'] }]));
    expect(await (await call('/api/providers')).json()).toEqual({ error: 'provider_store_corrupted' });
    // 删除也拿到具体原因（不是通用「操作失败」）
    expect(await (await call('/api/providers/deepseek', 'DELETE')).json()).toEqual({ error: 'provider_store_corrupted' });
  });
  it('heals stale unknown model capabilities on load for openai-compatible providers (task 233)', async () => {
    const rawUnknown = Object.fromEntries(Object.keys(capabilitiesFor('unknown')).map(k => [k, { status: 'unknown' }]));
    const corruptCaps = { 'deepseek-chat': { ...rawUnknown, contextWindow: { status: 'declared', value: 128000, source: 'model metadata' } } };
    fs.mkdirSync(store.rootDir, { recursive: true });
    fs.writeFileSync(store.providersFile, JSON.stringify([{ ...input, id: input.name, model: input.models[0], modelCapabilities: corruptCaps }]));
    const loaded = store.get('deepseek');
    expect(loaded?.modelCapabilities?.['deepseek-chat']?.tools).toMatchObject({ status: 'declared', value: true });
    expect(loaded?.modelCapabilities?.['deepseek-chat']?.contextWindow).toMatchObject({ status: 'declared', value: 128000 });
  });
  it('deletes a pre-existing secretRef-backed provider and tolerates an unresolvable credential (task 215)', async () => {
    const secrets = store.credentialStore as unknown as { setSync(s: string, a: string, key: string): void };
    secrets.setSync('vessel', 'opencode-go', 'go-secret');
    fs.mkdirSync(store.rootDir, { recursive: true });
    const entry = (id: string, protocol: string, baseUrl: string) => [{ id, name: id, protocol, baseUrl, model: 'm1', models: ['m1'], secretRef: `credential:vessel/${id}` }];
    fs.writeFileSync(store.providersFile, JSON.stringify(entry('opencode-go', 'openai-compatible', 'https://go.example.com/v1')));
    expect(await (await call('/api/providers')).json()).toMatchObject({ providers: [{ name: 'opencode-go', apiKeyMasked: '****cret' }] });
    expect(await (await call('/api/providers/opencode-go', 'DELETE')).json()).toEqual({ ok: true });
    expect(store.load()).toEqual([]);
    // 凭据在 store 里查不到（孤儿 secretRef）时也必须能删掉
    fs.writeFileSync(store.providersFile, JSON.stringify(entry('orphan', 'anthropic', 'https://orphan.example.com')));
    expect(await (await call('/api/providers/orphan', 'DELETE')).json()).toEqual({ ok: true });
    expect(store.load()).toEqual([]);
  });
});

