/**
 * llm/stream — streaming contract v2 (task 046).
 *
 * The unified StreamChunk vocabulary is owned by @vessel/shared (the ChatProvider
 * contract), so core/agent-loop and the UI can consume chunks without importing
 * any llm implementation. This module re-exports it and is the home for the
 * wire-format parsers (parseOpenAI / parseAnthropic) plus the streaming abort
 * options shared by provider implementations.
 */
import type { StreamChunk as SharedStreamChunk } from '@vessel/shared';

export type StreamChunk = SharedStreamChunk;

/** Adapter-facing reasoning fragment vocabulary used by UI/event consumers. */
export interface StreamThinkingChunk {
  kind: 'thinking_delta';
  delta: string;
}

/**
 * Adapt the existing shared runtime chunk without changing the core's stream
 * union or its established `reasoning_delta` consumer contract.
 */
export function toStreamThinkingChunk(chunk: SharedStreamChunk): StreamThinkingChunk | undefined {
  return chunk.type === 'reasoning_delta' ? { kind: 'thinking_delta', delta: chunk.text } : undefined;
}

/** Abort plumbing accepted by the async generators that back ChatProvider.stream(). */
export interface StreamOptions {
  signal?: AbortSignal;
}
