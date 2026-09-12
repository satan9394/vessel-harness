/**
 * task 102 / 103 — opencode-go 真实线协议客户端（Go 端点 `https://opencode.ai/zen/go/v1`）。
 *
 * 背景（实测事实，见 docs/OPENCODE-KEY-VERIFY.md，提交 8e15e66）：
 *   - Go 端点 `GET /v1/models` 200（35 模型，含 mimo-v2.5 / mimo-v2.5-pro）；
 *   - `POST /chat/completions` **强制** `x-opencode-session` 头：缺失 → 400 `MissingSessionID`
 *     （注意是 400 不是 401 —— 鉴权已通过，失败发生在路由阶段）；
 *   - 补一个 UUID 后同一请求 200（usage prompt=248/completion=8/total=256/cached=192）；
 *   - `mimo-v2.5` 是推理模型：`content` 可能为 null 而 `reasoning` 有值 → max_tokens 必须留
 *     思维链预算，否则拿不到 content；
 *   - 官方文档要求「每个会话一个稳定 session id + 具名 User-Agent（勿用通用 SDK/HTTP 库名）」。
 *
 * **SSOT（task 103）**：本模块原先只存在于 benchmark lane
 * （`benchmarks/runners/src/lane/opencodeGoChatProvider.ts`），导致 CLI/TUI 走通用
 * `OpenAICompatibleProvider` 时对 Go 端点 400。103 把协议实现**上提到 `@vessel/llm`**，
 * CLI（`vessel run`）、TUI（`vessel chat`）与 benchmark lane 共用这一份实现；
 * lane 侧只剩一个 re-export 外壳，**不存在第二份协议逻辑**。
 *
 * 协议硬要求收敛成一个可注入、可 mock 的 `ChatProvider`：
 *   1. **session 头**：实例构造时生成一个稳定 UUID，同一会话的所有请求（含重试）复用同一个 id；
 *   2. **User-Agent**：具名（`vessel-harness/...`），不用 undici/node 默认 UA；
 *   3. **错误分类**：400 `MissingSessionID` / 401 `CreditsError` / 429 限流 / 5xx / 网络分别归类，
 *      只对「可重试」类做有限次退避重试（重试复用同一 session id），其余立即上抛；
 *   4. **路径分流**：按模型家族把请求发到 `/chat/completions`（GLM/Kimi/LongCat/DeepSeek/MiMo/Hy/Omen，
 *      本卡**已实现**）或 `/messages`（MiniMax/Qwen）、`/responses`（Grok/GPT-5.6-Luna/Muse Spark，
 *      本卡**只做能力声明/路由映射**，调用时显式抛 unsupported-route，不静默走错端点）。
 *
 * 密钥安全铁律：apiKey 只作为构造参数在进程内流转；本模块**不写任何文件**，错误信息中的响应
 * 片段会先遮蔽密钥样式（`sanitizeErrorBody`），再剥 URL、压空白并截断，避免把凭据/内部标识
 * 带进日志（Round 7b：`:214` 的 detail 原先只走 `sanitizeWireSnippet`，401 响应体里的
 * `sk-live-…` 之类密钥会原样外显）。
 */
import { randomUUID } from 'node:crypto';
import type {
  ChatFinishReason,
  ChatProvider,
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  ChatUsage,
} from '@vessel/shared';
import { wireFinishReason } from '../finishReason.js';
import { sanitizeErrorBody, sanitizeWireSnippet } from './errorBody.js';

/**
 * `sanitizeWireSnippet` 已**下沉**到 `errorBody.ts`（Round 7b 去环）：本模块要用遮蔽口径
 * `sanitizeErrorBody`，若再由 `errorBody` 反向 import 本模块的 `sanitizeWireSnippet`，
 * 就形成 OpencodeGo ↔ errorBody 双向 import，违反仓库硬约束「依赖零环」。
 * 这里保留**同名 re-export**：`@vessel/llm` barrel、benchmark lane 外壳与既有测试的
 * 导入路径、导出名与函数行为完全不变（函数体原样搬移，未作任何修改）。
 */
export { sanitizeWireSnippet };

/** opencode-go provider 名 / preset id（CLI preset、lane resolver、createProvider 三处共用）。 */
export const OPENCODE_GO_PROVIDER_ID = 'opencode-go';

