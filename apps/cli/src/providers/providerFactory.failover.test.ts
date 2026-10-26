import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { EndpointFailoverProvider, OpenAICompatibleProvider, capabilitiesFor } from '@vessel/llm';
import { buildRealProvider, planProvider } from './providerFactory.js';

const config = { id: 'local', protocol: 'openai-compatible', model: 'm', baseUrl: 'https://a.invalid/v1/', endpoints: [{ url: 'https://b.invalid/v1' }, { url: 'https://a.invalid/v1' }, { url: 'https://b.invalid/v1/' }, { url: 'https://c.invalid/v1' }] };
const request = { model: 'm', messages: [] };
const completion = { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('puts actual baseUrl first, deduplicates trailing slashes, and keeps explicit provider candidates', () => {
  expect(planProvider({ config, explicitProvider: 'openai-compatible' }).endpoints).toEqual([config.baseUrl, 'https://b.invalid/v1', 'https://c.invalid/v1']);
});

it.each(['', ' ', 'https://override.invalid', config.baseUrl])('explicit baseUrl %j suppresses candidates', baseUrl => {
  const plan = planProvider({ config, baseUrl });
  expect(plan).not.toHaveProperty('endpoints');
  expect(plan.baseUrl).toBe(baseUrl);
});

it('blank env presence suppresses candidates without changing the resolved URL', () => {
  const plan = planProvider({ config, baseUrlExplicit: true });
  expect(plan).not.toHaveProperty('endpoints');
  expect(plan.baseUrl).toBe(config.baseUrl);
});

it.each([undefined, [], [{ url: config.baseUrl }, { url: config.baseUrl.replace(/\/+$/, '') }]])('single distinct endpoint returns the concrete provider: %j', endpoints => {
  const plan = planProvider({ config: { ...config, endpoints } });
  expect(plan).not.toHaveProperty('endpoints');
  expect(buildRealProvider(plan)).toBeInstanceOf(OpenAICompatibleProvider);
});

it('does not substitute a candidate for a missing baseUrl', () => {
  expect(() => buildRealProvider(planProvider({ config: { ...config, baseUrl: undefined } }))).toThrow(/需要 base-url/);
});

it.each(['openai-compatible', 'anthropic'])('real %s HTTP failure reaches the backup and sticks', async protocol => {
  const success = protocol === 'anthropic'
    ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
    : completion;
  const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('unavailable', { status: 503 })).mockImplementation(async () => new Response(JSON.stringify(success)));
  vi.stubGlobal('fetch', fetchSpy);
  const switched = vi.fn();
  const provider = buildRealProvider(planProvider({ config: { ...config, protocol } }), { onEndpointSwitch: switched })!;
  expect(provider).toBeInstanceOf(EndpointFailoverProvider);
  expect((await provider.chat(request)).content).toBe('ok');
  await provider.chat(request);
  expect(fetchSpy.mock.calls.map(args => args[0])).toEqual([
    `${config.baseUrl.replace(/\/+$/, '')}/${protocol === 'anthropic' ? 'v1/messages' : 'chat/completions'}`,
    `https://b.invalid/v1/${protocol === 'anthropic' ? 'v1/messages' : 'chat/completions'}`,
    `https://b.invalid/v1/${protocol === 'anthropic' ? 'v1/messages' : 'chat/completions'}`,
  ]);
  expect(switched.mock.calls).toEqual([[config.baseUrl, 'https://b.invalid/v1']]);
});

it('opencode-go switches once per endpoint with one session header and no default notice', async () => {
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 503 })).mockImplementation(async () => new Response(JSON.stringify(completion)));
  vi.stubGlobal('fetch', fetchSpy);
  const provider = buildRealProvider(planProvider({ config: { ...config, id: 'opencode-go' } }))!;
  expect((await provider.chat(request)).content).toBe('ok');
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  const headers = fetchSpy.mock.calls.map(args => args[1].headers as Record<string, string>);
  expect(headers[0]!['x-opencode-session']).toBeTruthy();
  expect(headers[1]!['x-opencode-session']).toBe(headers[0]!['x-opencode-session']);
  expect(stderr).not.toHaveBeenCalled();
});

it.each(['openai-compatible', 'anthropic'])('real %s stream handshake can fail over before its first chunk', async protocol => {
  const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 429 })).mockImplementation(async () => new Response(protocol === 'anthropic'
    ? 'event: message_start\ndata: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":1}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
    : 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
  vi.stubGlobal('fetch', fetchSpy);
  const provider = buildRealProvider(planProvider({ config: { ...config, protocol } }))!;
  const chunks = [];
  for await (const chunk of provider.stream!(request)) chunks.push(chunk);
  expect(chunks.length).toBeGreaterThan(0);
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

it('multi-endpoint capabilities still reject unsupported requests before any fetch', async () => {
  const capabilities = capabilitiesFor('openai-compatible');
  capabilities.streaming = { status: 'declared', value: false };
  capabilities.tools = { status: 'declared', value: false };
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  const provider = buildRealProvider(planProvider({ config: { ...config, modelCapabilities: { m: capabilities } } }))!;
  expect(provider.capabilities).toEqual(capabilities);
  await expect(provider.chat({ ...request, tools: [{ type: 'function', function: { name: 't', description: '', parameters: {} } }] })).rejects.toMatchObject({ name: 'CapabilityMismatchError' });
  await expect((async () => { for await (const _chunk of provider.stream!(request)) { /* drain */ } })()).rejects.toMatchObject({ name: 'CapabilityMismatchError' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

it.each(['openai-compatible', 'opencode-go'])('real Node fetch ECONNREFUSED fails over for %s', async id => {
  const closed = createServer();
  await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
  const deadUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/v1`;
  await new Promise<void>(resolve => closed.close(() => resolve()));
  const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(completion)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const provider = buildRealProvider(planProvider({ config: { ...config, id, baseUrl: deadUrl, endpoints: [{ url }] } }))!;
    expect((await provider.chat(request)).content).toBe('ok');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('CLI wires overrides and notices in all three entry points while TUI stays silent', () => {
  const cli = readFileSync(new URL('../cli.ts', import.meta.url), 'utf8');
  const tui = readFileSync(new URL('../tui/chat.ts', import.meta.url), 'utf8');
  expect(cli.match(/baseUrlExplicit: flags.has\('base-url'\) \|\| process.env\['VESSEL_BASE_URL'\] !== undefined/g)).toHaveLength(3);
  expect(cli.match(/onEndpointSwitch: cliEndpointSwitch\(flags\)/g)).toHaveLength(3);
  expect(tui).not.toContain('onEndpointSwitch');
});
