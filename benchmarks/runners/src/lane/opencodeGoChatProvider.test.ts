/**
 * task 102 — opencode-go 协议修正测试（Go 端点：x-opencode-session + 具名 UA + 路径分流 + 错误分类）。
 *
 * Covers（≥6 组，全部离线 / 注入 fetch 替身，不打真实 API）:
 *   1. session 头注入：每会话一个稳定 UUID，多次请求 + 重试复用同一 id；
 *   2. 具名 User-Agent + Authorization + 端点路径；
 *   3. 400 MissingSessionID → kind='missing-session'（非鉴权失败，不重试）；
 *   4. 401 CreditsError → kind='credits'（不重试；URL 被 sanitize，不带凭据/内部串）；
 *   5. 429 FreeUsageLimitError → 可重试（同一 session id 重发）；
 *   6. 路径分流映射：chat/completions（implemented）vs /messages、/responses（declared-only）；
 *   7. declared-only 路由调用 → 显式抛 unsupported-route（不静默走错端点）；
 *   8. mock 端到端：OpenAI 形态补全体解析（content/toolCalls/usage/finish_reason）+ 推理模型
 *      content=null 但 reasoning 有值 + 默认 max_tokens 思维链预算；
 *   9. 降级：无 key → resolver null；网络异常 → kind='network'，有限重试后上抛。
 */
import { describe, it, expect } from 'vitest';
import type { ChatRequest } from '@vessel/shared';
import {
  OpencodeGoProvider,
  OpencodeGoError,
  OPENCODE_GO_DEFAULT_MAX_TOKENS,
  OPENCODE_GO_SESSION_HEADER,
  OPENCODE_GO_USER_AGENT,
  classifyOpencodeGoError,
  parseOpencodeGoChatCompletion,
  resolveOpencodeGoRoute,
  sanitizeWireSnippet,
  type OpencodeGoFetch,
} from './opencodeGoChatProvider.js';
import { resolveOpencodeGoProvider, opencodeGoProviderResolver, probeOpencodeGoOnce } from './opencodeGoProvider.js';

const BASE = 'https://opencode.ai/zen/go/v1';

interface Captured {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** 记录每次调用的 fetch 替身（响应按序给出；用完后重复最后一个）。 */
function fakeFetch(responses: (() => Response)[], calls: Captured[] = []): { fetchImpl: OpencodeGoFetch; calls: Captured[] } {
  let i = 0;
  const fetchImpl: OpencodeGoFetch = async (url, init) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      init,
      headers,
      body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
    });
    const maker = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return maker();
  };
  return { fetchImpl, calls };
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function err(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const COMPLETION = {
  id: 'gen-1',
  object: 'chat.completion',
  model: 'mimo-v2.5',
  choices: [
    {
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        reasoning: '用户要我读文件……',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
      },
    },
  ],
  usage: {
    prompt_tokens: 248,
    completion_tokens: 8,
    prompt_tokens_details: { cached_tokens: 192 },
    completion_tokens_details: { reasoning_tokens: 8 },
  },
  cost: '0',
};

function provider(fetchImpl: OpencodeGoFetch, extra: Partial<ConstructorParameters<typeof OpencodeGoProvider>[0]> = {}): OpencodeGoProvider {
  return new OpencodeGoProvider({
    baseUrl: BASE,
    apiKey: 'sk-test-not-a-real-key',
    model: 'mimo-v2.5',
    fetchImpl,
    retryDelayMs: 0,
    ...extra,
  });
}

describe('102 — 协议头：x-opencode-session + 具名 User-Agent', () => {
  it('每个会话注入稳定 UUID，两次请求复用同一 id，UA 具名（非通用库名）', async () => {
    const { fetchImpl, calls } = fakeFetch([() => ok(COMPLETION)]);
    const p = provider(fetchImpl);
    const req: ChatRequest = { model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] };
    await p.chat(req);
    await p.chat(req);

    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.headers[OPENCODE_GO_SESSION_HEADER]).toBe(p.sessionId);
      expect(c.headers[OPENCODE_GO_SESSION_HEADER]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(c.headers['User-Agent']).toBe(OPENCODE_GO_USER_AGENT);
      expect(c.headers['User-Agent']).not.toMatch(/undici|node|axios|openai/i);
      expect(c.headers.Authorization).toBe('Bearer sk-test-not-a-real-key');
    }
    // 两次请求的 session id 相同（同一会话）
    expect(calls[0]!.headers[OPENCODE_GO_SESSION_HEADER]).toBe(calls[1]!.headers[OPENCODE_GO_SESSION_HEADER]);
    // 不同实例 = 不同会话 → 不同 id
    expect(provider(fetchImpl).sessionId).not.toBe(p.sessionId);
  });

  it('mimo-v2.5 走 /chat/completions，且默认 max_tokens 留足思维链预算', async () => {
    const { fetchImpl, calls } = fakeFetch([() => ok(COMPLETION)]);
    await provider(fetchImpl).chat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0]!.url).toBe(`${BASE}/chat/completions`);
    expect(calls[0]!.body.max_tokens).toBe(OPENCODE_GO_DEFAULT_MAX_TOKENS);
    expect(calls[0]!.body.stream).toBe(false);
  });
});