/**
 * Go 端点缺省 base-url（与 preset `opencode-go` 同一值）。
 *
 * SSOT 说明：CLI/TUI 侧以 **preset** 为事实源（`providerFactory.opencodeGoPresetBaseUrl()`
 * 读 `@vessel/application` 的 presets.data.ts）；本常量只给非 CLI 消费者（lane/测试/脚本）
 * 兜底，避免它们各自硬编码 URL。
 */
export const OPENCODE_GO_DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1';

/** opencode-go 的具名 User-Agent（官方要求：不要用通用 SDK/HTTP 库名）。 */
export const OPENCODE_GO_USER_AGENT = 'vessel-harness/1.1.0 (opencode-go; +https://github.com/composable-agent-harness)';

/** 强制会话头名（Go 端点硬要求）。 */
export const OPENCODE_GO_SESSION_HEADER = 'x-opencode-session';

/** 推理模型（mimo-v2.5 系）默认思维链 + 正文预算（token）。 */
export const OPENCODE_GO_DEFAULT_MAX_TOKENS = 8192;

/** Go 端点三条承载路径（官方 Endpoints 表）。 */
export type OpencodeGoRoute = '/chat/completions' | '/messages' | '/responses';

/** 每条路径的线协议。 */
export type OpencodeGoWire = 'openai-chat' | 'anthropic-messages' | 'openai-responses';

/** 本卡对该路径的实现程度：implemented = 可发请求并解析；declared-only = 只做映射声明。 */
export type OpencodeGoRouteSupport = 'implemented' | 'declared-only';

/** 一条路由规则（模型家族 → 路径）。 */
export interface OpencodeGoRouteRule {
  route: OpencodeGoRoute;
  wire: OpencodeGoWire;
  support: OpencodeGoRouteSupport;
  /** 官方 Endpoints 表里的模型家族描述（报告/文档用）。 */
  families: string;
  matcher: RegExp;
}

/**
 * 路由表（顺序即优先级，来自 docs/OPENCODE-KEY-VERIFY.md §2.2 的官方 Endpoints 表）。
 * 未命中任何规则 → 默认 `/chat/completions`（OpenAI 兼容面，family='default'）。
 */
export const OPENCODE_GO_ROUTE_RULES: readonly OpencodeGoRouteRule[] = [
  {
    route: '/chat/completions',
    wire: 'openai-chat',
    support: 'implemented',
    families: 'GLM / Kimi / LongCat / DeepSeek / MiMo / Hy / Omen',
    matcher: /^(?:glm|kimi|longcat|deepseek|mimo|hy[-\d]|omen)/i,
  },
  {
    route: '/messages',
    wire: 'anthropic-messages',
    support: 'declared-only',
    families: 'MiniMax / Qwen',
    matcher: /^(?:minimax|qwen)/i,
  },
  {
    route: '/responses',
    wire: 'openai-responses',
    support: 'declared-only',
    families: 'Grok / GPT-5.6-Luna / Muse Spark',
    matcher: /^(?:grok|gpt-|muse-spark)/i,
  },
];

/** 一个模型的路由解析结果。 */
export interface OpencodeGoRouteInfo {
  model: string;
  route: OpencodeGoRoute;
  wire: OpencodeGoWire;
  support: OpencodeGoRouteSupport;
  /** 命中的家族描述；未命中为 'default'。 */
  family: string;
}

/** 解析模型 → 路径（纯函数，供 lane / gate / 测试共用）。 */
export function resolveOpencodeGoRoute(model: string): OpencodeGoRouteInfo {
  for (const rule of OPENCODE_GO_ROUTE_RULES) {
    if (rule.matcher.test(model)) {
      return { model, route: rule.route, wire: rule.wire, support: rule.support, family: rule.families };
    }
  }
  return { model, route: '/chat/completions', wire: 'openai-chat', support: 'implemented', family: 'default' };
}

/** 错误分类（任务卡 102 验收项：区分 400 MissingSessionID 与 401 CreditsError）。 */
export type OpencodeGoErrorKind =
  | 'missing-session'
  | 'credits'
  | 'auth'
  | 'rate-limit'
  | 'not-found'
  | 'server'
  | 'unsupported-route'
  | 'timeout'
  | 'network'
  | 'http';

/** 只有这几类做有限退避重试（重试复用同一 session id）。 */
const RETRYABLE_KINDS: ReadonlySet<OpencodeGoErrorKind> = new Set<OpencodeGoErrorKind>([
  'rate-limit',
  'server',
  'timeout',
  'network',
]);

export interface OpencodeGoErrorInit {
  kind: OpencodeGoErrorKind;
  message: string;
  status?: number;
  /** wire 上的错误类型（如 MissingSessionID / CreditsError）。 */
  wireType?: string;
}

