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
  parseOpencodeGoChatCompletion,
  resolveOpencodeGoRoute,
  toOpencodeGoWireMessages,
  type OpencodeGoFetch,
} from './OpencodeGoProvider.js';
import { createProvider, providerNameForConfig } from './createProvider.js';
import { anthropicFinishReason, parseAnthropicEvent } from '../stream/parseAnthropic.js';

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

describe('109 — 线协议修复（assistant tool_calls 投影 + reasoning_content 回传）', () => {
  it('wire 序列化：assistant tool_calls + reasoning_content 上 wire，tool 消息 tool_call_id 对应', () => {
    const wire = toOpencodeGoWireMessages([
      { role: 'user', content: '任务' },
      {
        role: 'assistant',
        content: '',
        reasoningContent: '想：先读文件',
        toolCalls: [{ id: 'tc1', name: 'Read', arguments: { path: 'a.txt' } }],
      },
      { role: 'tool', toolCallId: 'tc1', name: 'Read', content: 'DATA' },
    ]);
    expect(wire[1]).toEqual({
      role: 'assistant',
      content: '',
      reasoning_content: '想：先读文件',
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }],
    });
    expect(wire[2]).toEqual({ role: 'tool', tool_call_id: 'tc1', content: 'DATA', name: 'Read' });
  });

  it('非推理模型不受影响：无 reasoningContent → wire 不产生 reasoning_content 键', () => {
    const wire = toOpencodeGoWireMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);
    expect(wire[1]).toEqual({ role: 'assistant', content: 'ok' });
    expect(wire[1]).not.toHaveProperty('reasoning_content');
  });

  it('响应解析：DeepSeek 系 reasoning_content 与 opencode-go reasoning 归一进同一字段', () => {
    const deepseek = parseOpencodeGoChatCompletion({
      model: 'deepseek-flash',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '答', reasoning_content: '想：思考过程' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(deepseek.reasoning).toBe('想：思考过程');

    const go = parseOpencodeGoChatCompletion({
      model: 'mimo-v2.5',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null, reasoning: '想：go 字段' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(go.reasoning).toBe('想：go 字段');
  });

  it('mock 严格上游：修好的消息形状 200；旧形状 / 缺 reasoning_content → 400（108 复现→修复）', async () => {
    // 复刻 108 的严格上游校验：
    //  ① tool 消息必须紧跟含 tool_calls 的 assistant（tool_call_id 对应）；
    //  ② 有 tool 序列时（thinking 模式）assistant 必须回传 reasoning_content。
    const TOOL_400 = 'Messages with role \'tool\' must be a response to a preceding message with \'tool_calls\'';
    const REASON_400 = 'The reasoning_content in the thinking mode must be passed back to the API';
    const validator: OpencodeGoFetch = async (_url, init) => {
      const messages = (JSON.parse(String(init.body)) as { messages: { role: string; tool_call_id?: string; tool_calls?: unknown[]; reasoning_content?: string }[] }).messages;
      const toolIds = new Set<string>();
      for (const m of messages) {
        if (m.role === 'assistant') {
          if (m.tool_calls?.length) toolIds.add((m.tool_calls[0] as { id: string }).id);
        }
        if (m.role === 'tool') {
          if (!toolIds.has(m.tool_call_id ?? '')) {
            return err(400, { type: 'error', error: { type: 'invalid_request_error', message: TOOL_400 } });
          }
          // thinking 模式：带 tool_calls 的 assistant 必须回传 reasoning_content
          const prev = messages[messages.indexOf(m) - 1];
          if (!prev || prev.role !== 'assistant' || !prev.reasoning_content) {
            return err(400, { type: 'error', error: { type: 'invalid_request_error', message: REASON_400 } });
          }
        }
      }
      return ok({
        model: 'deepseek-flash',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '最终答复', reasoning_content: '想' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      });
    };

    const fixed = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'deepseek-flash', fetchImpl: validator });
    // 修好的形状：user → assistant(tool_calls + reasoning_content) → tool → 200
    const ok1 = await fixed.chat({
      model: 'deepseek-flash',
      messages: [
        { role: 'user', content: '任务' },
        { role: 'assistant', content: '', reasoningContent: '想：先读', toolCalls: [{ id: 'tc1', name: 'Read', arguments: { path: 'a.txt' } }] },
        { role: 'tool', toolCallId: 'tc1', name: 'Read', content: 'DATA' },
      ],
    });
    expect(ok1.content).toBe('最终答复');
    // 响应归一：chat() 把 reasoning_content 归一进 reasoningContent（AgentLoop 持久化后回传）
    expect(ok1.reasoningContent).toBe('想');

    // 旧形状（108 实验①）：user → tool，无前导 assistant tool_calls → 400
    const broken = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'deepseek-flash', fetchImpl: validator });
    const e1 = (await broken
      .chat({ model: 'deepseek-flash', messages: [{ role: 'user', content: '任务' }, { role: 'tool', toolCallId: 'tc1', name: 'Read', content: 'DATA' }] })
      .catch((x: unknown) => x)) as OpencodeGoError;
    expect(e1).toBeInstanceOf(OpencodeGoError);
    expect(e1.message).toContain(TOOL_400);

    // 缺 reasoning_content（108 实验②）：assistant(tool_calls) 无 reasoning_content → 400
    const noReasoning = new OpencodeGoProvider({ baseUrl: BASE, apiKey: 'k', model: 'deepseek-flash', fetchImpl: validator });
    const e2 = (await noReasoning
      .chat({
        model: 'deepseek-flash',
        messages: [
          { role: 'user', content: '任务' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', arguments: { path: 'a.txt' } }] },
          { role: 'tool', toolCallId: 'tc1', name: 'Read', content: 'DATA' },
        ],
      })
      .catch((x: unknown) => x)) as OpencodeGoError;
    expect(e2).toBeInstanceOf(OpencodeGoError);
    // 缺 tool_calls 前导时先撞 ①；这里形状含前导 tool_calls → 撞 ②
    expect(e2.message).toContain(REASON_400);
  });
});

