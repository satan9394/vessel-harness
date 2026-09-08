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
  /**
   * Turn-level cancellation (task 050): forwarded by AgentLoop so provider
   * chat()/stream() fetches abort promptly when the turn is interrupted.
   * Providers without abort support simply ignore it — the loop additionally
   * stops at its own checkpoint boundaries.
   */
  signal?: AbortSignal;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Normalized finish reason shared by chat()/stream accumulation and the model_stream events. */
export type ChatFinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: ChatFinishReason;
  usage: ChatUsage;
  raw?: unknown;
}

/**
 * Streaming contract v2 (task 046): one typed chunk per discrete event in the
 * provider's response stream. Consumers (AgentLoop, UI) switch on `type`.
 * Parsers in @vessel/llm/stream map wire-specific events (OpenAI SSE `data:`
 * lines, Anthropic SSE `event:` frames) onto this unified vocabulary.
 */
export type StreamChunk =
  | { type: 'message_start'; model?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string; arguments: string }
  | { type: 'tool_call_delta'; id: string; argumentsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }
  | { type: 'message_end'; finishReason?: string };

/**
 * Provider interface (v0.1): a chat completion provider.
 * Implementations: OpenAICompatibleProvider (HTTP), MockProvider (deterministic scripts).
 */
export interface ChatProvider {
  readonly id: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Optional streaming; v0.1 loop uses chat() and only consumes chunks when provided. */
  stream?(request: ChatRequest): AsyncIterable<StreamChunk>;
}

export interface RouterHints {
  provider?: string;
  model?: string;
}

export interface Router {
  resolve(hints: RouterHints): { provider: ChatProvider; model: string };
}

export type { ToolCallPayload };