/** opencode-go 线协议错误（分类 + 是否可重试）。 */
export class OpencodeGoError extends Error {
  readonly kind: OpencodeGoErrorKind;
  readonly status: number | undefined;
  readonly wireType: string | undefined;
  readonly retryable: boolean;

  constructor(init: OpencodeGoErrorInit) {
    super(init.message);
    this.name = 'OpencodeGoError';
    this.kind = init.kind;
    this.status = init.status;
    this.wireType = init.wireType;
    this.retryable = RETRYABLE_KINDS.has(init.kind);
  }
}

/**
 * `sanitizeWireSnippet` 的实现已下沉到 `./errorBody.ts`（去环，见文件顶部 re-export 注释）；
 * 本模块继续 import 并在下方使用，外部导入方（含 `@vessel/llm` barrel）不受影响。
 */

/** 从 wire 错误体里取 `error.type`（opencode 形如 {"type":"error","error":{"type":"…"}}）。 */
export function extractWireErrorType(bodyText: string): string | undefined {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { type?: unknown }; type?: unknown };
    const t = parsed?.error?.type;
    if (typeof t === 'string' && t.length > 0) return t;
    const top = parsed?.type;
    return typeof top === 'string' && top.length > 0 ? top : undefined;
  } catch {
    const m = /"type"\s*:\s*"([^"]+)"/.exec(bodyText);
    return m?.[1];
  }
}

/** 从 wire 错误体里取 `error.message`（取不到则返回 undefined）。 */
export function extractWireErrorMessage(bodyText: string): string | undefined {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: unknown }; message?: unknown };
    const m = parsed?.error?.message;
    if (typeof m === 'string' && m.length > 0) return m;
    const top = parsed?.message;
    return typeof top === 'string' && top.length > 0 ? top : undefined;
  } catch {
    return undefined;
  }
}

/** 把 (status, wire 错误体) 归类成 opencode-go 错误。纯函数，供测试直接覆盖。 */
export function classifyOpencodeGoError(status: number, bodyText: string): OpencodeGoError {
  const wireType = extractWireErrorType(bodyText);
  // Round 7b（BRIEF-11 第 2 项）：detail 必须走**遮蔽**口径 —— 401 体里 `sk-live-…` 类密钥
  // 不能外显；`sanitizeWireSnippet` 只剥 URL/压空白/截断，不遮密钥。
  const detail = sanitizeErrorBody(extractWireErrorMessage(bodyText) ?? bodyText);
  const t = wireType ?? '';
  let kind: OpencodeGoErrorKind;
  if (status === 400 && /MissingSessionID/i.test(t)) kind = 'missing-session';
  else if (status === 401 && /CreditsError|Insufficient balance/i.test(`${t} ${detail}`)) kind = 'credits';
  else if (status === 401 || status === 403) kind = 'auth';
  else if (status === 429 || /FreeUsageLimitError|rate\s*limit/i.test(`${t} ${detail}`)) kind = 'rate-limit';
  else if (status === 404) kind = 'not-found';
  else if (status >= 500) kind = 'server';
  else kind = 'http';
  const label = t.length > 0 ? t : `HTTP ${status}`;
  const message = `opencode-go ${status} ${label} (${kind})${detail.length > 0 ? `: ${detail}` : ''}`;
  return new OpencodeGoError({ kind, message, status, wireType });
}

/** 已知 kind 集合（供文案还原用）。 */
const ERROR_KINDS: ReadonlySet<string> = new Set<string>([
  'missing-session',
  'credits',
  'auth',
  'rate-limit',
  'not-found',
  'server',
  'unsupported-route',
  'timeout',
  'network',
  'http',
]);

/**
 * 从错误文案里还原 kind。
 *
 * 为什么需要：AgentLoop 上抛时用 `new Error(...)` 重新包装 provider 错误
 * （`Model call failed after N attempt(s): <原始 message>`），自定义字段 `kind` 会丢失；
 * 而本模块的错误文案格式稳定（`opencode-go <status> <wireType> (<kind>): …`），
 * CLI/TUI 展示层据此仍能给出分类提示。
 */
export function opencodeGoKindFromMessage(message: string): OpencodeGoErrorKind | undefined {
  const m = /opencode-go \d{3} \S+ \(([a-z-]+)\)/.exec(message);
  const kind = m?.[1];
  return kind !== undefined && ERROR_KINDS.has(kind) ? (kind as OpencodeGoErrorKind) : undefined;
}