describe('102 — 错误分类：400 MissingSessionID / 401 CreditsError', () => {
  it('400 MissingSessionID → kind=missing-session（鉴权已过，非鉴权失败），不重试', async () => {
    const { fetchImpl, calls } = fakeFetch([
      () =>
        err(400, {
          type: 'error',
          error: {
            type: 'MissingSessionID',
            message: 'Error from provider (Console Go): Request is missing x-opencode-session and cannot be routed efficiently.',
          },
        }),
    ]);
    const p = provider(fetchImpl, { maxAttempts: 3 });
    await expect(p.chat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      name: 'OpencodeGoError',
      kind: 'missing-session',
      status: 400,
      wireType: 'MissingSessionID',
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('401 CreditsError → kind=credits，不重试，且错误文案不含 URL/内部串', async () => {
    const { fetchImpl, calls } = fakeFetch([
      () =>
        err(401, {
          type: 'error',
          error: {
            type: 'CreditsError',
            message: 'Insufficient balance. Manage your billing here: https://opencode.ai/workspace/wrk_01M0D76E9KB5KKZFB43XQ6PY1D/billing',
          },
        }),
    ]);
    const p = provider(fetchImpl, { maxAttempts: 3 });
    const thrown = await p.chat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(OpencodeGoError);
    const e = thrown as OpencodeGoError;
    expect(e.kind).toBe('credits');
    expect(e.status).toBe(401);
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('Insufficient balance');
    expect(e.message).not.toContain('wrk_01M0D76E9KB5KKZFB43XQ6PY1D');
    expect(e.message).not.toContain('https://');
    expect(calls).toHaveLength(1);
  });

  it('429 FreeUsageLimitError → 可重试（重试复用同一 session id）', async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => err(429, { type: 'error', error: { type: 'FreeUsageLimitError', message: 'Rate limit exceeded. Please try again later.' } }),
      () => ok(COMPLETION),
    ]);
    const p = provider(fetchImpl, { maxAttempts: 2 });
    const res = await p.chat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.toolCalls).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers[OPENCODE_GO_SESSION_HEADER]).toBe(calls[1]!.headers[OPENCODE_GO_SESSION_HEADER]);
  });

  it('classifyOpencodeGoError：鉴权/限流/服务端/未知分别归类（纯函数）', () => {
    expect(classifyOpencodeGoError(401, '{"error":{"type":"invalid_api_key","message":"bad key"}}').kind).toBe('auth');
    expect(classifyOpencodeGoError(429, '{"error":{"type":"rate_limit_exceeded"}}').kind).toBe('rate-limit');
    expect(classifyOpencodeGoError(503, 'upstream unavailable').kind).toBe('server');
    expect(classifyOpencodeGoError(404, '{"error":{"message":"model not found"}}').kind).toBe('not-found');
    expect(classifyOpencodeGoError(418, 'teapot').kind).toBe('http');
    expect(sanitizeWireSnippet('see https://example.com/x  now')).toBe('see <url> now');
  });
});

