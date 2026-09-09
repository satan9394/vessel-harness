import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  probeEndpoint,
  probeProviderEndpoints,
  probeUrlFor,
  rankProbes,
  suggestEndpoint,
  type EndpointProbeResult,
} from './endpointProbe.js';

/**
 * endpointProbe.test.ts — task 096 端点测速验收测试。
 *
 * fetch 全部注入（不打真网络）；核心断言：结果形状、排序、**只给建议不改配置**、
 * 以及探测请求**不携带任何凭据**。
 */

/** 假 fetch：按 URL 返回状态码或抛错。 */
function fakeFetch(handler: (url: string) => { status: number } | Error): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const r = handler(url);
    if (r instanceof Error) throw r;
    return { status: r.status } as Response;
  }) as unknown as typeof fetch;
}

/** 假时钟：每次调用 +step ms。 */
function fakeClock(start = 0, step = 10): () => number {
  let t = start;
  return () => {
    const v = t;
    t += step;
    return v;
  };
}

describe('096 端点探测', () => {
  it('HTTP 200 → reachable + ok + 状态码 + 延迟', async () => {
    const r = await probeEndpoint('https://api.deepseek.com/v1', 'cn', {
      fetchImpl: fakeFetch(() => ({ status: 200 })),
      now: fakeClock(1000, 25),
    });
    expect(r).toMatchObject({
      url: 'https://api.deepseek.com/v1',
      label: 'cn',
      probeUrl: 'https://api.deepseek.com/v1/models',
      reachable: true,
      ok: true,
      status: 200,
      latencyMs: 25,
    });
    expect(r.error).toBeUndefined();
  });

  it('HTTP 401 → 可达但未鉴权（ok=false），仍计入建议候选', async () => {
    const r = await probeEndpoint('https://api.anthropic.com', undefined, {
      fetchImpl: fakeFetch(() => ({ status: 401 })),
      now: fakeClock(),
    });
    expect(r).toMatchObject({ reachable: true, ok: false, status: 401 });
    expect(suggestEndpoint([r])?.url).toBe('https://api.anthropic.com');
  });

  it('网络错误 → reachable=false + error 文本（不抛异常）', async () => {
    const r = await probeEndpoint('https://down.example/v1', undefined, {
      fetchImpl: fakeFetch(() => new Error('getaddrinfo ENOTFOUND down.example')),
      now: fakeClock(),
    });
    expect(r.reachable).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.status).toBeUndefined();
    expect(r.error).toContain('ENOTFOUND');
  });

  it('超时 → error=timeout after <ms>ms', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    const r = await probeEndpoint('https://slow.example/v1', undefined, {
      fetchImpl: fakeFetch(() => err),
      now: fakeClock(),
      timeoutMs: 1234,
    });
    expect(r.error).toBe('timeout after 1234ms');
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBe(3000);
  });

  it('探测请求不携带任何凭据（无 authorization/api-key 头）', async () => {
    const spy = vi.fn(fakeFetch(() => ({ status: 200 })));
    await probeEndpoint('https://api.deepseek.com/v1', undefined, {
      fetchImpl: spy as unknown as typeof fetch,
      now: fakeClock(),
    });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).toEqual(['accept']);
    expect(JSON.stringify(init)).not.toMatch(/authorization|api-key|bearer/i);
  });

  it('probeUrlFor 归一：去尾部斜杠、可自定义路径', () => {
    expect(probeUrlFor('https://a.example/v1')).toBe('https://a.example/v1/models');
    expect(probeUrlFor('https://a.example/v1///')).toBe('https://a.example/v1/models');
    expect(probeUrlFor('  https://a.example/v1  ')).toBe('https://a.example/v1/models');
    expect(probeUrlFor('https://a.example', 'health')).toBe('https://a.example/health');
  });

  it('rankProbes：ok < 可达未鉴权 < 不可达；同档按延迟升序', () => {
    const mk = (url: string, over: Partial<EndpointProbeResult>): EndpointProbeResult => ({
      url,
      probeUrl: `${url}/models`,
      reachable: false,
      ok: false,
      latencyMs: 0,
      ...over,
    });
    const results = [
      mk('slow-ok', { reachable: true, ok: true, latencyMs: 300 }),
      mk('down', { reachable: false, error: 'boom', latencyMs: 5 }),
      mk('fast-ok', { reachable: true, ok: true, latencyMs: 20 }),
      mk('auth', { reachable: true, ok: false, status: 401, latencyMs: 10 }),
    ];
    expect(rankProbes(results).map((r) => r.url)).toEqual(['fast-ok', 'slow-ok', 'auth', 'down']);
    expect(results.map((r) => r.url)).toEqual(['slow-ok', 'down', 'fast-ok', 'auth']); // 不改原数组
    expect(suggestEndpoint(results)?.url).toBe('fast-ok');
  });

  it('全部不可达 → suggestEndpoint 返回 undefined（无建议）', () => {
    const down: EndpointProbeResult = {
      url: 'https://down.example',
      probeUrl: 'https://down.example/models',
      reachable: false,
      ok: false,
      latencyMs: 3,
      error: 'boom',
    };
    expect(suggestEndpoint([down])).toBeUndefined();
  });

  it('probeProviderEndpoints：配了 endpoints 用候选池，否则回退 baseUrl，两者都无 → []', async () => {
    const opts = { fetchImpl: fakeFetch(() => ({ status: 200 })), now: fakeClock() };
    const withPool = await probeProviderEndpoints(
      { baseUrl: 'https://base/v1', endpoints: [{ url: 'https://a/v1', label: 'a' }, { url: 'https://b/v1' }] },
      opts,
    );
    expect(withPool.map((r) => r.url)).toEqual(['https://a/v1', 'https://b/v1']);

    const fallback = await probeProviderEndpoints({ baseUrl: 'https://base/v1' }, opts);
    expect(fallback.map((r) => r.url)).toEqual(['https://base/v1']);

    expect(await probeProviderEndpoints({}, opts)).toEqual([]);
  });
});
