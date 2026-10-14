import { afterEach, expect, it, vi } from 'vitest';
import { capabilitiesFor } from '@vessel/llm';
import { buildRealProvider, planProvider } from './providerFactory.js';

const tool = { type: 'function' as const, function: { name: 'read', description: '', parameters: {} } };
afterEach(() => vi.unstubAllGlobals());
it.each(['false', 'unknown'] as const)('CLI stored %s capabilities reach chat and stream without dispatch', async status => {
  const capabilities = capabilitiesFor('openai-compatible');
  capabilities.tools = status === 'false' ? { status: 'declared', value: false } : { status: 'unknown' };
  capabilities.streaming = status === 'false' ? { status: 'declared', value: false } : { status: 'unknown' };
  const config = { id: 'local', protocol: 'openai-compatible', baseUrl: 'https://example.invalid/v1', model: 'm', modelCapabilities: { m: capabilities } };
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })));
  vi.stubGlobal('fetch', fetchSpy);
  const provider = buildRealProvider(planProvider({ config }))!;
  await expect(provider.chat({ model: 'm', messages: [], tools: [tool] })).rejects.toMatchObject({ name: 'CapabilityMismatchError', capability: 'tools' });
  await expect((async () => { for await (const _chunk of provider.stream!({ model: 'm', messages: [] })) { /* drain */ } })()).rejects.toMatchObject({ name: 'CapabilityMismatchError', capability: 'streaming' });
  expect(fetchSpy).not.toHaveBeenCalled();
});
it('keeps model metadata on the same endpoint and discards it on an endpoint override', () => {
  const config = { id: 'local', protocol: 'openai-compatible', baseUrl: 'https://example.invalid/v1', model: 'm', modelCapabilities: { m: capabilitiesFor('unknown') } };
  expect(planProvider({ config, baseUrl: config.baseUrl, model: 'other-model' })).toMatchObject({ modelCapabilities: config.modelCapabilities });
  expect(planProvider({ config, baseUrl: 'https://other.invalid/v1' })).not.toHaveProperty('modelCapabilities');
  expect(planProvider({ explicitProvider: 'anthropic', baseUrl: config.baseUrl })).not.toHaveProperty('modelCapabilities');
});