describe('102 — 路径分流（按模型家族）', () => {
  it('chat/completions 家族（GLM/Kimi/LongCat/DeepSeek/MiMo/Hy/Omen）→ implemented', () => {
    for (const m of ['mimo-v2.5', 'mimo-v2.5-pro', 'glm-5.3', 'kimi-k3', 'longcat-2.0', 'deepseek-v4-pro', 'hy4-preview', 'omen-alpha']) {
      const info = resolveOpencodeGoRoute(m);
      expect({ m, route: info.route, support: info.support }).toEqual({ m, route: '/chat/completions', support: 'implemented' });
    }
  });

  it('MiniMax/Qwen → /messages，Grok/GPT-5.6-Luna/Muse Spark → /responses，均为 declared-only', () => {
    for (const m of ['minimax-m3', 'qwen3.8-max']) {
      expect(resolveOpencodeGoRoute(m)).toMatchObject({ route: '/messages', wire: 'anthropic-messages', support: 'declared-only' });
    }
    for (const m of ['grok-4.6', 'gpt-5.6-luna', 'muse-spark-1.3-contributor']) {
      expect(resolveOpencodeGoRoute(m)).toMatchObject({ route: '/responses', wire: 'openai-responses', support: 'declared-only' });
    }
    // 未命中家族 → 默认走 OpenAI 兼容面（记录为 default）
    expect(resolveOpencodeGoRoute('unknown-model-9000')).toMatchObject({ route: '/chat/completions', family: 'default', support: 'implemented' });
  });

  it('declared-only 路由被调用 → 显式抛 unsupported-route（不静默发错端点、不烧配额）', async () => {
    const { fetchImpl, calls } = fakeFetch([() => ok(COMPLETION)]);
    const p = provider(fetchImpl, { model: 'minimax-m3' });
    await expect(p.chat({ model: 'minimax-m3', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      kind: 'unsupported-route',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('102 — mock 端到端（解析 + 推理模型）', () => {
  it('OpenAI 形态补全体 → content/toolCalls/usage/finishReason 正确归一', async () => {
    const { fetchImpl } = fakeFetch([() => ok(COMPLETION)]);
    const res = await provider(fetchImpl).chat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: '读 a.txt' }] });
    expect(res.finishReason).toBe('tool_calls');
    expect(res.toolCalls[0]).toMatchObject({ id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } });
    expect(res.usage).toEqual({ inputTokens: 248, outputTokens: 8, cacheReadTokens: 192 });
    const raw = res.raw as { reasoning: string; reasoningTokens?: number };
    expect(raw.reasoning).toContain('读文件');
    expect(raw.reasoningTokens).toBe(8);
    // 推理模型：content 为 null → 归一为空串（不伪造内容）
    expect(res.content).toBe('');
  });

  it('parseOpencodeGoChatCompletion：finish_reason=length / 空 choices / 工具参数坏 JSON 的兜底', () => {
    expect(
      parseOpencodeGoChatCompletion({ choices: [{ finish_reason: 'length', message: { content: null, reasoning: '思考中' } }] }).finishReason,
    ).toBe('length');
    expect(parseOpencodeGoChatCompletion({}).finishReason).toBe('stop');
    const broken = parseOpencodeGoChatCompletion({
      choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'c', function: { name: 'x', arguments: '{oops' } }] } }],
    });
    expect(broken.toolCalls[0]!.arguments).toEqual({ _raw: '{oops' });
  });
});

describe('102 — 降级与探针（无 key / 网络异常）', () => {
  it('无 key → resolver 返回 null（lane 走 pending-environment，不触真实 API）', async () => {
    expect(resolveOpencodeGoProvider({ id: 'x', displayName: 'X', tier: 'flash', defaultModel: 'mimo-v2.5' }, { keyResolver: () => undefined })).toBeNull();
    const r = opencodeGoProviderResolver({ keyResolver: () => undefined });
    expect(await r({ id: 'x', displayName: 'X', tier: 'flash', defaultModel: 'mimo-v2.5' })).toBeNull();
    expect(await probeOpencodeGoOnce({ defaultModel: 'mimo-v2.5' }, { keyResolver: () => undefined })).toBeNull();
  });

  it('网络异常 → kind=network，有限重试后上抛；注入 fetch 的探针返回 ok 快照', async () => {
    let n = 0;
    const failing: OpencodeGoFetch = async () => {
      n += 1;
      throw new TypeError('fetch failed');
    };
    const p = provider(failing, { maxAttempts: 2 });
    await expect(p.chat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      kind: 'network',
      retryable: true,
    });
    expect(n).toBe(2);

    const { fetchImpl } = fakeFetch([() => ok(COMPLETION)]);
    const probe = await probeOpencodeGoOnce(
      { defaultModel: 'mimo-v2.5' },
      { keyResolver: () => 'sk-test-not-a-real-key', fetchImpl, maxTokens: 64 },
    );
    expect(probe).toMatchObject({ ok: true, model: 'mimo-v2.5' });
    expect(probe!.reasoningChars).toBeGreaterThan(0);
    expect(probe!.usage.inputTokens).toBe(248);
  });

  it('resolver 为一个 lane 会话复用同一个 session id（跨模型一致）', async () => {
    const { fetchImpl, calls } = fakeFetch([() => ok(COMPLETION)]);
    const resolver = opencodeGoProviderResolver({ keyResolver: () => 'sk-test-not-a-real-key', fetchImpl });
    const a = (await resolver({ id: 'a', displayName: 'A', tier: 'flash', defaultModel: 'mimo-v2.5' })) as OpencodeGoProvider;
    const b = (await resolver({ id: 'b', displayName: 'B', tier: 'pro', defaultModel: 'mimo-v2.5-pro' })) as OpencodeGoProvider;
    expect(a.sessionId).toBe(b.sessionId);
    await a.chat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'hi' }] });
    await b.chat({ model: 'mimo-v2.5-pro', messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0]!.headers[OPENCODE_GO_SESSION_HEADER]).toBe(calls[1]!.headers[OPENCODE_GO_SESSION_HEADER]);
  });
});
