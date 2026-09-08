import type { EventBus } from '@vessel/core';
import type { TeamMemberBrief, TeamPhaseName, TeamRoleName } from '@vessel/shared';

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

// ---------------------------------------------------------------------------
// Team projection (task 057) — one team run rendered from bus events
// ---------------------------------------------------------------------------

/** One phase/member-activation row (team_phase). */
export interface TeamPhaseRow {
  ordinal: number;
  phase: TeamPhaseName;
  memberId: string;
  presetId: string;
  role: TeamRoleName;
  /** running → completed（成员成功进入下一阶段）/ failed（成员失败中止运行） */
  status: 'running' | 'completed' | 'failed';
  /** when the phase executes as a delegate child, the parent member id */
  delegateOf?: string;
  promptPreview?: string;
  outputPreview?: string;
  stopReason?: string;
  ts: number;
}

/** One member turn row (before_turn → after_turn), attributed to a member. */
export interface TeamTurnRow {
  memberId: string;
  role: TeamRoleName;
  phase: TeamPhaseName;
  turnId: string;
  kind: 'running' | 'success' | 'error' | 'interrupted' | 'budget';
  promptPreview?: string;
  steps?: number;
  toolCalls?: number;
  durationMs?: number;
  ts: number;
}

/** One delegation edge row (subagent_start → subagent_stop) within a team run. */
export interface TeamDelegateRow {
  delegateId: string;
  parentMemberId: string;
  childSessionId: string;
  preset?: string;
  status: 'running' | 'done';
  stopReason?: string;
  isError?: boolean;
  outputPreview?: string;
  durationMs?: number;
  ts: number;
}

/** One tool activity row (after_tool), attributed to a member. */
export interface TeamToolRow {
  memberId: string;
  role: TeamRoleName;
  toolName: string;
  status: ToolActivityStatus;
  ts: number;
}

/** Whole-team run state exposed by TeamProjection for the 060 team panel. */
export interface TeamRunState {
  runId: string;
  task: string;
  complexity?: string;
  roster: readonly TeamMemberBrief[];
  status: 'running' | 'done';
  outcome?: 'completed' | 'failed';
  error?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  phases: readonly TeamPhaseRow[];
  turns: readonly TeamTurnRow[];
  delegates: readonly TeamDelegateRow[];
  toolActivities: readonly TeamToolRow[];
}