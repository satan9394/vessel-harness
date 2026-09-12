import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApiClient, ApiError, failureMessage, RAW_BODY_REASON_MAX } from './api';

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

/**
 * Response-like stub whose body is arbitrary text — the shape a proxy / gateway
 * sends when it fails before the JSON API is even reached (`<html>502 …</html>`).
 */
function textResponse(status: number, text: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
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

/**
 * BRIEF-23 ① — 非 JSON 错误体曾绕过刚落地的 failureMessage 修复。
 *
 * 复现（改前，代码路径必然如此）：`request()` 里 `const body = text ? JSON.parse(text) : undefined`
 * 排在 `if (!res.ok)` **之前**（旧 :119-120）。上游 / 代理（Vite dev proxy、网关、崩掉的服务）
 * 用 HTML 或纯文本回答失败时，`JSON.parse('<html>…')` 抛 SyntaxError ⇒ 紧随其后的
 * `new ApiError(failureMessage(body, res.status), …)` 永不执行 ⇒ ① `res.status` 丢失
 * （SyntaxError 上没有 status，`ConversationView` 的 `err.status === 0` 分支也不命中）
 * ② failureMessage 没机会跑 ⇒ `turnErrorText` 走 `err instanceof Error` 分支，把 V8 的
 * `Unexpected token '<', "<html>…" is not valid JSON` 当原因显示给用户。
 *
 * 判别性（纪律 24 —— 删/改哪一行会红）：
 * - 把 try/catch 换回裸 `JSON.parse` ⇒ 用例 ①/①′/①″ 拿到 SyntaxError 而非 ApiError ⇒ 红；
 * - 删掉 `bodyIsRawText = true`（或 catch 里的 `body = text`）⇒ 消息退回 failureMessage
 *   （'HTTP 502'）而不再带原始文本 ⇒ ①/①′ 的 message 断言红；
 * - 改 `res.status` 的传递 ⇒ status 断言红。
 * 负对照：JSON 错误体与 2xx 成功体在下面 ② 组用例里逐字不变。
 */
describe('createApiClient — non-JSON error bodies (proxy HTML / plain text / BOM)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('① an HTML 502 from a proxy throws ApiError with status 502 and a readable reason', async () => {
    const html = '<html>\n  <body>502 Bad Gateway</body>\n</html>';
    const mockFetch = vi.fn(async () => textResponse(502, html));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err: unknown = await api.runTurn('s1', 'hi').then(
      () => null,
      (e: unknown) => e,
    );

    // 删掉 JSON.parse 的 try/catch ⇒ 这里是 SyntaxError（无 status）⇒ 红
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    // 删掉 rawBodyReason 这条路径 ⇒ 消息只剩 failureMessage 的 'HTTP 502' ⇒ 红
    expect((err as ApiError).message).toBe('HTTP 502: <html> <body>502 Bad Gateway</body> </html>');
    // 原始文本逐字保留在 body 上（改前这里根本没有 ApiError，故不存在被破坏的既有消费方）
    expect((err as ApiError).body).toBe(html);
  });

  it('①′ a plain-text error body keeps both the status and the text', async () => {
    const mockFetch = vi.fn(async () => textResponse(504, 'upstream timeout'));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err: unknown = await api.health().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(504);
    expect((err as ApiError).message).toBe('HTTP 504: upstream timeout');
    expect((err as ApiError).body).toBe('upstream timeout');
  });

  it('①″ a BOM/blank-only body still keeps the status (no SyntaxError)', async () => {
    // U+FEFF 是 \s 的成员：折叠后为空 ⇒ 只有状态码可读，但状态码必须还在
    const raw = '\uFEFF   ';
    const mockFetch = vi.fn(async () => textResponse(503, raw));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err: unknown = await api.health().then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(503);
    expect((err as ApiError).message).toBe('HTTP 503');
    expect((err as ApiError).body).toBe(raw);
  });

  it('①‴ a huge HTML page is clipped in the message but its status is intact', async () => {
    const huge = `<html>${'x'.repeat(5000)}</html>`;
    const mockFetch = vi.fn(async () => textResponse(502, huge));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err: unknown = await api.health().then(
      () => null,
      (e: unknown) => e,
    );

    const message = (err as ApiError).message;
    expect((err as ApiError).status).toBe(502);
    expect(message.startsWith('HTTP 502: <html>xxx')).toBe(true);
    expect(message.endsWith('…')).toBe(true);
    expect(message).toBe(`HTTP 502: ${huge.slice(0, RAW_BODY_REASON_MAX)}…`);
    // the untruncated body is still available to callers
    expect((err as ApiError).body).toBe(huge);
  });

  it('② (negative control) a JSON error body is unchanged — finalText/message still win', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/turns')) {
        return jsonResponse(500, {
          finalText: 'same intent denied 3 times: Write',
          kind: 'error',
          steps: [],
          turnId: 't-err',
        });
      }
      return jsonResponse(400, { error: 'missing_workspaceRoot', message: 'workspaceRoot required' });
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });

    const turnErr: unknown = await api.runTurn('s1', 'hi').then(
      () => null,
      (e: unknown) => e,
    );
    expect((turnErr as ApiError).message).toBe('same intent denied 3 times: Write');
    expect((turnErr as ApiError).status).toBe(500);
    // body 形状语义不变：既有消费方仍按对象字段读
    expect((turnErr as ApiError).body).toMatchObject({ kind: 'error', turnId: 't-err' });

    const jsonErr: unknown = await api.openProject('').then(
      () => null,
      (e: unknown) => e,
    );
    expect((jsonErr as ApiError).message).toBe('workspaceRoot required');
    expect((jsonErr as ApiError).status).toBe(400);
    expect((jsonErr as ApiError).body).toEqual({
      error: 'missing_workspaceRoot',
      message: 'workspaceRoot required',
    });
  });

  it('② (negative control) a 2xx JSON body is returned verbatim', async () => {
    const body = { finalText: 'hi', kind: 'done', steps: [{ type: 'step' }], turnId: 't1' };
    const mockFetch = vi.fn(async () => jsonResponse(200, body));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    await expect(api.runTurn('s1', 'hello')).resolves.toEqual(body);
  });
});