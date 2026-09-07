import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchOpenAIModels, modelsForProtocol, ANTHROPIC_BUILTIN_MODELS } from './modelFetcher.js';

function fakeModelsServer(handler: (req: { url: string; auth?: string }) => { status: number; body: unknown }) {
  const received: { url: string; auth?: string }[] = [];
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    received.push({ url: req.url ?? '', auth });
    const r = handler({ url: req.url ?? '', auth });
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.body));
  });
  return new Promise<{ url: string; received: typeof received; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, received, close: () => server.close() });
    });
  });
}

describe('apps/cli modelFetcher — fetchOpenAIModels (task 015)', () => {
  it('enumerates models from GET {base}/v1/models and sends the bearer key', async () => {
    const fake = await fakeModelsServer(() => ({
      status: 200,
      body: { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { object: 'model', id: 'deepseek-v4' }] },
    }));
    try {
      const src = await fetchOpenAIModels(fake.url, 'sk-test');
      expect(src.origin).toBe('live');
      expect(src.models).toEqual(['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4']);
      expect(src.models.length).toBeGreaterThan(0);
      expect(fake.received[0]?.url).toBe('/v1/models');
      expect(fake.received[0]?.auth).toBe('Bearer sk-test');
    } finally {
      fake.close();
    }
  });

  it('falls back to {base}/models when /v1/models is 404', async () => {
    let hits = 0;
    const fake = await fakeModelsServer(({ url }) => {
      hits += 1;
      if (url === '/v1/models') return { status: 404, body: { error: { message: 'no' } } };
      return { status: 200, body: { data: [{ id: 'model-x' }] } };
    });
    try {
      const src = await fetchOpenAIModels(fake.url);
      expect(src.models).toEqual(['model-x']);
      expect(hits).toBe(2); // tried /v1/models then /models
    } finally {
      fake.close();
    }
  });

  it('throws a clear error when no endpoint works', async () => {
    const fake = await fakeModelsServer(() => ({ status: 500, body: { error: 'boom' } }));
    try {
      await expect(fetchOpenAIModels(fake.url)).rejects.toThrow(/无法拉取/);
    } finally {
      fake.close();
    }
  });

  it('rejects an empty model list as an error', async () => {
    const fake = await fakeModelsServer(() => ({ status: 200, body: { data: [] } }));
    try {
      await expect(fetchOpenAIModels(fake.url)).rejects.toThrow(/返回 no models|无法拉取/);
    } finally {
      fake.close();
    }
  });
});

describe('apps/cli modelFetcher — protocol fallbacks (task 015)', () => {
  it('anthropic falls back to a built-in Claude list, honestly labelled', () => {
    const src = modelsForProtocol('anthropic');
    expect(src.origin).toBe('builtin');
    expect(src.models.length).toBeGreaterThan(0);
    expect(src.models[0]).toContain('claude');
    expect(src.note).toContain('内置清单');
    expect(ANTHROPIC_BUILTIN_MODELS.length).toBeGreaterThan(0);
  });

  it('mock has no models', () => {
    const src = modelsForProtocol('mock');
    expect(src.origin).toBe('none');
    expect(src.models).toEqual([]);
  });
});
