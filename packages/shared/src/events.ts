/**
 * @vessel/shared — event vocabulary (v0.1 subset of EVENT-SPEC).
 *
 * Two domains per DESIGN-DECISIONS D3 / EVENT-SPEC:
 *  - persistent session records (B##) -> append-only JSONL log, single source of truth
 *  - live extension events (A##) -> emit / waterfall decision points
 */

// Type-only import from provider.js (erased at emit time — no runtime cycle).
// Model-stream payloads reuse the provider streaming contract types so the
// event vocabulary and the ChatProvider seam can never drift apart.
import type { ChatFinishReason, ChatToolCall, ChatUsage, StreamChunk } from './provider.js';

// ---------------------------------------------------------------------------
// Persistent records (B## subset used by V0.1)
// ---------------------------------------------------------------------------

export interface SessionRecordBase {
  /** monotonic sequence, per-session */
  seq: number;
  ts: string; // ISO-8601
  type: string;
  [k: string]: unknown;
}

/**
 * B01 production discriminators — runtime list so guards/tests can detect drift.
 * The `source` field type is derived from this list (single source of truth).
 */
export const MESSAGE_SOURCES = ['user', 'steer', 'inject', 'instruction', 'compacted-summary', 'plan', 'memory', 'handoff'] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];

export interface UserMessageRecord extends SessionRecordBase {
  type: 'user/message';
  msgId: string;
  role: 'user';
  content: string;
  /**
   * B01 production discriminator. 'steer' (task 051) marks a live steering
   * directive injected by the SteeringQueue at a step boundary — it is a
   * user-level message that redirects the model's next steps without
   * interrupting the step that was in flight. 'handoff' (task 067) marks a
   * Context Reset Handoff resume context injected when a new Session starts
   * from a structured handoff (goal/completed/next_actions seeded context).
   */
  source?: MessageSource;
  surface: true;
}

export interface AssistantMessageRecord extends SessionRecordBase {
  type: 'assistant/message';
  msgId: string;
  role: 'assistant';
  content: string;
  surface: true;
  /** thinking 模式思维链（task 109）：随 assistant 消息持久化，供请求回传 reasoning_content。 */
  reasoningContent?: string;
}

export interface AssistantAttemptRecord extends SessionRecordBase {
  type: 'assistant/attempt';
  msgId: string;
  content: string;
  toolCalls: ToolCallPayload[];
  attemptNo: number;
  surface: false;
  /** thinking 模式思维链（task 109）：随 assistant 尝试持久化，供请求回传 reasoning_content。 */
  reasoningContent?: string;
}

export interface ToolCallRecord extends SessionRecordBase {
  type: 'tool/call';
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  mode: 'auto';
  surface: false;
}

export interface ToolResultRecord extends SessionRecordBase {
  type: 'tool/result';
  toolCallId: string;
  toolName: string;
  /** frozen authoritative result — content/error/meta only (canonical values never logged) */
  content?: string;
  error?: ToolErrorPayload;
  meta: Record<string, unknown>;
  surface: true;
}

export interface TurnStartRecord extends SessionRecordBase {
  type: 'turn/start';
  turnId: string;
  surface: false;
}

export interface TurnEndRecord extends SessionRecordBase {
  type: 'turn/end';
  turnId: string;
  kind: 'success' | 'error' | 'interrupted' | 'budget';
  stats: {
    steps: number;
    toolCalls: number;
    durationMs: number;
    tokensUsed?: number;
    costEstimate?: number;
  };
  toolCallsWithoutEnd?: string[];
  surface: false;
}

export interface StepStartRecord extends SessionRecordBase {
  type: 'step/start';
  stepId: string;
  turnId: string;
  surface: false;
}

export interface StepEndRecord extends SessionRecordBase {
  type: 'step/end';
  stepId: string;
  turnId: string;
  surface: false;
}

export interface AuditDecisionRecord extends SessionRecordBase {
  type: 'audit/decision';
  toolCallId: string;
  toolName: string;
  verdict: 'allow' | 'deny' | 'ask';
  decisionPath: string[];
  ruleRef?: string;
  reason?: string;
  surface: false;
}

