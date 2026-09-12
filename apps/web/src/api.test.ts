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

/**
 * BRIEF-24 — 两条同批改动没有衔接：goal-run 的结构性失败，**原因到不了人眼**。
 *
 * 复现（改前，代码路径必然如此；行号指 BRIEF-24 之前的 `api.ts`）：
 * - 服务端：`POST /api/goal/tasks/:id/run` 在结构性失败时回 **500**，body 仍是
 *   `{ result: { outcome:'error', error:'developer run failed: …', queueTask } }`
 *   （`apps/local-server/src/server.ts` 的 `goalRunStatusFor` + 回写 `{ result }`；
 *   形状被 `goal-run-status.test.ts` 的 `Object.keys(body)).toEqual(['result'])` 四处钉死）。
 * - 客户端：`request()`（旧 :160-164）走 `failureMessage(body, res.status)`；旧 `failureMessage`
 *   （:85-94）只读**顶层** `FAILURE_TEXT_FIELDS = ['finalText','message','error']`，
 *   而该 body 顶层一个都没有（`result` 不是这三个字段之一，`outcome`/`queueTask` 也不是）
 *   ⇒ for 循环一个不命中 ⇒ 落到 `return \`HTTP ${status}\`` ⇒ **message 恰为 `'HTTP 500'`**，
 *   `result.error` 里的 `developer run failed: …` 一个字符都拿不到。
 * - 消费方：`GoalModule.tsx:41` 的 `showError` 用 `err.message`（`App.tsx:194` 真的渲染它），
 *   于是 goal run 崩溃在 web 上只显示 `HTTP 500` —— 与 BRIEF-22 要治的症状逐字相同，只是换了条路由。
 *
 * 修法（web 侧读取既有的嵌套原因，**不动服务端 body 形状**——数据本来就在 body 里）：
 * `failureMessage` 在顶层三字段**都不可读**时，按 `NESTED_FAILURE_TEXT_PATHS` 下钻到
 * `body.result.error`（该列表只列**已知、已定义**的位置，不做递归搜索）。
 *
 * 判别性（纪律 24 —— 删/改哪一行会红）：
 * - 删掉 `failureMessage` 里的 `NESTED_FAILURE_TEXT_PATHS` 循环（或把 `['result','error']`
 *   从列表里去掉）⇒ ①/①′ 拿到 `'HTTP 500'` 而不是 `developer run failed: …` ⇒ 红；
 * - 把下钻放在顶层三字段**之前**、或改成"先看嵌套"⇒ ② 的 `finalText → message → error`
 *   逐字断言红（turns 路由与既有 4xx 的文案会变）；
 * - 把 `readableString` 放宽成 `return String(value)` / 递归取任意字符串 ⇒ ③ 红
 *   （`outcome:'error'`、`queueTask.id`、`{code}` 对象会被渲染成文案）；
 * - 把 `isRecord` 放开（数组也按对象读）⇒ ③ 的 `{result:[]}` / 顶层数组断言红。
 * 负对照：②组（顶层优先、逐字不变）与 ③组（无原因 ⇒ `HTTP <status>`）在下面逐条钉住；
 * ④组钉住非 JSON 体那条路径（本卡完全不碰它，它由上面的 BRIEF-23 组原样覆盖）。
 */
