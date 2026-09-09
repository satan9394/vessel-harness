/**
 * task 103 — opencode-go provider 上提到 @vessel/llm 后的协议测试（CLI/TUI/lane 共用同一实现）。
 *
 * Covers（全部离线 / 注入 fetch 替身，不打真实网络）:
 *   1. createProvider('opencode-go') → 专用 provider（不是通用 openai-compatible）；
 *   2. 头注入：每实例稳定 UUID + 具名 UA；显式 sessionId（TUI 一个会话一个 id）被尊重；
 *   3. 缺头 400 MissingSessionID → kind='missing-session'（不重试）；
 *   4. 401 CreditsError → kind='credits' + 文案剥 URL（不带内部标识）；
 *   5. 路径分流：/chat/completions implemented，/messages、/responses declared-only 显式抛错；
 *   6. 降级：无 key 不注入 Authorization 但仍带 session 头；网络异常分类为 network；
 *   7. providerNameForConfig 映射（preset id opencode-go → 专用 provider 名）+ 错误提示文案。
 */
import { describe, it, expect } from 'vitest';
import type { ChatRequest } from '@vessel/shared';
import {
  OpencodeGoProvider,
  OpencodeGoError,
  OPENCODE_GO_DEFAULT_BASE_URL,
  OPENCODE_GO_PROVIDER_ID,
  OPENCODE_GO_SESSION_HEADER,
  OPENCODE_GO_USER_AGENT,
  classifyOpencodeGoError,
  opencodeGoErrorHint,
  opencodeGoKindFromMessage,
  resolveOpencodeGoRoute,
  type OpencodeGoFetch,
} from './OpencodeGoProvider.js';
import { createProvider, providerNameForConfig } from './createProvider.js';

const BASE = 'https://opencode.ai/zen/go/v1';

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(responses: (() => Response)[], calls: Captured[] = []): { fetchImpl: OpencodeGoFetch; calls: Captured[] } {
  let i = 0;
  const fetchImpl: OpencodeGoFetch = async (url, init) => {
    calls.push({
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
    });
    const maker = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return maker();
  };
  return { fetchImpl, calls };
}

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const err = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const COMPLETION = {
  model: 'mimo-v2.5',
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'pong', reasoning: '想一下' } }],
  usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 8 } },
};

const REQ: ChatRequest = { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'ping' }] };

describe('103 — createProvider 注册 opencode-go（SSOT 上提到 @vessel/llm）', () => {
  it('createProvider("opencode-go") 返回专用 provider，带 x-opencode-session + 具名 UA', async () => {
    const { fetchImpl, calls } = fakeFetch([() => ok(COMPLETION)]);
    const p = createProvider(OPENCODE_GO_PROVIDER_ID, { baseUrl: BASE, apiKey: 'sk-test-not-a-real-key', model: 'mimo-v2.5' });
    expect(p).toBeInstanceOf(OpencodeGoProvider);
    expect(p.id).toBe('opencode-go');
    // 注入 fetch 替身（生产走全局 fetch）：直接构造同参数实例，断言头/路径/体
    const direct = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'sk-test-not-a-real-key', model: 'mimo-v2.5', fetchImpl });
    await direct.chat(REQ);
    expect(calls[0]!.url).toBe(`${BASE}/chat/completions`);
    expect(calls[0]!.headers[OPENCODE_GO_SESSION_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]!.headers['User-Agent']).toBe(OPENCODE_GO_USER_AGENT);
    expect(calls[0]!.headers.Authorization).toBe('Bearer sk-test-not-a-real-key');
    // 通用客户端做不到这件事：openai-compatible 不注册任何自定义头
    expect(createProvider('openai-compatible', { baseUrl: BASE, apiKey: 'k', model: 'm' }).id).toBe('openai-compatible');
    expect(() => createProvider('nope', { model: 'm' })).toThrow(/opencode-go/);
  });

  it('providerNameForConfig：preset id opencode-go → 专用 provider 名；其余用协议名', () => {
    expect(providerNameForConfig({ id: 'opencode-go', protocol: 'openai-compatible' })).toBe('opencode-go');
    expect(providerNameForConfig({ id: 'deepseek', protocol: 'openai-compatible' })).toBe('openai-compatible');
    expect(providerNameForConfig({ id: 'claude', protocol: 'anthropic' })).toBe('anthropic');
    expect(providerNameForConfig(undefined)).toBe('mock');
    expect(providerNameForConfig(undefined, 'fallback')).toBe('fallback');
    expect(OPENCODE_GO_DEFAULT_BASE_URL).toBe(BASE);
  });

  it('会话 id：实例内稳定（多次请求 + 重试同一 id）；显式 sessionId 被尊重（TUI 会话级稳定）', async () => {
    const { fetchImpl, calls } = fakeFetch([() => ok(COMPLETION)]);
    const p = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'mimo-v2.5', fetchImpl });
    await p.chat(REQ);
    await p.chat(REQ);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers[OPENCODE_GO_SESSION_HEADER]).toBe(p.sessionId);
    expect(calls[0]!.headers[OPENCODE_GO_SESSION_HEADER]).toBe(calls[1]!.headers[OPENCODE_GO_SESSION_HEADER]);
    expect(new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'm' }).sessionId).not.toBe(p.sessionId);

    const pinned = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'mimo-v2.5', sessionId: 'tui-session-fixed', fetchImpl });
    await pinned.chat(REQ);
    expect(calls[2]!.headers[OPENCODE_GO_SESSION_HEADER]).toBe('tui-session-fixed');
  });
});