export interface AuditDenialRecord extends SessionRecordBase {
  type: 'audit/denial';
  /**
   * 工具锚点。**非工具级**决策点没有工具调用：`stage:'before_turn'`（A03 输入级否决）写**空串**，
   * 显式表达"无工具锚点"，绝不填一个假的工具名去冒充工具级拒绝。
   */
  toolCallId: string;
  toolName: string;
  /**
   * 拒绝终态**所在阶段**（POLICY-SPEC §7.2：「`audit/denial`(B20) 的 `stage` 取自终态所在阶段」）。
   *
   * `'before_turn'` = A03 BeforeTurn 的**输入级**否决：该回合 0 步、0 次工具调用、0 次模型调用，
   * 被拒对象是"输入"而不是某次工具调用 ⇒ 否决者由 `listener` 承载、规则/钩子 ref 由 `ruleRef` 承载。
   *
   * 注意：这条词表与 `PolicyDecision.decisionPath[].stage`
   * （`'rule'|'hook'|'guard'|'approval'|'profile'`，EVENT-SPEC §5.A A13）是**两个不同的词表**，
   * 不要互相代入。
   */
  stage: 'rule' | 'hook' | 'approval' | 'sandbox' | 'guard' | 'before_turn';
  ruleRef?: string;
  reason: string;
  sandboxMode?: string;
  /**
   * 投出该 deny 的**监听器名**（EventBus `waterfall` 的 `outcome.vetoes[].listener`）——
   * "是谁否决"的可机读归属。工具级拒绝若由规则命中产生（`stage:'rule'`），通常省略此字段，
   * 由 `ruleRef` 承载身份；输入级拒绝（`stage:'before_turn'`）必须同时给出监听器与 ref。
   */
  listener?: string;
  surface: false;
}

export interface CompactionStartRecord extends SessionRecordBase {
  type: 'compaction/start';
  trigger: 'pressure' | 'overflow' | 'manual';
  surface: false;
}

export interface CompactionEndRecord extends SessionRecordBase {
  type: 'compaction/end';
  trigger: 'pressure' | 'overflow' | 'manual';
  removedRecords: number;
  surface: false;
}

/** B10 session/created — session lifecycle record (V0.2: subagent/evaluator/plan sources; task 057: 'team') */
export interface SessionCreatedRecord extends SessionRecordBase {
  type: 'session/created';
  sessionId: string;
  /** 'team' (task 057) = a TeamRuntime member session (agentPreset = member/preset id). */
  source: 'startup' | 'resume' | 'fork' | 'clear' | 'compact' | 'subagent' | 'evaluator' | 'plan' | 'team';
  parentSession?: string;
  delegationDepth?: number;
  isSeeded?: boolean;
  agentPreset?: string;
  surface: false;
}

export type SessionRecord =
  | UserMessageRecord
  | AssistantMessageRecord
  | AssistantAttemptRecord
  | ToolCallRecord
  | ToolResultRecord
  | TurnStartRecord
  | TurnEndRecord
  | StepStartRecord
  | StepEndRecord
  | AuditDecisionRecord
  | AuditDenialRecord
  | CompactionStartRecord
  | CompactionEndRecord
  | SessionCreatedRecord;

// ---------------------------------------------------------------------------
// Live extension events (A## subset used by V0.1)
// ---------------------------------------------------------------------------

export type EventType =
  | 'before_turn'
  | 'turn_started'
  | 'before_model'
  | 'model_stream_start'
  | 'model_stream_delta'
  | 'model_stream_end'
  | 'after_model'
  | 'before_tool'
  | 'policy_decision'
  | 'after_tool'
  | 'tool_error'
  | 'before_stop'
  | 'after_turn'
  | 'llm_retry'
  | 'before_compact'
  | 'after_compact'
  | 'before_delegate'
  | 'subagent_start'
  | 'subagent_stop'
  | 'after_delegate'
  // task 057 — team-run extension events (emit; vocabulary added per EVENT-SPEC, see §5.H)
  | 'team_start'
  | 'team_phase'
  | 'team_end';

/** Subagent result contract (H11 / EVENT-SPEC A24): stopReason≠completed ⇒ isError */
export interface SubagentResultContract {
  output: string;
  structured?: Record<string, unknown>;
  diagnostic?: string;
  stopReason: 'completed' | 'aborted' | 'error' | 'max_tokens' | 'refusal' | 'denied';
}