describe('createApiClient — 嵌套失败原因：goal run 结构性失败（BRIEF-24）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The exact 500 body `POST /api/goal/tasks/:id/run` sends on a structural failure. */
  const GOAL_RUN_ERROR_BODY = {
    result: {
      outcome: 'error',
      error: 'developer run failed: mock provider exploded',
      queueTask: { id: 'g1', status: 'pending' },
    },
  };

  it('① a 500 goal-run body surfaces result.error (pre-fix this was exactly "HTTP 500")', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse(500, GOAL_RUN_ERROR_BODY);
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err: unknown = await api.runGoalTask('g1').then(
      () => null,
      (e: unknown) => e,
    );

    // 删掉 NESTED_FAILURE_TEXT_PATHS 下钻 ⇒ message 恰好是 'HTTP 500' ⇒ 本用例红
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('developer run failed: mock provider exploded');
    expect((err as ApiError).message).toContain('developer run failed');
    expect((err as ApiError).message).not.toBe('HTTP 500');
    expect((err as ApiError).status).toBe(500);
    // 机器可读的 body 原样交给调用方（形状语义不变，服务端那条断言不受影响）
    expect((err as ApiError).body).toEqual(GOAL_RUN_ERROR_BODY);
    expect(calls[0]?.url).toBe('/api/goal/tasks/g1/run');
    expect(calls[0]?.init?.method).toBe('POST');
  });

  it('①′ the drill-down is in failureMessage itself, so every ApiError consumer gets it', () => {
    expect(failureMessage(GOAL_RUN_ERROR_BODY, 500)).toBe(
      'developer run failed: mock provider exploded',
    );
    // 报头横幅（turnErrorText 也走 failureMessage）同样受益，且不截断 JSON 原因
    expect(
      failureMessage({ result: { outcome: 'error', error: 'x'.repeat(1000) } }, 500),
    ).toHaveLength(1000);
  });

  it('② (negative control) top-level finalText/message/error still win, verbatim', async () => {
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

    const jsonErr: unknown = await api.openProject('').then(
      () => null,
      (e: unknown) => e,
    );
    expect((jsonErr as ApiError).message).toBe('workspaceRoot required');
    expect((jsonErr as ApiError).status).toBe(400);

    // 纯函数层：顶层压过嵌套，逐字不变（下钻若被提到顶层之前，这几条红）
    expect(failureMessage({ finalText: 'top', result: { error: 'nested' } }, 500)).toBe('top');
    expect(failureMessage({ message: 'm', result: { error: 'nested' } }, 400)).toBe('m');
    expect(failureMessage({ error: 'e', result: { error: 'nested' } }, 400)).toBe('e');
    // 顶层"空白"= 没有可读原因（既有语义：空白被跳过），此时才轮到嵌套
    expect(failureMessage({ finalText: '   ', message: null, result: { error: 'nested' } }, 500)).toBe(
      'nested',
    );
  });

  it('③ (negative control) no readable reason anywhere ⇒ still "HTTP <status>"', async () => {
    // 本用例即 BRIEF-24 的**复现基线**：同一形状去掉 result.error 后，旧实现的回落
    // 值就是这个 `HTTP 500` —— 说明改前的 goal-run 失败文案恰为它。
    expect(failureMessage({ result: { outcome: 'error' } }, 500)).toBe('HTTP 500');
    // 不得把机器字段当文案（outcome / id / status / 对象都不算原因）
    expect(
      failureMessage({ result: { outcome: 'error', queueTask: { id: 'g1', status: 'pending' } } }, 500),
    ).toBe('HTTP 500');
    expect(failureMessage({ result: { error: '   ' } }, 500)).toBe('HTTP 500');
    expect(failureMessage({ result: { error: { code: 'nope' } } }, 500)).toBe('HTTP 500');
    expect(failureMessage({ result: null }, 500)).toBe('HTTP 500');
    expect(failureMessage({ result: 'oops' }, 500)).toBe('HTTP 500');
    expect(failureMessage({ result: [] }, 500)).toBe('HTTP 500');

    // 走客户端也一样：永不 undefined / 空白
    const mockFetch = vi.fn(async () => jsonResponse(500, { result: { outcome: 'error' } }));
    vi.stubGlobal('fetch', mockFetch);
    const api = createApiClient({ base: '/api' });
    const err: unknown = await api.runGoalTask('g1').then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as ApiError).message).toBe('HTTP 500');
    expect((err as ApiError).message.trim()).not.toBe('');
    expect((err as ApiError).body).toEqual({ result: { outcome: 'error' } });
  });

  it('④ (negative control) the non-JSON raw-body path never pseudo-parses a nested reason', async () => {
    // 下钻只发生在已 JSON.parse 成功的对象上；代理 HTML 里恰好出现的同名字段
    // 仍走 rawBodyReason（状态前缀 + 原文），不会变成"读懂了 result.error"。
    const html = '<html>{"result":{"error":"nested"}}</html>';
    const mockFetch = vi.fn(async () => textResponse(502, html));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err: unknown = await api.runGoalTask('g1').then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).message).toBe(`HTTP 502: ${html}`);
    expect((err as ApiError).body).toBe(html);
  });
});

