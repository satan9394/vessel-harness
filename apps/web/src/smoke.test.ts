import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * BRIEF-23 ② — `apps/web/src/smoke.ts` 是**人手动跑的验收脚本**，它对失败的回合
 * 照旧打印 `SMOKE_OK`。
 *
 * 复现（改前，代码路径必然如此）：脚本确实查了 SSE 的状态码（`if (sseRes.status !== 200) throw`），
 * 但回合只做 `const turn = await turnRes.json(); console.log('turn:', …)` —— **不看
 * `turnRes.ok`、也不看 `turn.kind`**，随后无条件走到末尾的 `console.log('SMOKE_OK')`。
 * 于是一个 `kind='error'` 的回合（`apps/local-server` 的 `turnStatusFor` 把它答成 HTTP 500，
 * body 仍是 `{ finalText, kind, steps, turnId }`）在 smoke 里表现为「多打印一行 + SMOKE_OK」，
 * 退出码仍是 0 —— 成败信号对回合失败完全失明。
 *
 * 这里把 smoke 当**脚本**驱动（不是改造成测试框架）：把 `fetch` / `console` / `process.exit`
 * 换成桩，再用假的 SSE `ReadableStream` 顶替服务器，然后 `import('./smoke')` 让它的真实
 * `main()` 从头跑到尾。所以下面的断言是关于**实际代码路径**的，不是静态扫源码。
 *
 * 判别性（纪律 24 —— 删/改哪一行会红）：
 * - 删掉 `if (!turnRes.ok || turn.kind === 'error') { … }` 整块 ⇒ ①/②/③ 里 `SMOKE_OK`
 *   会被打印、`process.exit` 不会被调用 ⇒ `not.toContain('SMOKE_OK')` 与 `exits` 断言红；
 * - 只删 `turn.kind === 'error'` 这个合取项 ⇒ ③（HTTP 200 + kind='error'）红；
 * - 只删 `!turnRes.ok` ⇒ ②（HTTP 500 + 无 kind 的 `{ error, message }`）红；
 * - 删掉 `console.error(...)` 那行 ⇒ ①/②/③ 的 reason 断言红。
 * 负对照：④ 全成功的回合，输出逐字不变且从不调用 `process.exit`。
 */

/** Response-like stub whose body is JSON (the local server's wire shape). */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  } as unknown as Response;
}

/** Response-like stub whose body is a fake SSE stream (one frame per chunk). */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const PING = 'data: {"type":"ping"}\n\n';
const USAGE = 'data: {"type":"usage","delta":{"calls":1,"inputTokens":1,"outputTokens":1}}\n\n';
const CONVERSATION = 'data: {"type":"conversation","delta":{"role":"assistant","text":"hi"}}\n\n';
const SSE_CHUNKS = [PING, USAGE, CONVERSATION];

const DONE_TURN = { finalText: 'hi', kind: 'done', steps: [], turnId: 't1' };

interface RunRecord {
  /** every captured console.log line, args joined with a space */
  logs: string[];
  /** every captured console.error line, args joined with a space */
  errors: string[];
  /** every process.exit(code) the script made (empty ⇒ it never exited) */
  exits: (number | undefined)[];
}

interface ProcessLike {
  exit(code?: number): void;
}

/**
 * Run the real `main()` of ./smoke against stubbed IO and wait for its terminal
 * signal (SMOKE_OK printed, or process.exit called — whichever the run produces,
 * so the pre-fix and post-fix code both settle quickly instead of timing out).
 */