/** A22 BeforeDelegate (waterfall) — delegation veto point */
export interface BeforeDelegatePayload {
  delegateId: string;
  toolName: string;
  request: {
    prompt: string;
    preset?: string;
    options?: Record<string, unknown>;
  };
  delegationDepth: number;
  concurrencyState: { activeChildren: number; maxConcurrent: number };
}

/** A23 SubagentStart (emit) — child session created and running */
export interface SubagentStartPayload {
  delegateId: string;
  childAgentId: string;
  childSessionId: string;
  preset?: string;
  isContinuable: boolean;
  forkSource?: string;
}

/** A24 SubagentStop (emit) — child finished; result contract frozen */
export interface SubagentStopPayload {
  delegateId: string;
  childAgentId: string;
  childSessionId: string;
  result: SubagentResultContract;
  isError: boolean;
  durationMs: number;
  delegationDepth: number;
}

/** A25 AfterDelegate (serial) — delegation closed on the parent side */
export interface AfterDelegatePayload {
  delegateId: string;
  result: SubagentResultContract;
  followUp: { continuable: boolean; canSendMessage: boolean };
}

// ---------------------------------------------------------------------------
// Team extension events (task 057) — TeamRuntime orchestrates preset-based
// agents for one task (small→1 / medium→2 / complex→3, §8.2) on ONE shared
// team EventBus; members run on the existing AgentLoop/Session mechanism
// (isolated runtimes joined to the team bus). These three flat emit events are
// the ONLY new vocabulary — member turns/tools reuse before_turn/after_turn/
// after_tool, delegation reuses subagent_start/subagent_stop, and member
// provenance lives in each session's B10 session/created (source 'team' +
// agentPreset, or 'subagent' + parentSession for lead delegates).
// ---------------------------------------------------------------------------

/** Team member role discriminant (mirrors agents/presets AgentRole — payload-level mirror of the canonical value). */
export type TeamRoleName = 'orchestrator' | 'generator' | 'evaluator';

/** Team phase (task 057 skeleton): orchestrator→orchestrate, generator→generate, evaluator→evaluate. */
export type TeamPhaseName = 'orchestrate' | 'generate' | 'evaluate';

/** One roster row as published on team_start (public brief). */
export interface TeamMemberBrief {
  /** roster-unique member id (defaults to the preset id) */
  memberId: string;
  /** agents/presets registry key (lead/developer/reviewer…) */
  presetId: string;
  role: TeamRoleName;
  /** resolved model tier (route output; explicit roster may omit) */
  tier?: string;
  /** resolved model */
  model: string;
  /** providers map key */
  providerId: string;
}

/** team_start — a team run begins (emit; roster snapshot). */
export interface TeamStartPayload {
  teamRunId: string;
  task: string;
  /** §8.2 complexity (small/medium/complex) when derived from a route */
  complexity?: string;
  roster: readonly TeamMemberBrief[];
}

/** team_phase — phase/member activation (emit; attribution anchor for member events on the team bus). */
export interface TeamPhasePayload {
  teamRunId: string;
  /** 1-based phase ordinal */
  ordinal: number;
  phase: TeamPhaseName;
  memberId: string;
  presetId: string;
  role: TeamRoleName;
  /** when the phase executes as a delegate child (complex: lead's developer/reviewer), the parent member id */
  delegateOf?: string;
  /** prompt handed to the member (trimmed preview; full prompt flows as before_turn / delegate request) */
  promptPreview?: string;
}

/** Internal Review verdict kind (task 058) — mirror of the reviewer's met/not_met conclusion space. */
export type TeamReviewVerdict = 'met' | 'not_met' | 'impossible' | 'error';

/**
 * Structured Internal Review conclusion (task 058) — attached to the evaluate
 * member's summary after its output is parsed against the review JSON schema.
 * Plain-data mirror so TeamProjection can render it without importing agents.
 */
export interface TeamReviewConclusion {
  verdict: TeamReviewVerdict;
  /** why met / not_met (or why the review failed to conclude) */
  reason: string;
  /** acceptance criteria judged unmet (not_met feedback to the generator side) */
  unmet: string[];
  /** improvement suggestions for the generator (rework-loop input) */
  suggestions: string[];
  /** evidence references (output lines / files / test names) */
  evidence: string[];
}

