import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApiClient, ApiError, failureMessage } from './api';

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

  it('POST /sessions/:id/interrupt hits the interrupt route (task 050)', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const res = await api.interruptSession('s9');

    expect(res).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/sessions/s9/interrupt');
    expect(calls[0].init?.method).toBe('POST');
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

describe('createApiClient — team/route/review methods (task 060)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs route / team-run / review list on the documented paths', async () => {
    const urls: string[] = [];
    const mockFetch = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/route')) return jsonResponse(200, { mode: 'auto', pinned: false, route: null });
      if (url.endsWith('/team-runs/current')) return jsonResponse(200, { team: null });
      return jsonResponse(200, { reviews: [] });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const route = await api.getRoute('s1');
    expect(route.mode).toBe('auto');
    const team = await api.getTeamRun('s1');
    expect(team.team).toBeNull();
    const list = await api.listReviews();
    expect(list.reviews).toEqual([]);
    expect(urls).toEqual([
      '/api/sessions/s1/route',
      '/api/sessions/s1/team-runs/current',
      '/api/reviews',
    ]);
  });

  it('POSTs mode / resolve / pin / unpin with the right path and body', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(200, { mode: 'pro', pinned: true, route: null });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    await api.setRouteMode('s1', 'pro');
    await api.resolveRoute('s1', '写一个导出功能');
    await api.pinRoute('s1');
    await api.unpinRoute('s1');

    expect(calls.map((c) => c.url)).toEqual([
      '/api/sessions/s1/route',
      '/api/sessions/s1/route/resolve',
      '/api/sessions/s1/route/pin',
      '/api/sessions/s1/route/unpin',
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ mode: 'pro' });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ task: '写一个导出功能' });
    expect(calls[2]?.init?.method).toBe('POST');
  });

  it('starts a team run and imports review results on /team-runs and /reviews/:id/import', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/team-runs')) {
        return jsonResponse(202, { run: { runId: 'run_1', status: 'running' } });
      }
      return jsonResponse(200, { review: { id: 'review_1', status: 'imported', results: [] } });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const run = await api.startTeamRun('s1', { task: '重构', acceptance: ['AC-1'], mode: 'auto' });
    expect(run.run.runId).toBe('run_1');
    const imported = await api.importReview('review_1', '{"verdict":"met"}');
    expect(imported.review.status).toBe('imported');
    expect(calls[0].url).toBe('/api/sessions/s1/team-runs');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ task: '重构', acceptance: ['AC-1'], mode: 'auto' });
    expect(calls[1].url).toBe('/api/reviews/review_1/import');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ text: '{"verdict":"met"}', source: undefined });
  });

  it('handoffMarkdown fetches the raw artifact text and openReviewFolder POSTs', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('handoff.md')) {
        return { ok: true, status: 200, text: async () => '# External Review Handoff\n' } as unknown as Response;
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const md = await api.handoffMarkdown('review_1');
    expect(md).toContain('# External Review Handoff');
    const opened = await api.openReviewFolder('review_1');
    expect(opened.ok).toBe(true);
    expect(calls[0].url).toBe('/api/reviews/review_1/handoff.md');
    expect(calls[1].url).toBe('/api/reviews/review_1/open');
    expect(calls[1].init?.method).toBe('POST');
  });
});

/**
 * BRIEF-22 — the reason a turn failed is carried in the body's `finalText`, not
 * in a `message` field: `apps/local-server` answers `kind='error'` with 500 and
 * a body of exactly `{ finalText, kind, steps, turnId }`. Reading only `message`
 * collapsed every such failure into the bare `HTTP 500`.
 */
describe('createApiClient — non-2xx bodies keep the real failure reason', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('① a 500 turn error whose body only carries finalText surfaces that reason', async () => {
    const mockFetch = vi.fn(async () =>
      jsonResponse(500, {
        finalText: 'same intent denied 3 times: Write',
        kind: 'error',
        steps: [],
        turnId: 't-err',
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err: unknown = await api.runTurn('s1', '写一个文件').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('same intent denied 3 times: Write');
    expect((err as ApiError).status).toBe(500);
    // the machine-readable body is still handed to callers unchanged
    expect((err as ApiError).body).toMatchObject({ kind: 'error', turnId: 't-err' });
  });

  it('①′ a BeforeTurn policy denial reaches the caller as its reason text too', async () => {
    const mockFetch = vi.fn(async () =>
      jsonResponse(500, {
        finalText: '[blocked] 输入被 BeforeTurn 拦截：policy',
        kind: 'error',
        steps: [],
        turnId: 't-block',
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    await expect(api.runTurn('s1', 'hi')).rejects.toThrow('[blocked] 输入被 BeforeTurn 拦截：policy');
  });

  it('③ a non-2xx body with neither message nor finalText still yields "HTTP <status>"', async () => {
    const mockFetch = vi.fn(async () => jsonResponse(418, { unexpected: true }));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    await expect(api.health()).rejects.toThrow(/^HTTP 418$/);
  });

  it('② a 2xx turn result keeps finalText as data — the success path is untouched', async () => {
    const body = { finalText: 'hi', kind: 'done', steps: [{ type: 'step' }], turnId: 't1' };
    const mockFetch = vi.fn(async () => jsonResponse(200, body));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    // no throw, and the body (which also has a finalText field) is returned verbatim
    await expect(api.runTurn('s1', 'hello')).resolves.toEqual(body);
  });
});

describe('failureMessage precedence (finalText → message → error → HTTP status)', () => {
  it('takes the first non-blank string field in precedence order', () => {
    expect(failureMessage({ finalText: 'blocked by policy', message: 'm', error: 'e' }, 500)).toBe(
      'blocked by policy',
    );
    expect(failureMessage({ message: 'workspaceRoot required', error: 'missing_workspaceRoot' }, 400)).toBe(
      'workspaceRoot required',
    );
    expect(failureMessage({ error: 'missing_workspaceRoot' }, 400)).toBe('missing_workspaceRoot');
  });

  it('never returns undefined/blank when the body has no readable reason', () => {
    expect(failureMessage({}, 500)).toBe('HTTP 500');
    expect(failureMessage({ finalText: '   ' }, 500)).toBe('HTTP 500');
    expect(failureMessage({ finalText: null, message: 42 }, 500)).toBe('HTTP 500');
    expect(failureMessage({ error: { code: 'nope' } }, 422)).toBe('HTTP 422');
    expect(failureMessage(undefined, 503)).toBe('HTTP 503');
    expect(failureMessage('plain text body', 502)).toBe('HTTP 502');
    expect(failureMessage([1, 2], 500)).toBe('HTTP 500');
  });
});