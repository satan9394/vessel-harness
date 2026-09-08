import type { ChatProvider } from '@vessel/shared';
import { OpenAICompatibleProvider, type OpenAICompatibleOptions } from './OpenAICompatibleProvider.js';
import { AnthropicProvider, type AnthropicProviderOptions } from './AnthropicProvider.js';
import { MockProvider, type MockProviderOptions, type MockScriptEntry } from './MockProvider.js';

/**
 * llm/provider — provider factory (multi-vendor entry point).
 *
 * One `createProvider(name, opts)` switch keeps vendor onboarding to a single
 * line: add a new provider class in provider/, register it here, and the CLI /
 * compose / TaskRouter tier map can all consume it. Two wire protocols are
 * supported so far:
 *   - 'openai-compatible' — OpenAI chat/completions protocol (OpenAI, DeepSeek,
 *     Qwen, vLLM/Ollama local endpoints, …)
 *   - 'anthropic'          — Anthropic Messages API protocol (Anthropic, …)
 *   - 'mock'               — deterministic offline scripts (tests/bench/smoke)
 */

export type ProviderName = 'mock' | 'openai-compatible' | 'anthropic';

export interface ProviderCreateOptions {
  /** endpoint URL for openai-compatible / anthropic */
  baseUrl?: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  anthropicVersion?: string;
  defaultMaxTokens?: number;
  /** mock: script entries */
  script?: MockScriptEntry[];
  mock?: MockProviderOptions;
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
      throw new Error(`unknown provider "${name}" (available: mock, openai-compatible, anthropic)`);
  }
}

function requireUrl(name: string, baseUrl?: string): string {
  if (!baseUrl) throw new Error(`provider "${name}" requires baseUrl`);
  return baseUrl;
}

export type { OpenAICompatibleOptions, AnthropicProviderOptions, MockProviderOptions };