// ---------------------------------------------------------------------------
// BRIEF「同一个 wire 值，两个 provider 三套口径」 — 复现 ③（opencode-go）。
//
// 改前 `mapFinishReason` 是第三套口径：
//   `if (wire === 'length' || wire === 'error') return wire;`
//   `if (wire === 'tool_calls' || hasToolCalls) return 'tool_calls';`
//   `return 'stop';`
// ⇒ `content_filter`、`refusal`、**任何未知值**都被报成 `'stop'`（"模型正常说完了"），
// 而同一个值在 Anthropic 非流式是 `'error'`。createProvider 真接线、
// CLI `--provider opencode-go` 与真实模型 lane 都在用这条路径。
// ---------------------------------------------------------------------------

/** 一条 chat/completions 补全体，只关心 finish_reason。 */
function completionWith(finishReason: string | undefined, withToolCall = false) {
  const message: Record<string, unknown> = { role: 'assistant', content: 'x' };
  if (withToolCall) {
    message.tool_calls = [{ id: 'tc1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }];
  }
  const choice: Record<string, unknown> = { message };
  if (finishReason !== undefined) choice.finish_reason = finishReason;
  return { choices: [choice], usage: { prompt_tokens: 1, completion_tokens: 1 } };
}

describe('BRIEF「同一个 wire 值，两个 provider 三套口径」— opencode-go finishReason 收敛', () => {
  it("③ 复现/判别：content_filter / 未知值 ⇒ 'error'（改前一律 'stop'），且绝不是 'stop'", () => {
    for (const wire of ['content_filter', 'refusal', 'pause_turn', 'function_call', 'some_future_value']) {
      const parsed = parseOpencodeGoChatCompletion(completionWith(wire));
      expect(parsed.finishReason, `wire=${wire}`).toBe('error');
      expect(parsed.finishReason, `wire=${wire}`).not.toBe('stop');
      expect(parsed.finishReason, `wire=${wire}`).not.toBe('length');
    }
  });

  it('③′ 未知值即便**伴随工具调用**也不得被洗成正常收尾（改前 ⇒ tool_calls；流式两路对同值都给 error）', () => {
    const parsed = parseOpencodeGoChatCompletion(completionWith('content_filter', true));
    expect(parsed.toolCalls).toHaveLength(1); // 工具调用本身不丢
    expect(parsed.finishReason).toBe('error');
    expect(parsed.finishReason).not.toBe('tool_calls');
    expect(parsed.finishReason).not.toBe('stop');
  });

  it('② 负对照：既有裁决逐字不变（stop→stop、tool_calls→tool_calls、length→length、error→error；hasToolCalls 仍覆盖 stop）', () => {
    expect(parseOpencodeGoChatCompletion(completionWith('stop')).finishReason).toBe('stop');
    expect(parseOpencodeGoChatCompletion(completionWith('tool_calls')).finishReason).toBe('tool_calls');
    expect(parseOpencodeGoChatCompletion(completionWith('length')).finishReason).toBe('length');
    expect(parseOpencodeGoChatCompletion(completionWith('error')).finishReason).toBe('error');
    // hasToolCalls 覆盖 'stop'（改前既有裁决：wire 说正常收尾但确实有 tool_calls ⇒ 去执行工具）
    expect(parseOpencodeGoChatCompletion(completionWith('stop', true)).finishReason).toBe('tool_calls');
    // 'length' 是第一优先级：有工具调用也仍是 'length'（截断信号不得被掩盖）
    expect(parseOpencodeGoChatCompletion(completionWith('length', true)).finishReason).toBe('length');
    expect(parseOpencodeGoChatCompletion(completionWith('error', true)).finishReason).toBe('error');
    // Anthropic 形 token 与另一条路径同解（见 ④）
    expect(parseOpencodeGoChatCompletion(completionWith('end_turn')).finishReason).toBe('stop');
    expect(parseOpencodeGoChatCompletion(completionWith('max_tokens')).finishReason).toBe('length');
  });

  it("③″ 负对照：wire **缺失/空** 的既有语义逐字不变（'stop'；有工具调用时 'tool_calls'）——本卡不得顺手改成 'error'", () => {
    expect(parseOpencodeGoChatCompletion(completionWith(undefined)).finishReason).toBe('stop');
    expect(parseOpencodeGoChatCompletion(completionWith('')).finishReason).toBe('stop');
    expect(parseOpencodeGoChatCompletion(completionWith(undefined, true)).finishReason).toBe('tool_calls');
    expect(parseOpencodeGoChatCompletion(completionWith('', true)).finishReason).toBe('tool_calls');
    // 两条边界都不得变成 'length'
    expect(parseOpencodeGoChatCompletion(completionWith(undefined)).finishReason).not.toBe('length');
    expect(parseOpencodeGoChatCompletion(completionWith('')).finishReason).not.toBe('length');
  });

  it('④ 同解：同一个 wire 值在 opencode-go、Anthropic 流式、Anthropic 非流式三处给出**同一个结论**', () => {
    // Anthropic 非流式 = `anthropicFinishReason`（chat() 直接调它，见 anthropic-provider.test.ts ②）；
    // Anthropic 流式 = `parseAnthropicEvent(message_delta{stop_reason})` 产出的 message_end，
    // 再经 AgentLoop 的逐字重放（AgentLoop.ts:86-90）—— 两者都必须与 opencode-go 同值。
    const streamVerdict = (wire: string): string => {
      const chunks = parseAnthropicEvent(JSON.stringify({ type: 'message_delta', delta: { stop_reason: wire } }));
      const end = chunks.find((c) => c.type === 'message_end') as { finishReason?: string } | undefined;
      if (end?.finishReason === 'length' || end?.finishReason === 'error') return end.finishReason;
      return end?.finishReason ?? 'stop';
    };

    for (const [wire, expected] of [
      ['content_filter', 'error'],
      ['refusal', 'error'],
      ['some_future_value', 'error'],
      ['stop', 'stop'],
      ['end_turn', 'stop'],
      ['stop_sequence', 'stop'],
      ['tool_calls', 'tool_calls'],
      ['tool_use', 'tool_calls'],
      ['length', 'length'],
      ['max_tokens', 'length'],
      ['error', 'error'],
    ] as const) {
      const go = parseOpencodeGoChatCompletion(completionWith(wire)).finishReason;
      const anthropic = anthropicFinishReason(wire);
      const streamed = streamVerdict(wire);
      expect(go, `wire=${wire}`).toBe(expected);
      expect(anthropic, `wire=${wire}`).toBe(expected);
      expect(streamed, `wire=${wire}`).toBe(expected);
      // 判别线：三者**互相**相等 —— 改前 'content_filter' 在 opencode-go 是 'stop'、
      // 在 Anthropic 非流式是 'error' ⇒ 本断言必红。
      expect(go, `wire=${wire}`).toBe(anthropic);
      expect(go, `wire=${wire}`).toBe(streamed);
    }
  });
});