/**
 * CLI/TUI 面向用户的错误提示（task 103）：把已分类的错误翻成一句可操作的中文，
 * 不改错误对象本身（`kind`/`status` 仍是机器可读事实源）。
 * 未收录的 kind 返回 undefined —— 调用方沿用原始 message。
 */
export function opencodeGoErrorHint(kind: OpencodeGoErrorKind): string | undefined {
  switch (kind) {
    case 'missing-session':
      return 'Go 端点要求每个会话携带 x-opencode-session 头；用 `vessel provider add opencode-go --protocol openai-compatible --base-url https://opencode.ai/zen/go/v1` 配好后走内置 opencode-go provider（自动注入）。';
    case 'credits':
      return '账号余额/额度不足（CreditsError）——去 opencode.ai 的计费页充值或换 key。';
    case 'auth':
      return 'API key 无效或无权限：检查 OPENCODE_API_KEY / `vessel provider add` 里存的 key。';
    case 'rate-limit':
      return '触发限流（免费档/短时高频）——稍后重试或换模型档。';
    case 'not-found':
      return '模型或路径不存在：`vessel models --provider opencode-go` 看可用模型 id。';
    case 'unsupported-route':
      return '该模型家族走 /messages 或 /responses（本卡只做能力声明）——换 /chat/completions 家族模型（GLM/Kimi/LongCat/DeepSeek/MiMo/Hy/Omen）。';
    case 'server':
      return 'Go 端点 5xx——稍后重试（已按有限退避重试）。';
    case 'timeout':
      return '请求超时——检查网络/代理，或调大 timeoutMs。';
    case 'network':
      return '网络不可达——检查代理（本机 127.0.0.1:7897）与 base-url。';
    default:
      return undefined;
  }
}

/** 可注入的 fetch（测试用替身；生产用全局 fetch）。 */
export type OpencodeGoFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface OpencodeGoProviderOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** 会话 id（缺省生成一个 UUID）；同一实例的所有请求/重试复用该值。 */
  sessionId?: string;
  userAgent?: string;
  timeoutMs?: number;
  /** 缺省 max_tokens（推理模型必须留思维链预算）。 */
  defaultMaxTokens?: number;
  /** 单次 chat 的最大尝试次数（仅对可重试错误生效），默认 2。 */
  maxAttempts?: number;
  /** 重试退避基数（ms），默认 250（测试可置 0）。 */
  retryDelayMs?: number;
  fetchImpl?: OpencodeGoFetch;
  /** 强制覆盖路径（诊断用；正常由模型名解析）。 */
  route?: OpencodeGoRoute;
}

interface OpenAIChatMessageWire {
  role: string;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  /** DeepSeek 系 thinking 模式：assistant 消息须回传上一轮的思维链（task 109）。 */
  reasoning_content?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}

/** ChatMessage[] → OpenAI wire 形态（与 @vessel/llm 的实现保持同形）。 */
export function toOpencodeGoWireMessages(messages: ChatRequest['messages']): OpenAIChatMessageWire[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content, name: m.name };
    }
    const base: OpenAIChatMessageWire = { role: m.role, content: m.content };
    if (m.reasoningContent) {
      base.reasoning_content = m.reasoningContent;
    }
    if (m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    return base;
  });
}