async function runSmoke(turnStatus: number, turnBody: unknown): Promise<RunRecord> {
  const records: RunRecord = { logs: [], errors: [], exits: [] };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/health')) return jsonResponse(200, { ok: true, version: '0.10.0' });
      if (url.endsWith('/projects/open')) return jsonResponse(200, { project: { root: '/tmp/vessel-smoke' } });
      if (url.endsWith('/sessions')) return jsonResponse(201, { session: { id: 's1' } });
      if (url.endsWith('/events')) return sseResponse(SSE_CHUNKS);
      if (url.endsWith('/turns')) return jsonResponse(turnStatus, turnBody);
      throw new Error(`smoke.test: unexpected fetch ${url}`);
    }),
  );

  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    records.logs.push(args.map((a) => String(a)).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    records.errors.push(args.map((a) => String(a)).join(' '));
  });

  // Reach `process` through globalThis (the same defensive style uiModules.ts /
  // TeamModule.tsx use) so this test does not depend on node globals being in
  // the web tsconfig's `types` list.
  const proc = (globalThis as unknown as { process: ProcessLike }).process;
  vi.spyOn(proc, 'exit').mockImplementation((code?: number) => {
    records.exits.push(code);
  });

  vi.resetModules();
  await import('./smoke');

  // main() is started fire-and-forget at module load: wait for it to finish.
  await vi.waitFor(() => {
    expect(records.logs.includes('SMOKE_OK') || records.exits.length > 0).toBe(true);
  });

  // Safety net: a routing mistake in the mock above must never be able to read
  // as "the turn failed" in the assertions below.
  expect(records.errors.join('\n')).not.toContain('smoke.test: unexpected fetch');

  return records;
}

describe('apps/web smoke script — a failed turn must not report success', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('① a 500 turn with { finalText, kind: "error" } prints the reason and exits non-zero', async () => {
    const records = await runSmoke(500, {
      finalText: 'same intent denied 3 times: Write',
      kind: 'error',
      steps: [],
      turnId: 't-err',
    });

    // 改前：这一行会命中（SMOKE_OK 照打印）⇒ 红
    expect(records.logs).not.toContain('SMOKE_OK');
    // 改前：exits 为空（脚本正常跑完，退出码 0）⇒ 红
    expect(records.exits).toEqual([1]);

    const failure = records.errors.join('\n');
    expect(failure).toContain('SMOKE_FAIL');
    expect(failure).toContain('status=500');
    expect(failure).toContain('kind=error');
    expect(failure).toContain('same intent denied 3 times: Write');
  });

  it('② a 500 turn with { error, message } (no kind) fails on the status alone', async () => {
    // apps/local-server:391 —— 回合自身抛异常时就是这个形状（500、没有 kind 字段）
    const records = await runSmoke(500, { error: 'turn_failed', message: 'harness blew up' });

    expect(records.logs).not.toContain('SMOKE_OK');
    expect(records.exits).toEqual([1]);

    const failure = records.errors.join('\n');
    expect(failure).toContain('status=500');
    expect(failure).toContain('harness blew up');
  });

  it('③ an HTTP 200 whose body says kind="error" fails too (the status alone is not the signal)', async () => {
    // BRIEF-19 之前 kind='error' 就是配 200 回来的（turnStatusFor 出现前的线上形状）
    const records = await runSmoke(200, {
      finalText: 'same intent denied 3 times: Write',
      kind: 'error',
      steps: [],
      turnId: 't-err',
    });

    expect(records.logs).not.toContain('SMOKE_OK');
    expect(records.exits).toEqual([1]);
    expect(records.errors.join('\n')).toContain('same intent denied 3 times: Write');
  });

  it('④ (negative control) an all-success run prints exactly the old lines and never exits', async () => {
    const records = await runSmoke(200, DONE_TURN);

    expect(records.logs).toEqual([
      'health: {"ok":true,"version":"0.10.0"}',
      'session id: s1',
      'got ping frame',
      'turn: {"finalText":"hi","kind":"done","steps":[],"turnId":"t1"}',
      'frame types seen: {"ping":1,"usage":1,"conversation":1}',
      'sample conversation delta keys: role,text',
      'sample usage delta keys: calls,inputTokens,outputTokens',
      'SMOKE_OK',
    ]);
    expect(records.errors).toEqual([]);
    expect(records.exits).toEqual([]);
  });
});
