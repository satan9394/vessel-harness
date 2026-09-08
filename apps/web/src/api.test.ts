import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApiClient, ApiError } from './api';

/** Build a minimal Response-like stub for the mocked global fetch. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createApiClient', () => {
  it('GET /health hits the right URL and returns the body', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { ok: true, version: '0.10.0' });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const health = await api.health();

    expect(health).toEqual({ ok: true, version: '0.10.0' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/health');
    expect(calls[0].init?.method).toBe(undefined); // default GET
  });

  it('GET /projects and GET /sessions use GET and the listed paths', async () => {
    const urls: string[] = [];
    const mockFetch = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/projects')) {
        return jsonResponse(200, { projects: [{ root: '/tmp/a' }] });
      }
      return jsonResponse(200, { sessions: [{ id: 's1' }] });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '' });
    await api.projects();
    await api.sessions();

    expect(urls).toEqual(['/projects', '/sessions']);
  });

  it('POST /projects/open sends the workspaceRoot in a JSON body', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { project: { root: '/tmp/a' } });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const res = await api.openProject('/tmp/a');

    expect(res).toEqual({ project: { root: '/tmp/a' } });
    const call = calls[0];
    expect(call.url).toBe('/api/projects/open');
    expect(call.init?.method).toBe('POST');
    expect(JSON.parse(String(call.init?.body))).toEqual({ workspaceRoot: '/tmp/a' });
  });

  it('POST /sessions sends full input and POST /sessions/:id/turns sends the prompt', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/sessions')) {
        return jsonResponse(201, { session: { id: 's1' } });
      }
      return jsonResponse(200, { finalText: 'hi', kind: 'done', steps: [], turnId: 't1' });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    await api.createSession({ workspaceRoot: '/w', model: 'm1', permission: 'workspace-write' });
    await api.runTurn('s1', 'hello');

    expect(calls[0].url).toBe('/api/sessions');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      workspaceRoot: '/w',
      model: 'm1',
      permission: 'workspace-write',
    });

    expect(calls[1].url).toBe('/api/sessions/s1/turns');
    expect(calls[1].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ prompt: 'hello' });
  });

  it('throws ApiError with the server message on a 4xx response', async () => {
    const mockFetch = vi.fn(async () =>
      jsonResponse(400, { error: 'missing_workspaceRoot', message: 'workspaceRoot required' }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient();
    await expect(api.openProject('')).rejects.toThrow(ApiError);
    await expect(api.openProject('')).rejects.toThrow('workspaceRoot required');
  });

  it('throws a friendly ApiError when the fetch itself rejects (server down)', async () => {
    const mockFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient();
    await expect(api.health()).rejects.toThrow(
      '无法连接 local server——请先 vessel serve（127.0.0.1:5678）',
    );
  });

  it('http status 0 is set when the network fails', async () => {
    const mockFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient();
    try {
      await api.health();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
    }
  });
});