interface OpenAIChatCompletionBody {
  model?: string;
  choices?: {
    message?: {
      content?: string | null;
      /** 推理模型（mimo-v2.5）的思维链正文（opencode-go wire）。 */
      reasoning?: string | null;
      /** DeepSeek 系 thinking 模式的思维链字段（task 109：响应归一进 reasoning）。 */
      reasoning_content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; type?: string };
}

/** 解析后的补全快照（含推理字段，便于诊断「content 为空但 reasoning 有值」）。 */
export interface OpencodeGoCompletion {
  content: string;
  reasoning: string;
  toolCalls: ChatToolCall[];
  finishReason: ChatFinishReason;
  usage: ChatUsage;
  model?: string;
  /** 思维链 token 数（wire 上报时）。 */
  reasoningTokens?: number;
}

/**
 * opencode-go wire `finish_reason` → internal four-value closed set.
 *
 * BRIEF「同一个 wire 值，两个 provider 三套口径」: this used to be the THIRD
 * opinion. Pre-change it was
 *     `if (wire === 'length' || wire === 'error') return wire;`
 *     `if (wire === 'tool_calls' || hasToolCalls) return 'tool_calls';`
 *     `return 'stop';`
 * i.e. EVERY other token — `content_filter`, `refusal`, any unknown future token —
 * was reported as `'stop'`: "the model finished normally". The same token was
 * `'error'` on the sibling Anthropic non-streaming path. Now the recognized tokens
 * come from the package's single table (`wireFinishReason`,
 * packages/llm/src/finishReason.ts), so one wire token has one verdict in every
 * `@vessel/llm` path, and an unrecognized token can never be reported as a
 * completion. Per-item rulings (each pinned in opencodeGoProvider.test.ts):
 *
 *   1. a token the table knows ⇒ the table's verdict ('stop'/'tool_calls'/
 *      'length'/'error'). This includes the Anthropic-shaped tokens
 *      (end_turn/stop_sequence/tool_use/max_tokens): recognizing them here too is
 *      the POINT — with per-family tables the same token would carry two verdicts.
 *   2. table verdict `'length'` / `'error'` ⇒ returned as-is, NOT overridden by
 *      `hasToolCalls` — same precedence the pre-change first line had (a truncation
 *      or an error must never be masked by "this response happened to contain tool
 *      calls"), and the same precedence the streaming paths give them (a
 *      `message_end{finishReason:'error'}` is not turned into `'tool_calls'` by
 *      `AgentLoop.normalizeFinishReason`).
 *   3. table verdict `'tool_calls'` ⇒ `'tool_calls'`.
 *   4. table verdict `'stop'` + `hasToolCalls` ⇒ `'tool_calls'`: the existing
 *      ruling — the wire claims a normal stop but the payload really does carry
 *      tool calls, so the loop must run them.
 *   5. **missing / empty** (`undefined` / `''`) ⇒ `'stop'`, or `'tool_calls'` when
 *      tool calls are present: the pre-change semantics, **kept verbatim**. The
 *      branch is written out explicitly rather than falling into the table, because
 *      the table's "no token ⇒ 'error'" is the OTHER paths' frozen verdict (OpenAI
 *      `chat()`), and the two must not contaminate each other.
 *      Deliberate, still-different-but-documented: an unknown PRESENT token is now
 *      `'error'` even when tool calls are present (pre-change: `'tool_calls'`) — an
 *      unrecognized termination reason may not be laundered into a normal-looking
 *      verdict by content that happens to accompany it. The streaming Anthropic /
 *      OpenAI paths already answer `'error'` for exactly that case.
 */
function mapFinishReason(wire: string | undefined, hasToolCalls: boolean): ChatFinishReason {
  if (wire === undefined || wire === '') return hasToolCalls ? 'tool_calls' : 'stop';
  const verdict = wireFinishReason(wire);
  if (verdict === 'length' || verdict === 'error') return verdict;
  if (verdict === 'tool_calls') return 'tool_calls';
  return hasToolCalls ? 'tool_calls' : 'stop';
}

/** 解析 OpenAI 形态补全体（纯函数）。 */
export function parseOpencodeGoChatCompletion(body: unknown): OpencodeGoCompletion {
  const b = (body ?? {}) as OpenAIChatCompletionBody;
  const choice = b.choices?.[0];
  const message = choice?.message;
  const toolCalls: ChatToolCall[] = (message?.tool_calls ?? []).map((tc) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>;
    } catch {
      args = { _raw: tc.function?.arguments };
    }
    return {
      id: tc.id ?? `tc_${Math.random().toString(36).slice(2)}`,
      name: tc.function?.name ?? 'unknown',
      arguments: args,
    };
  });
  const usage: ChatUsage = {
    inputTokens: b.usage?.prompt_tokens ?? 0,
    outputTokens: b.usage?.completion_tokens ?? 0,
  };
  const cached = b.usage?.prompt_tokens_details?.cached_tokens;
  if (typeof cached === 'number') usage.cacheReadTokens = cached;
  const out: OpencodeGoCompletion = {
    // task 109: DeepSeek 系 thinking 模式思维链在 `message.reasoning_content`，
    // opencode-go 在 `message.reasoning` —— 归一进同一个 reasoning 字段（响应归一，请求回传）。
    content: message?.content ?? '',
    reasoning: message?.reasoning ?? message?.reasoning_content ?? '',
    toolCalls,
    finishReason: mapFinishReason(choice?.finish_reason, toolCalls.length > 0),
    usage,
  };
  if (typeof b.model === 'string') out.model = b.model;
  const reasoningTokens = b.usage?.completion_tokens_details?.reasoning_tokens;
  if (typeof reasoningTokens === 'number') out.reasoningTokens = reasoningTokens;
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * opencode-go 真实 ChatProvider（Go 端点）。
 *
 * 一次 chat() = 一次 POST {base}{route}，带 Authorization / x-opencode-session / 具名 UA。
 * 可重试错误（429 / 5xx / 超时 / 网络）按 maxAttempts 退避重试，**复用同一 session id**。
 */
