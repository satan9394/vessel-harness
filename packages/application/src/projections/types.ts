import type { EventBus } from '@vessel/core';

/**
 * Shared types for the application event-projection layer (task 040).
 *
 * Projections are read-only facts derived from the live EventBus — the Web/CLI
 * surface consumes these instead of parsing the raw event JSONL. Each projection
 * subscribes to the bus incrementally and exposes a query method over its
 * accumulated state.
 */

/** A projection attaches to an EventBus and returns its detach function. */
export interface BusProjection {
  attach(bus: EventBus): () => void;
}

/** One row of the Conversation projection (user/assistant message stream). */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  /** assistant text (assistant messages) or the user's prompt (user messages) */
  text?: string;
  /** tool call summary marker — set when the assistant issued a tool call */
  toolName?: string;
  ts: number;
}

/** Tool activity status — the terminal state of a tool dispatch. */
export type ToolActivityStatus = 'started' | 'done' | 'denied' | 'error';

/** One row of the ToolActivity projection. */
export interface ToolActivity {
  toolName: string;
  status: ToolActivityStatus;
  argsSummary?: string;
  durationMs?: number;
  ts: number;
}

/** Cumulative model usage + cost estimate (Usage projection). */
export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  calls: number;
  costUsd: number;
}

/** One row of the Policy projection (audit / denials). */
export interface PolicyDenial {
  toolName?: string;
  rule?: string;
  reason?: string;
  ts: number;
}

/**
 * Pricing per 1M tokens in USD. `default` is the fallback when the model id is
 * not present in the table. Keys map directly to model ids (e.g. `gpt-4o`).
 * Mirrors configs/pricing.json's `models` shape.
 */
export interface PricingTable {
  default?: { input?: number; output?: number; cacheRead?: number };
  [model: string]: { input?: number; output?: number; cacheRead?: number } | undefined;
}

/** Task card default pricing (~default model entry in configs/pricing.json). */
export const DEFAULT_PRICING: PricingTable = {
  default: { input: 0.5, output: 1.5, cacheRead: 0.1 },
};