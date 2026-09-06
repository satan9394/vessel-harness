/**
 * @cah/shared — event vocabulary (v0.1 subset of EVENT-SPEC).
 *
 * Two domains per DESIGN-DECISIONS D3 / EVENT-SPEC:
 *  - persistent session records (B##) -> append-only JSONL log, single source of truth
 *  - live extension events (A##) -> emit / waterfall decision points
 */

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

export interface UserMessageRecord extends SessionRecordBase {
  type: 'user/message';
  msgId: string;
  role: 'user';
  content: string;
  source?: 'user' | 'inject' | 'instruction' | 'compacted-summary' | 'plan' | 'memory';
  surface: true;
}

export interface AssistantMessageRecord extends SessionRecordBase {
  type: 'assistant/message';
  msgId: string;
  role: 'assistant';
  content: string;
  surface: true;
}

export interface AssistantAttemptRecord extends SessionRecordBase {
  type: 'assistant/attempt';
  msgId: string;
  content: string;
  toolCalls: ToolCallPayload[];
  attemptNo: number;
  surface: false;
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
  };
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
  toolCallId: string;
  toolName: string;
  stage: 'rule' | 'hook' | 'approval' | 'sandbox' | 'guard';
  ruleRef?: string;
  reason: string;
  sandboxMode?: string;
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

/** B10 session/created — session lifecycle record (V0.2: subagent/evaluator/plan sources) */
export interface SessionCreatedRecord extends SessionRecordBase {
  type: 'session/created';
  sessionId: string;
  source: 'startup' | 'resume' | 'fork' | 'clear' | 'compact' | 'subagent' | 'evaluator' | 'plan';
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
  | 'after_delegate';

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
