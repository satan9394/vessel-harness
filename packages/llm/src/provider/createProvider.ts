import type { ChatProvider } from '@vessel/shared';
import { OpenAICompatibleProvider, type OpenAICompatibleOptions } from './OpenAICompatibleProvider.js';
import { AnthropicProvider, type AnthropicProviderOptions } from './AnthropicProvider.js';
import { MockProvider, type MockProviderOptions, type MockScriptEntry } from './MockProvider.js';
import { OpencodeGoProvider, OPENCODE_GO_PROVIDER_ID } from './OpencodeGoProvider.js';

/**
 * llm/provider — provider factory (multi-vendor entry point).
 *
 * One `createProvider(name, opts)` switch keeps vendor onboarding to a single
 * line: add a new provider class in provider/, register it here, and the CLI /
 * compose / TaskRouter tier map can all consume it. Three wire protocols are
 * supported so far:
 *   - 'openai-compatible' — OpenAI chat/completions protocol (OpenAI, DeepSeek,
 *     Qwen, vLLM/Ollama local endpoints, …)
 *   - 'anthropic'          — Anthropic Messages API protocol (Anthropic, …)
 *   - 'mock'               — deterministic offline scripts (tests/bench/smoke)
 *
 * task 103: plus the opencode-go **variant** of the OpenAI-compatible wire
 * (Go endpoint `https://opencode.ai/zen/go/v1`), which additionally requires
 * `x-opencode-session` + a named User-Agent. It is registered as its own
 * provider name so CLI (`vessel run`), TUI (`vessel chat`) and the benchmark
 * lane all build it through this one factory — the protocol logic itself lives
 * once, in `OpencodeGoProvider`.
 */

export type ProviderName = 'mock' | 'openai-compatible' | 'anthropic';

export interface ProviderCreateOptions {
  /** endpoint URL for openai-compatible / anthropic / opencode-go */
  baseUrl?: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  anthropicVersion?: string;
  defaultMaxTokens?: number;
  /** opencode-go: stable per-session id for `x-opencode-session` (default: fresh UUID) */
  sessionId?: string;
  /** opencode-go: named User-Agent (default OPENCODE_GO_USER_AGENT) */
  userAgent?: string;
  /** opencode-go: bounded retries for retryable errors (default 2) */
  maxAttempts?: number;
  /** mock: script entries */
  script?: MockScriptEntry[];
  mock?: MockProviderOptions;
}

/** 一个已存供应商配置的最小选择面（ProviderStore.ProviderConfig 的子集）。 */
export interface ProviderSelection {
  /** 供应商 id（preset id，如 'opencode-go'） */
  id?: string;
  /** 线协议（'openai-compatible' / 'anthropic' / 'mock'） */
  protocol?: string;
}

/**
 * 解析「供应商配置 → provider 名」（task 103 单一映射，CLI/TUI 共用）。
 *
 * preset id `opencode-go` 与线协议 `openai-compatible` 不同：Go 端点强制
 * `x-opencode-session` + 具名 UA，通用 openai-compatible 客户端做不到（会 400
 * MissingSessionID），所以按 **id** 提升为专用 provider 名；其余配置沿用协议名。
 */
export function providerNameForConfig(cfg: ProviderSelection | undefined, fallback = 'mock'): string {
  if (!cfg) return fallback;
  if (cfg.id === OPENCODE_GO_PROVIDER_ID) return OPENCODE_GO_PROVIDER_ID;
  return cfg.protocol ?? fallback;
}

/** Create a provider by name (registry-style switch; fail loud on unknown). */
export function createProvider(name: string, opts: ProviderCreateOptions): ChatProvider {
  switch (name) {
    case 'mock':
      return new MockProvider(opts.script ?? [], { model: opts.model, ...(opts.mock ?? {}) });
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        baseUrl: requireUrl(name, opts.baseUrl),
        apiKey: opts.apiKey,
        model: opts.model,
        timeoutMs: opts.timeoutMs,
      });
    case OPENCODE_GO_PROVIDER_ID:
      return new OpencodeGoProvider({
        baseUrl: requireUrl(name, opts.baseUrl),
        apiKey: opts.apiKey,
        model: opts.model,
        timeoutMs: opts.timeoutMs,
        sessionId: opts.sessionId,
        userAgent: opts.userAgent,
        defaultMaxTokens: opts.defaultMaxTokens,
        maxAttempts: opts.maxAttempts,
      });
    case 'anthropic':
      return new AnthropicProvider({
        baseUrl: requireUrl(name, opts.baseUrl),
        apiKey: opts.apiKey,
        model: opts.model,
        anthropicVersion: opts.anthropicVersion,
        timeoutMs: opts.timeoutMs,
        defaultMaxTokens: opts.defaultMaxTokens,
      });
    default:
      throw new Error(`unknown provider "${name}" (available: mock, openai-compatible, anthropic, ${OPENCODE_GO_PROVIDER_ID})`);
  }
}

function requireUrl(name: string, baseUrl?: string): string {
  if (!baseUrl) throw new Error(`provider "${name}" requires baseUrl`);
  return baseUrl;
}

export { OPENCODE_GO_PROVIDER_ID };
export type { OpenAICompatibleOptions, AnthropicProviderOptions, MockProviderOptions };