/**
 * BRIEF-25 — `handoffMarkdown()` **读出了 body 却丢掉**：失败时用户只看到 `HTTP <状态码>`。
 *
 * 复现（改前，代码路径必然如此；行号指 BRIEF-25 之前的 `api.ts`）：
 * - `handoffMarkdown()`（:406-418）是 `api.ts` 里**唯一**绕开 `request()` 自己拿响应的
 *   方法。它的 `!res.ok` 分支是
 *   `const bodyText = await res.text().catch(() => ''); throw new ApiError(\`HTTP ${res.status}\`, res.status, bodyText)`（:413-416）
 *   —— **body 已经读进 `bodyText`，然后被原封不动塞进 `ApiError.body`，一个字段都不读**。
 *   模板串里只有 `res.status`，`failureMessage` / `rawBodyReason` 在这条路径上**根本不会被调用**
 *   （二者在旧 `api.ts` 里的唯一调用点是 `request()` :222）。
 * - 服务端该路由的失败体是**扁平 JSON**：`apps/local-server/src/server.ts:583`
 *   `return json(res, 404, { error: 'handoff_missing', reviewId: id })`（artifact 文件不存在时），
 *   以及兜底 `:603` `{ error: 'not_found' }`。
 * - ⇒ `404` + `{error:'handoff_missing',reviewId}` 下 `ApiError.message` **恰为 `'HTTP 404'`**
 *   （body 里的 `handoff_missing` 一个字符都拿不到）。这就是用例 ① 在改前**必然红**的那条断言
 *   （`expect(message).toBe('handoff_missing')` 实测会得到 `'HTTP 404'`）。
 * - 消费方：`components/TeamModule.tsx:146-158` 的 `copyHandoff` → `showError`（:39-41
 *   `setError(err instanceof Error ? err.message : String(err))`）⇒ 点 Copy Handoff 失败时
 *   界面只显示 `HTTP 404`。同批刚落地的 `failureMessage` 优先链（BRIEF-22）与
 *   `rawBodyReason` 非 JSON 兜底（BRIEF-23）、嵌套 `result.error` 下钻（BRIEF-24）
 *   在这条路径上**完全用不上**——同一个病，同一条 API 层的另一处。
 *
 * 修法（最小、与既有优先链一致，**不新写一套**）：把 `request()` 里那段"读文本 → 试解析 →
 * JSON 走 `failureMessage` / 非 JSON 走 `rawBodyReason`"抽成模块级
 * `failureFromRawText(text, status): { message, body }`，两条路径共用；
 * `handoffMarkdown()` 的失败分支改为 `failureFromRawText(bodyText, res.status)`。
 * 成功路径**逐字不变**：`res.ok` 时仍然 `return res.text()`（markdown 原文，绝不解析）。
 *
 * 判别性（纪律 24 —— 删/改哪一行会红）：
 * - 把 `handoffMarkdown` 里的 `failureFromRawText(bodyText, res.status)` 改回
 *   `` `HTTP ${res.status}` ``（即恢复旧实现）⇒ ① 的 `toBe('handoff_missing')` 拿到 `'HTTP 404'` ⇒ 红；
 *   ③/③′ 同时红（原文丢失）。
 * - 把 `failureFromRawText` 里的 try/catch 换成裸 `JSON.parse` ⇒ ③/③′ 拿到 SyntaxError
 *   而非 ApiError（连 `status` 都没了）⇒ 红。
 * - 删掉 `bodyIsRawText = true`（或 catch 里的 `body = text`）⇒ ③/③′ 退回
 *   `failureMessage` 的 `'HTTP 404'`，不再带原始文本 ⇒ 红（BRIEF-23 组同样红）。
 * - 把成功路径也"顺便统一"成 `JSON.parse`（照 `request()` 的做法）⇒ ②′ 红
 *   （返回的是对象而不是 `'{"handoff":"raw"}'` 原文），② 红（markdown 不是 JSON，
 *   裸 `JSON.parse` 抛 SyntaxError）。
 * - 删掉失败分支里的 `const bodyText = await res.text().catch(() => '')`
 *   （或把 `res.text()` 换成 `res.json()`）⇒ ① 的 `body` 断言 / ③ 的 `body` 断言红
 *   （③ 还会变成 SyntaxError ⇒ 连 `status` 都没了 ⇒ 红）。
 * - `request()` 侧：把它的 `failureFromRawText(text, res.status)` 换掉 ⇒ BRIEF-23 /
 *   BRIEF-24 两组既有断言红（本卡不动它们的语义，见 ⑤）。
 * 负对照：②/②′（成功路径逐字不变）、③/③′（非 JSON 体走 `rawBodyReason`，不是 SyntaxError）、
 * ④/④′（空体/空白体回落 `HTTP <status>`）、⑤（`request()` 那条老路径逐字不变且与
 * `handoffMarkdown` 对同一 body 给出同一原因）。
 */