/** Per-member phase outcome inside team_end. */
export interface TeamMemberSummary {
  memberId: string;
  presetId: string;
  role: TeamRoleName;
  phase: TeamPhaseName;
  status: 'completed' | 'failed';
  sessionId: string;
  parentSessionId?: string;
  delegationDepth: number;
  durationMs: number;
  /** turn kind (top-level member) or delegate stopReason */
  stopReason?: string;
  /** member output — finalText (top-level member) or delegate result.output */
  output?: string;
  /** structured Internal Review conclusion (task 058) — set on the evaluate member */
  review?: TeamReviewConclusion;
}

/** team_end — a team run finishes (emit; outcome + per-member summaries). */
export interface TeamEndPayload {
  teamRunId: string;
  outcome: 'completed' | 'failed';
  members: readonly TeamMemberSummary[];
  durationMs: number;
  /** failure reason (failed phase kind / delegate stopReason / diagnostic) */
  error?: string;
}

// ---------------------------------------------------------------------------
// A09 ModelStream family (task 049) — granular streaming extension events (emit)
//
// EVENT-SPEC §5.C A09 defines a single ModelStream event discriminated by
// `event: 'start'|'delta'|'end'`. The implemented vocabulary granularizes that
// discriminator into three flat EventType members (matching this repo's
// per-decision-point naming: before_model/after_model, before_tool/after_tool),
// so `bus.on('model_stream_delta')` subscribes to exactly one thing. Payloads
// correlate to the model request at (turnId, step) via a deterministic
// requestId (attempt-invariant: retries of one logical request share it).
// ---------------------------------------------------------------------------

/** Correlation envelope shared by all model_stream_* payloads. */
export interface ModelStreamEnvelope {
  turnId: string;
  step: number;
  /** logical model request id at (turnId, step); retry attempts share it */
  requestId: string;
}

/** model_stream_start — fired once, right before a provider.stream() iteration is consumed. */
export interface ModelStreamStartPayload extends ModelStreamEnvelope {
  model: string;
}

/**
 * model_stream_delta — one incremental chunk, fired per text/tool-call chunk:
 * text_delta (increment of finalText) or tool_call_start/delta/end (fragments
 * that consumers may accumulate; AgentLoop assembles the final arguments).
 * Terminal bookkeeping chunks (usage, message_end) do NOT fire deltas — they
 * fold into the accumulated model_stream_end payload instead.
 */
export interface ModelStreamDeltaPayload extends ModelStreamEnvelope {
  chunk: StreamChunk;
}

/** model_stream_end — fired exactly once per model_stream_start, after the stream terminates. */
export interface ModelStreamEndPayload extends ModelStreamEnvelope {
  /** accumulated assistant payload — identical to what chat() would have returned */
  finishReason: ChatFinishReason;
  text: string;
  toolCalls: ChatToolCall[];
  usage: ChatUsage;
}

export interface BeforeToolPayload {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface PolicyDecisionPayload {
  toolCallId: string;
  toolName: string;
  verdict: 'allow' | 'deny' | 'ask';
  decisionPath: string[];
  ruleRef?: string;
  reason?: string;
}

export interface AfterToolPayload {
  toolCallId: string;
  toolName: string;
  result: ToolResultRecord;
}

/** Waterfall listener return: short-circuit decision or pass-through */
export type WaterfallResult =
  | { kind: 'allow'; updatedInput?: Record<string, unknown> }
  | { kind: 'deny'; reason: string; ref?: string }
  | { kind: 'ask'; ref?: string; reason?: string }
  | { kind: 'defer' }
  | { kind: 'noop' };

export interface EventContext {
  bus?: unknown;
  onListenerError?: (type: string, listenerName: string, err: unknown) => void;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Misc shared types
// ---------------------------------------------------------------------------

export interface ToolCallPayload {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolErrorPayload {
  errorClass: 'INVALID_ARGS' | 'TOOL_FAILURE' | 'SANDBOX_DENIAL' | 'TIMEOUT' | 'DENIED' | 'UNKNOWN';
  message: string;
  detail?: Record<string, unknown>;
}
