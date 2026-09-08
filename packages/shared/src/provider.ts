/**
 * @vessel/shared — Model Provider seam (contract only; implementations live in @vessel/llm).
 * core/agent-loop depends on this interface; it never imports llm implementations.
 */

import type { ToolCallPayload } from './events.js';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  /** OpenAI-style tool call results (role 'tool') */
  toolCallId?: string;
  /** assistant tool_calls (OpenAI function-calling round trip) */
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
}

export interface ChatToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  temperature?: number;
  maxTokens?: number;
  requestKind?: 'main' | 'compaction-summary' | 'goal-eval';
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  usage: ChatUsage;
  raw?: unknown;
}

export interface ChatStreamChunk {
  delta: string;
  done: boolean;
}

/**
 * Provider interface (v0.1): a chat completion provider.
 * Implementations: OpenAICompatibleProvider (HTTP), MockProvider (deterministic scripts).
 */
export interface ChatProvider {
  readonly id: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Optional streaming; v0.1 loop uses chat() and only consumes chunks when provided. */
  stream?(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
}

export interface RouterHints {
  provider?: string;
  model?: string;
}

export interface Router {
  resolve(hints: RouterHints): { provider: ChatProvider; model: string };
}

export type { ToolCallPayload };