describe('createApiClient — handoffMarkdown 失败原因不再丢掉 (BRIEF-25)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The exact 404 body `server.ts:583` sends when the artifact file does not exist. */
  const HANDOFF_MISSING_BODY = { error: 'handoff_missing', reviewId: 'review_1' };

  /** Read a rejection without letting it fail the test, preserving the thrown value. */
  async function caught(p: Promise<unknown>): Promise<ApiError> {
    const err: unknown = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }

  it('① 404 + {error:\'handoff_missing\'} surfaces that reason (改前 message 恰为 \'HTTP 404\')', async () => {
    const calls: string[] = [];
    const mockFetch = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse(404, HANDOFF_MISSING_BODY);
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err = await caught(api.handoffMarkdown('review_1'));

    // 改前这里恰为 'HTTP 404'（body 读出来就被丢掉了）⇒ 本用例在旧实现上是红的
    expect(err.message).toBe('handoff_missing');
    expect(err.message).toContain('handoff_missing');
    expect(err.message).not.toBe('HTTP 404');
    expect(err.status).toBe(404);
    // 机器可读 body：JSON 体按 request() 的既有约定解析后原样交给调用方
    expect(err.body).toEqual(HANDOFF_MISSING_BODY);
    expect(calls).toEqual(['/api/reviews/review_1/handoff.md']);
  });

  it('①′ the catch-all 404 {error:\'not_found\'} body is surfaced too', async () => {
    // server.ts:603 —— 路由没匹配上时的兜底失败体，同样是扁平 JSON
    const mockFetch = vi.fn(async () => jsonResponse(404, { error: 'not_found' }));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err = await caught(api.handoffMarkdown('review_1'));

    expect(err.message).toBe('not_found');
    expect(err.message).not.toBe('HTTP 404');
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ error: 'not_found' });
  });

  it('② (negative control) a 200 markdown body is returned verbatim — never parsed, never wrapped', async () => {
    const md = '# External Review Handoff\n\n## 1. Task\n\n- nothing\n';
    const mockFetch = vi.fn(async () => textResponse(200, md));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const out = await api.handoffMarkdown('review_1');

    // 逐字相等：没有裁剪、没有 trim、没有包装成对象
    expect(out).toBe(md);
    expect(out).toContain('# External Review Handoff');
  });

  it('②′ (negative control) a 200 body that happens to be JSON is still returned as RAW TEXT', async () => {
    // 判别"顺便统一"：一旦把成功路径也交给 JSON.parse，这里会拿到对象而不是字符串 ⇒ 红
    const raw = '{"handoff":"raw"}';
    const mockFetch = vi.fn(async () => textResponse(200, raw));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const out = await api.handoffMarkdown('review_1');

    expect(typeof out).toBe('string');
    expect(out).toBe(raw);
    expect(out).not.toEqual(JSON.parse(raw));
  });

  it('③ (negative control) a 404 HTML body yields a readable reason, not a SyntaxError', async () => {
    const html = '<html>\n  <body>404 Not Found</body>\n</html>';
    const mockFetch = vi.fn(async () => textResponse(404, html));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err = await caught(api.handoffMarkdown('review_1'));

    // 裸 JSON.parse ⇒ 这里根本不是 ApiError（连 status 都没有）⇒ 红
    expect(err.status).toBe(404);
    // 删掉 rawBodyReason 那条分支 ⇒ 消息退回 'HTTP 404' ⇒ 红
    expect(err.message).toBe('HTTP 404: <html> <body>404 Not Found</body> </html>');
    expect(err.message).not.toContain('Unexpected token');
    expect(err.message.trim()).not.toBe('');
    expect(err.message).not.toContain('undefined');
    // 原始文本逐字保留在 body（改前是同一个字符串，故无既有消费方被破坏）
    expect(err.body).toBe(html);
  });

  it('③′ (negative control) a 404 plain-text body keeps both the status and the text', async () => {
    const mockFetch = vi.fn(async () => textResponse(404, 'handoff artifact not written yet'));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err = await caught(api.handoffMarkdown('review_1'));

    expect(err.status).toBe(404);
    expect(err.message).toBe('HTTP 404: handoff artifact not written yet');
    expect(err.message.trim()).not.toBe('');
    expect(err.body).toBe('handoff artifact not written yet');
  });

  it('④ (negative control) a 404 with an EMPTY body falls back to "HTTP 404"', async () => {
    const mockFetch = vi.fn(async () => textResponse(404, ''));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err = await caught(api.handoffMarkdown('review_1'));

    expect(err.status).toBe(404);
    expect(err.message).toBe('HTTP 404');
    expect(err.body).toBeUndefined();
  });

  it('④′ (negative control) a 404 with a blank-only body also falls back to "HTTP 404"', async () => {
    const mockFetch = vi.fn(async () => textResponse(404, '\uFEFF   \n\t'));
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const err = await caught(api.handoffMarkdown('review_1'));

    expect(err.status).toBe(404);
    expect(err.message).toBe('HTTP 404');
    expect(err.message.trim()).not.toBe('');
    // 原始空白体仍是 body（rawBodyReason 只负责折叠进 message 的那份拷贝）
    expect(err.body).toBe('\uFEFF   \n\t');
  });

  it('⑤ (negative control) the request() path is unchanged and both paths agree on one body', async () => {
    // 同一个 404 JSON 体：request() 走的老路径（getReview）与 handoffMarkdown 的新路径
    // 必须给出同一个可读原因 —— 成功路径由 ②/②′ 钉住，这里钉失败路径的一致性。
    const body = { error: 'not_found' };
    const urls: string[] = [];
    const mockFetch = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse(404, body);
    });
    vi.stubGlobal('fetch', mockFetch);

    const api = createApiClient({ base: '/api' });
    const viaRequest = await caught(api.getReview('review_1'));
    const viaHandoff = await caught(api.handoffMarkdown('review_1'));

    expect(urls).toEqual(['/api/reviews/review_1', '/api/reviews/review_1/handoff.md']);
    expect(viaRequest.message).toBe('not_found');
    expect(viaHandoff.message).toBe(viaRequest.message);
    expect(viaHandoff.status).toBe(viaRequest.status);
    expect(viaHandoff.body).toEqual(viaRequest.body);
  });
});