describe('103 — 错误分类（沿用 102 文案剥离）', () => {
  it('400 MissingSessionID → missing-session，不重试（鉴权已过，是路由阶段失败）', async () => {
    const { fetchImpl, calls } = fakeFetch([
      () =>
        err(400, {
          type: 'error',
          error: { type: 'MissingSessionID', message: 'Error from provider (Console Go): Request is missing x-opencode-session.' },
        }),
    ]);
    const p = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'mimo-v2.5', fetchImpl, maxAttempts: 3 });
    const thrown = await p.chat(REQ).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(OpencodeGoError);
    expect(thrown).toMatchObject({ kind: 'missing-session', status: 400, wireType: 'MissingSessionID', retryable: false });
    expect(calls).toHaveLength(1);
    expect(opencodeGoErrorHint('missing-session')).toMatch(/x-opencode-session/);
  });

  it('401 CreditsError → credits，不重试，文案剥 URL/内部标识', async () => {
    const { fetchImpl, calls } = fakeFetch([
      () =>
        err(401, {
          type: 'error',
          error: {
            type: 'CreditsError',
            message: 'Insufficient balance. Manage billing: https://opencode.ai/workspace/wrk_01M0D76E9KB5KKZFB43XQ6PY1D/billing',
          },
        }),
    ]);
    const p = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'mimo-v2.5', fetchImpl, maxAttempts: 3 });
    const e = (await p.chat(REQ).catch((x: unknown) => x)) as OpencodeGoError;
    expect(e.kind).toBe('credits');
    expect(e.status).toBe(401);
    expect(e.message).toContain('Insufficient balance');
    expect(e.message).not.toContain('wrk_01M0D76E9KB5KKZFB43XQ6PY1D');
    expect(e.message).not.toContain('https://');
    expect(calls).toHaveLength(1);
    expect(opencodeGoErrorHint('credits')).toMatch(/余额|额度/);
  });

  it('429 / 5xx / 网络可重试；分类函数其余档位保持不变', () => {
    expect(classifyOpencodeGoError(429, '{"error":{"type":"FreeUsageLimitError"}}').retryable).toBe(true);
    expect(classifyOpencodeGoError(503, 'upstream').retryable).toBe(true);
    expect(classifyOpencodeGoError(404, '{"error":{"message":"model not found"}}').kind).toBe('not-found');
    expect(classifyOpencodeGoError(403, '{"error":{"type":"forbidden"}}').kind).toBe('auth');
    expect(opencodeGoErrorHint('http')).toBeUndefined();
  });

  it('opencodeGoKindFromMessage：AgentLoop 包装后的文案仍能还原 kind（CLI/TUI 提示依赖它）', () => {
    const wrapped = 'Model call failed after 1 attempt(s): opencode-go 400 MissingSessionID (missing-session): missing header';
    expect(opencodeGoKindFromMessage(wrapped)).toBe('missing-session');
    expect(opencodeGoKindFromMessage(classifyOpencodeGoError(401, '{"error":{"type":"CreditsError"}}').message)).toBe('credits');
    expect(opencodeGoKindFromMessage('opencode-go 400 Boom (not-a-kind): x')).toBeUndefined();
    expect(opencodeGoKindFromMessage('plain failure')).toBeUndefined();
  });
});

describe('103 — 路径分流与降级', () => {
  it('路由表：chat/completions implemented，/messages 与 /responses declared-only 调用即抛', async () => {
    expect(resolveOpencodeGoRoute('mimo-v2.5')).toMatchObject({ route: '/chat/completions', support: 'implemented' });
    expect(resolveOpencodeGoRoute('minimax-m3')).toMatchObject({ route: '/messages', support: 'declared-only' });
    expect(resolveOpencodeGoRoute('grok-4.6')).toMatchObject({ route: '/responses', support: 'declared-only' });

    const { fetchImpl, calls } = fakeFetch([() => ok(COMPLETION)]);
    const p = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'minimax-m3', fetchImpl });
    await expect(p.chat({ model: 'minimax-m3', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      kind: 'unsupported-route',
    });
    expect(calls).toHaveLength(0);
  });

  it('降级：无 apiKey 不注入 Authorization，但仍带 session 头；网络异常归类为 network 并有限重试', async () => {
    const { fetchImpl, calls } = fakeFetch([() => ok(COMPLETION)]);
    const noKey = new OpencodeGoProvider({ baseUrl: BASE, model: 'mimo-v2.5', fetchImpl });
    await noKey.chat(REQ);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect(calls[0]!.headers[OPENCODE_GO_SESSION_HEADER]).toBe(noKey.sessionId);

    let n = 0;
    const failing: OpencodeGoFetch = async () => {
      n += 1;
      throw new TypeError('fetch failed');
    };
    const p = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'mimo-v2.5', fetchImpl: failing, maxAttempts: 2, retryDelayMs: 0 });
    await expect(p.chat(REQ)).rejects.toMatchObject({ kind: 'network', retryable: true });
    expect(n).toBe(2);
  });
});
