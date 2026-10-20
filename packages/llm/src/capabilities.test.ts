import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilitiesFor, CapabilityMismatchError, discoverProviderCapabilities, negotiateCapabilities } from './capabilities.js';
import { createProvider } from './provider/createProvider.js';

const tool = { type: 'function' as const, function: { name: 'read', description: '', parameters: {} } };
afterEach(() => vi.unstubAllGlobals());
describe('ARC-08 capability negotiation', () => {
  it('does not infer endpoint capability from a reasoning model name', () => {
    expect(discoverProviderCapabilities({ id: 'deepseek-r1' }).reasoning).toEqual({ status: 'unknown' });
    expect(discoverProviderCapabilities({ context_window: 8192, supports_reasoning: false }).reasoning).toMatchObject({ status: 'declared', value: false });
  });
  it('seeds adapter defaults when protocol is provided and allows metadata to override', () => {
    const oai = discoverProviderCapabilities({ id: 'deepseek/deepseek-v4.1-flash', context_length: 1000000 }, 'openai-compatible');
    expect(oai.tools).toMatchObject({ status: 'declared', value: true });
    expect(oai.streaming).toMatchObject({ status: 'declared', value: true });
    expect(oai.contextWindow).toMatchObject({ status: 'declared', value: 1000000 });

    const ant = discoverProviderCapabilities({ id: 'claude-3-7-sonnet', supports_tools: true }, 'anthropic');
    expect(ant.tools).toMatchObject({ status: 'declared', value: true });

    const restricted = discoverProviderCapabilities({ id: 'deepseek-reasoner', supports_tools: false }, 'openai-compatible');
    expect(restricted.tools).toMatchObject({ status: 'declared', value: false });
  });
  it('requires evidence for mandatory unknown capabilities and checks context size', () => {
    const capabilities = capabilitiesFor('unknown');
    expect(() => negotiateCapabilities('custom', 'm', capabilities, { tools: true })).toThrow(CapabilityMismatchError);
    capabilities.contextWindow = { status: 'detected', value: 8192 };
    expect(() => negotiateCapabilities('custom', 'm', capabilities, { contextWindow: 16384 })).toThrow(CapabilityMismatchError);
    expect(() => negotiateCapabilities('custom', 'm', capabilities, { contextWindow: 8192 })).not.toThrow();
  });
  it.each(['openai-compatible', 'anthropic', 'opencode-go'])('blocks %s tool and reasoning mismatch before dispatch', async protocol => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const provider = createProvider(protocol, { model: 'm', baseUrl: 'https://example.invalid/v1', capabilities: { tools: { status: 'detected', value: false }, reasoning: { status: 'unknown' } } });
    await expect(provider.chat({ model: 'm', messages: [], tools: [tool] })).rejects.toMatchObject({ name: 'CapabilityMismatchError', capability: 'tools' });
    await expect(provider.chat({ model: 'm', messages: [], reasoningEffort: 'high' })).rejects.toMatchObject({ name: 'CapabilityMismatchError', capability: 'reasoning' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('blocks stream and model-specific declarations without falling back to another model', async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    const provider = createProvider('openai-compatible', { model: 'a', baseUrl: 'https://example.invalid', modelCapabilities: { b: capabilitiesFor('unknown') } });
    await expect(provider.chat({ model: 'b', messages: [], tools: [tool] })).rejects.toBeInstanceOf(CapabilityMismatchError);
    const stream = provider.stream!({ model: 'b', messages: [] });
    await expect((async () => { for await (const _chunk of stream) { /* drain */ } })()).rejects.toMatchObject({ capability: 'streaming' });
    expect(fetchSpy).not.toHaveBeenCalled();
    const defaulted = createProvider('openai-compatible', { model: 'b', baseUrl: 'https://example.invalid', modelCapabilities: { b: capabilitiesFor('unknown') } });
    await expect(defaulted.chat({ model: '', messages: [], tools: [tool] })).rejects.toMatchObject({ model: 'b', capability: 'tools' });
  });
  it.each([
    ['tools', true], ['tools', false],
    ['reasoning', true], ['reasoning', false],
    ['streaming', true], ['streaming', false],
  ] as const)('preserves explicit %s=false with conflicting request (support=%s)', async (capability, supported) => {
    const fetchSpy = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const streaming = JSON.parse(String(init?.body)).stream === true;
      return new Response(streaming ? 'data: [DONE]\n\n' : JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const provider = createProvider('openai-compatible', {
      model: 'm', baseUrl: 'https://example.invalid',
      capabilities: { [capability]: { status: 'detected', value: supported } },
    });
    const request = {
      model: 'm', messages: [], requiredCapabilities: { [capability]: false },
      ...(capability === 'tools' ? { tools: [tool] } : {}),
      ...(capability === 'reasoning' ? { reasoningEffort: 'high' as const } : {}),
    };
    const attempt = capability === 'streaming'
      ? (async () => { for await (const _chunk of provider.stream!(request)) { /* drain */ } })()
      : provider.chat(request);
    await expect(attempt).rejects.toMatchObject({ name: 'CapabilityMismatchError', capability });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects unsupported structured output rather than silently dropping it', async () => {
    const provider = createProvider('mock', { model: 'm', capabilities: { jsonSchema: { status: 'declared', value: true } } });
    await expect(provider.chat({ model: 'm', messages: [], requiredCapabilities: { jsonSchema: true } })).rejects.toMatchObject({ capability: 'jsonSchema' });
  });
});
