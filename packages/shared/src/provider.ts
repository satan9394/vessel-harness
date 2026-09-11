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
  /**
   * Thinking-mode chain-of-thought (task 109): normalized reasoning text carried
   * on assistant messages. DeepSeek 系 wire 字段为 `reasoning_content`，opencode-go
   * 为 `message.reasoning`；请求时须按上游要求回传（thinking 模式校验），响应时归一进本字段。
   */
  reasoningContent?: string;
  /**
   * Provenance of a user-level message that was **injected by the context layer**
   * instead of typed by the operator: volatile environment/skills index
   * (`environment`), AGENTS.md instructions (`instruction`), project-memory
   * snapshot (`memory`), compaction summary (`compacted-summary`), operator
   * steering (`steer`). Absent = genuine surface user input.
   *
   * Session records already carry this provenance; the context builder now
   * forwards it onto the wire projection so consumers can tell injected context
   * apart from real input. MockProvider relies on it to keep script matching on
   * real surface input even when the injected skills index is the last user
   * message (G-01). Wire serializers pick fields explicitly, so the marker never
   * leaks into a real provider's HTTP body.
   */
  source?: string;
}

/**
 * `ChatMessage.source` values that mark **context-injected** user messages
 * (never real surface input). Kept next to the contract so the context builder
 * (producer) and MockProvider (consumer) cannot drift apart.
 */
export const INJECTED_MESSAGE_SOURCES: ReadonlySet<string> = new Set([
  'environment',
  'instruction',
  'memory',
  'compacted-summary',
]);

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
  /**
   * Cache **write** tokens (Anthropic `cache_creation_input_tokens`; task 099).
   *
   * Contract: absent means "this provider/wire did not report cache writes" —
   * never coerce to 0, so downstream (pricing fallback, usage store) can tell
   * "no data" apart from "reported zero". Providers that lack the concept
   * (OpenAI-compatible) leave it undefined.
   */
  cacheCreationTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: ChatFinishReason;
  usage: ChatUsage;
  raw?: unknown;
  /** Thinking-mode reasoning text normalized from the wire (task 109). */
  reasoningContent?: string;
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
  | {
      /**
       * Thinking-mode reasoning text fragment (task 109): DeepSeek 系流式
       * `delta.reasoning_content`。AgentLoop 累加进 ChatResponse.reasoningContent，
       * 供下一轮请求回传（strict 上游 thinking 校验）。
       */
      type: 'reasoning_delta';
      text: string;
    }
  | {
      type: 'usage';
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      /** cache 写入 token（Anthropic message_start 携带；task 099，缺省即未上报） */
      cacheCreationTokens?: number;
    }
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
