import type { EventBus } from '@vessel/core';
import type {
  SandboxStatus,
  TeamMemberBrief,
  TeamPhaseName,
  TeamReviewConclusion,
  TeamRoleName,
} from '@vessel/shared';

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
  /** cache 写入 token（Anthropic cache_creation；task 090） */
  cacheCreationTokens: number;
  calls: number;
  costUsd: number;
  /** 成本分项（input/output/cacheRead/cacheWrite；task 090） */
  costBreakdown: CostBreakdown;
  /** 价格来源（task 086）：model / catalog / protocol / default / unpriced */
  pricingSource: PriceSource;
  /** true = 成本含通用 default 兜底价（估算，不是真实价目） */
  estimated: boolean;
}

/** One row of the Policy projection (audit / denials). */
export interface PolicyDenial {
  toolName?: string;
  rule?: string;
  reason?: string;
  ts: number;
}

/**
 * Pricing per 1M tokens in USD（task 087：与 apps/cli / benchmarks 同一份实现）。
 *
 * 类型与查价规则都来自 `@vessel/shared/pricing`，这里只做 re-export ——
 * application 层不再维护第二套价表形状与硬编码默认价。
 */
export type {
  CatalogPriceSource,
  CostBreakdown,
  PriceResolution,
  PriceSource,
  PricingTable,
  TokenPrice,
} from '@vessel/shared';
export { DEFAULT_TOKEN_PRICE, EMPTY_PRICING_TABLE } from '@vessel/shared';
import type { CostBreakdown, PriceSource } from '@vessel/shared';

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
  /** structured Internal Review conclusion (task 058) — evaluate member 产出解析结果 */
  review?: TeamReviewConclusion;
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

// ---------------------------------------------------------------------------
// Runtime enforcement telemetry (task 074) — unified view over 071-073 +
// 050 audit/denial sources
// ---------------------------------------------------------------------------

/**
 * Source module that produced an enforcement event. Mirrors the enforcement
 * seams so a query can attribute events to their module.
 *
 *  - `policy`         → 050 `policy_decision` (verdict deny) via the EventBus.
 *  - `fs-confinement` → 073 filesystem guard DENIED (`tool/result` record with
 *                       `errorClass:'DENIED'` + `meta.guard`), folded from session.
 *  - `process-tree`   → 071/072 process-tree audit (spawn/attach/escape/terminate…).
 *  - `sandbox-status` → 071 sandbox backend/resource-limit status report.
 */
export type EnforcementSource = 'policy' | 'fs-confinement' | 'process-tree' | 'sandbox-status';

/**
 * Classified enforcement event type (the `type` dimension used for counting).
 * Assigned per source from the underlying record:
 *  - policy            → `deny`      (policy deny verdict)
 *  - fs-confinement    → the guard kind carried in `meta.guard`
 *                        (`escape` | `protected` | `deny-read` | `confinement` | `size` | `nul`)
 *  - process-tree      → the `ProcessTreeAuditKind` (`spawn` | `exit` | `attached` |
 *                        `escape-detected` | `escape-terminated` | `window-closed`)
 *  - sandbox-status    → `report`    (a status snapshot was pushed)
 */
export type EnforcementType = string;

/** One aggregated runtime-enforcement telemetry event. */
export interface EnforcementEvent {
  /** classified type (deny / guard kind / tree kind / report). */
  type: EnforcementType;
  /** source module that produced the event. */
  source: EnforcementSource;
  /** epoch ms when the enforcement happened (injected; bus replay uses now). */
  ts: number;
  /** human-readable / machine detail (rule, reason, message, guard detail). */
  detail: string;
  /** optional structured payload (tool name, pid, guard kind, …). */
  meta?: Record<string, unknown>;
}

/** Aggregated enforcement telemetry snapshot — injectable & assertable. */
export interface EnforcementTelemetrySnapshot {
  /** all aggregated events, oldest-first. */
  events: readonly EnforcementEvent[];
  /** count per classified type. */
  counts: Record<string, number>;
  /** count per source module. */
  sources: Record<EnforcementSource, number>;
  /** last `n` events (newest-first). */
  recent(n: number): readonly EnforcementEvent[];
  /** current sandbox backend/resource-limit status (undefined if never reported). */
  status(): SandboxStatus | undefined;
  /** process-tree audit events pushed through the runtime seam. */
  treeAudit(): readonly ProcessTreeAuditEvent[];
}

/**
 * A process-tree audit event (071/072) pushed through the runtime seam. This is
 * a structural mirror of the runtime `ProcessTreeAuditEvent` shape (kind/pid/
 * detail/at) so the application layer stays decoupled from @vessel/runtime's
 * precise export; the runtime event is structurally assignable here.
 */
export interface ProcessTreeAuditEvent {
  kind: ProcessTreeAuditKind;
  pid?: number;
  detail: string;
  at: number;
}

/** Process-tree audit event kind (071/072 vocabulary). */
export type ProcessTreeAuditKind =
  | 'spawn'
  | 'exit'
  | 'attached'
  | 'escape-detected'
  | 'escape-terminated'
  | 'window-closed';