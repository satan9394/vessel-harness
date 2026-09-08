/**
 * llm/stream — streaming contract v2 (task 046).
 *
 * The unified StreamChunk vocabulary is owned by @vessel/shared (the ChatProvider
 * contract), so core/agent-loop and the UI can consume chunks without importing
 * any llm implementation. This module re-exports it and is the home for the
 * wire-format parsers (parseOpenAI / parseAnthropic) plus the streaming abort
 * options shared by provider implementations.
 */
export type { StreamChunk } from '@vessel/shared';

/** Abort plumbing accepted by the async generators that back ChatProvider.stream(). */
export interface StreamOptions {
  signal?: AbortSignal;
}