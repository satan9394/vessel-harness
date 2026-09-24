import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeOpenAIModelsUrl, probeOpenAIModels } from './probeOpenAIModels.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeOpenAIModelsUrl', () => {
  it('adds /v1/models to a host root and only /models to a versioned root', () => {
    expect(normalizeOpenAIModelsUrl('https://example.test')).toBe('https://example.test/v1/models');
    expect(normalizeOpenAIModelsUrl('https://example.test/')).toBe('https://example.test/v1/models');
    expect(normalizeOpenAIModelsUrl('https://example.test/v1/')).toBe('https://example.test/v1/models');
    expect(normalizeOpenAIModelsUrl('https://example.test/api/v1/models/')).toBe('https://example.test/api/v1/models');
  });

  it('rejects invalid or credential-bearing URLs', () => {
    expect(normalizeOpenAIModelsUrl('')).toBeNull();
    expect(normalizeOpenAIModelsUrl('not a url')).toBeNull();
    expect(normalizeOpenAIModelsUrl('ftp://example.test/v1')).toBeNull();
    expect(normalizeOpenAIModelsUrl('https://user:password@example.test/v1')).toBeNull();
  });
});

describe('probeOpenAIModels', () => {
  it('parses the standard OpenAI list and sends the optional bearer key', async () => {
    let requestedUrl = '';
    let requestedHeaders: Headers | Record<string, string> | undefined;
    const fetchFn: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = init?.headers as Headers | Record<string, string> | undefined;
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'gpt-4o', owned_by: 'openai', context_window: 128000 },
            { id: 'deepseek-reasoner', owned_by: 'deepseek' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const result = await probeOpenAIModels({ baseUrl: 'https://example.test/v1/', apiKey: 'secret-key', fetchFn });

    expect(requestedUrl).toBe('https://example.test/v1/models');
    expect(requestedHeaders).toMatchObject({ Accept: 'application/json', Authorization: 'Bearer secret-key' });
    expect(result).toEqual({
      ok: true,
      models: [
        { id: 'gpt-4o', contextWindow: 128000, supportsReasoning: false, ownedBy: 'openai' },
        { id: 'deepseek-reasoner', supportsReasoning: true, ownedBy: 'deepseek' },
      ],
    });
  });

  it('accepts a local provider bare array and identifies reasoning model names', async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify([
          { id: 'deepseek-ai/DeepSeek-R1' },
          { id: 'openai/o1-mini' },
          { id: 'openai/o3-mini' },
          { id: 'qwen-qwq-32b' },
          { id: 'qwen3-thinking' },
          { id: 'qwen3:latest' },
        ]),
      );

    const result = await probeOpenAIModels({ baseUrl: 'http://127.0.0.1:11434', fetchFn });

    expect(result.ok).toBe(true);
    expect(result.models.map((model) => [model.id, model.supportsReasoning])).toEqual([
      ['deepseek-ai/DeepSeek-R1', true],
      ['openai/o1-mini', true],
      ['openai/o3-mini', true],
      ['qwen-qwq-32b', true],
      ['qwen3-thinking', true],
      ['qwen3:latest', false],
    ]);
  });

  it('returns AUTH_FAILED without reflecting the API key', async () => {
    const apiKey = 'super-secret-token';
    const fetchFn: typeof fetch = async () => new Response('unauthorized', { status: 401 });

    const result = await probeOpenAIModels({ baseUrl: 'https://example.test/v1', apiKey, fetchFn });

    expect(result).toEqual({
      ok: false,
      models: [],
      error: { code: 'AUTH_FAILED', message: 'Model discovery authentication failed.', status: 401 },
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it('omits model metadata that reflects the supplied API key', async () => {
    const apiKey = 'super-secret-token';
    const fetchFn: typeof fetch = async () =>
      new Response(JSON.stringify({ data: [
        { id: 'safe-model', owned_by: 'safe-provider' },
        { id: `model-${apiKey}` },
        { id: 'another-model', owned_by: apiKey },
      ] }));

    const result = await probeOpenAIModels({ baseUrl: 'https://example.test/v1', apiKey, fetchFn });
    expect(result).toEqual({ ok: true, models: [{ id: 'safe-model', supportsReasoning: false, ownedBy: 'safe-provider' }] });
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it('maps timeout and network failures to safe results', async () => {
    const timeoutFetch: typeof fetch = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('transport should not be exposed');
          error.name = 'AbortError';
          reject(error);
        });
      });

    await expect(probeOpenAIModels({ baseUrl: 'https://example.test/v1', timeoutMs: 1, fetchFn: timeoutFetch })).resolves.toEqual({
      ok: false,
      models: [],
      error: { code: 'TIMEOUT', message: 'Model discovery request timed out.' },
    });

    const networkFetch: typeof fetch = async () => {
      throw new Error('network detail containing secret-key');
    };
    const result = await probeOpenAIModels({ baseUrl: 'https://example.test/v1', apiKey: 'secret-key', fetchFn: networkFetch });
    expect(result).toEqual({ ok: false, models: [], error: { code: 'NETWORK_ERROR', message: 'Unable to reach model endpoint.' } });
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('enforces its timeout when an injected fetch implementation ignores AbortSignal', async () => {
    const ignoresAbort: typeof fetch = async () => await new Promise<Response>(() => {});
    await expect(
      probeOpenAIModels({ baseUrl: 'https://example.test/v1', timeoutMs: 5, fetchFn: ignoresAbort }),
    ).resolves.toEqual({
      ok: false,
      models: [],
      error: { code: 'TIMEOUT', message: 'Model discovery request timed out.' },
    });
  });

  it('returns INVALID_RESPONSE for malformed JSON and malformed payloads', async () => {
    const malformedJson: typeof fetch = async () => new Response('{not-json', { status: 200 });
    await expect(probeOpenAIModels({ baseUrl: 'https://example.test/v1', fetchFn: malformedJson })).resolves.toEqual({
      ok: false,
      models: [],
      error: { code: 'INVALID_RESPONSE', message: 'Model endpoint returned an invalid response.', status: 200 },
    });

    const malformedShape: typeof fetch = async () => new Response(JSON.stringify({ object: 'list', data: 'not-an-array' }), { status: 200 });
    await expect(probeOpenAIModels({ baseUrl: 'https://example.test/v1', fetchFn: malformedShape })).resolves.toEqual({
      ok: false,
      models: [],
      error: { code: 'INVALID_RESPONSE', message: 'Model endpoint returned an invalid response.', status: 200 },
    });
  });

  it('never throws for invalid input or a throwing fetch implementation', async () => {
    await expect(probeOpenAIModels({ baseUrl: 'not-a-url' })).resolves.toMatchObject({ ok: false, models: [] });
    await expect(
      probeOpenAIModels({
        baseUrl: 'https://example.test/v1',
        fetchFn: vi.fn(() => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ ok: false, models: [], error: { code: 'NETWORK_ERROR', message: 'Unable to reach model endpoint.' } });
  });
});