export class OpencodeGoProvider implements ChatProvider {
  readonly id = OPENCODE_GO_PROVIDER_ID;
  /** 本会话稳定 id（构造时确定；重试不换）。 */
  readonly sessionId: string;

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly defaultMaxTokens: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: OpencodeGoFetch;
  private readonly forcedRoute: OpencodeGoRoute | undefined;

  constructor(opts: OpencodeGoProviderOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.sessionId = opts.sessionId ?? randomUUID();
    this.userAgent = opts.userAgent ?? OPENCODE_GO_USER_AGENT;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.defaultMaxTokens = opts.defaultMaxTokens ?? OPENCODE_GO_DEFAULT_MAX_TOKENS;
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
    this.retryDelayMs = opts.retryDelayMs ?? 250;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.forcedRoute = opts.route;
  }

  /** 该 provider 会用到的路由（诊断/报告用）。 */
  routeInfo(model?: string): OpencodeGoRouteInfo {
    const info = resolveOpencodeGoRoute(model ?? this.model);
    return this.forcedRoute ? { ...info, route: this.forcedRoute } : info;
  }

  /** 请求头（测试断言 session 头 + 具名 UA 的边界）。 */
  headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      // Go 端点硬要求：缺它 400 MissingSessionID（鉴权已过，失败在路由阶段）
      [OPENCODE_GO_SESSION_HEADER]: this.sessionId,
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  /** 请求体（含推理模型 max_tokens 预算）。 */
  body(model: string, request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: toOpencodeGoWireMessages(request.messages),
      temperature: request.temperature ?? 0,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      stream: false,
    };
    if (request.tools && request.tools.length > 0) body.tools = request.tools;
    return body;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model && request.model.length > 0 ? request.model : this.model;
    const info = this.routeInfo(model);
    if (info.support !== 'implemented') {
      throw new OpencodeGoError({
        kind: 'unsupported-route',
        message:
          `opencode-go 路由 ${info.route}（${info.wire}）承载 ${info.family}，本卡只做能力声明未实现；` +
          `可用模型请走 /chat/completions 家族（GLM/Kimi/LongCat/DeepSeek/MiMo/Hy/Omen）。`,
      });
    }
    const url = `${this.baseUrl}${info.route}`;
    const body = JSON.stringify(this.body(model, request));

    let lastError: OpencodeGoError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let resp: Response;
      try {
        resp = await this.fetchWithTimeout(url, body, request.signal);
      } catch (err) {
        const netErr = this.networkError(err);
        if (netErr.retryable && attempt < this.maxAttempts) {
          lastError = netErr;
          await sleep(this.retryDelayMs * attempt);
          continue;
        }
        throw netErr;
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const httpErr = classifyOpencodeGoError(resp.status, text);
        if (httpErr.retryable && attempt < this.maxAttempts) {
          lastError = httpErr;
          await sleep(this.retryDelayMs * attempt);
          continue;
        }
        throw httpErr;
      }
      const parsed = parseOpencodeGoChatCompletion(await resp.json());
      return {
        content: parsed.content,
        toolCalls: parsed.toolCalls,
        finishReason: parsed.finishReason,
        usage: parsed.usage,
        raw: parsed,
        // task 109: thinking 模式思维链归一进 ChatResponse，供 AgentLoop 持久化后回传
        reasoningContent: parsed.reasoning,
      };
    }
    throw lastError ?? new OpencodeGoError({ kind: 'network', message: 'opencode-go: 请求未发出（无可用尝试）' });
  }

  private async fetchWithTimeout(url: string, body: string, external?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const forward = (): void => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', forward, { once: true });
    }
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers: this.headers(),
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', forward);
    }
  }

  private networkError(err: unknown): OpencodeGoError {
    const msg = sanitizeWireSnippet((err as Error)?.message ?? String(err));
    const aborted = (err as Error)?.name === 'AbortError' || /abort/i.test(msg);
    return new OpencodeGoError({
      kind: aborted ? 'timeout' : 'network',
      message: `opencode-go ${aborted ? 'timeout' : 'network'}: ${msg}`,
    });
  }
}
