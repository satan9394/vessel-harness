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

/**
 * B13 `llm/retry` 的错误类别词表。
 *
 * 取值**逐字来自 `AgentLoop.classifyModelError` 的既有分类**（不新增分类、不改分类结果），
 * 与实时总线事件 `llm_retry` 载荷的 `errorClass` 同值。
 *
 * ⚠ 这不是 A11 `ModelError` 的 `kind` 词表（EVENT-SPEC §5.C A11：
 * `'EMPTY_RESPONSE'|'RATE_LIMIT'|'SERVER'|'TIMEOUT'|'TRANSPORT'|...`）——本仓的模型错误
 * 分类器用的是下面这一组。B13 规格把该字段命名为 `kind`，故记录字段名沿用 `kind`，
 * 两套词表**不得互相代入**。
 */
export type ModelRetryKind = 'RATE_LIMITED' | 'TIMEOUT' | 'SERVER_ERROR' | 'NETWORK' | 'UNKNOWN';

/**
 * B13 `llm/retry` —— 每次重试决策在等待前落盘（**先持久后等待**）。
 *
 * 规格原文（`docs/EVENT-SPEC.md` §6「自动持久记录清单」B13 行）：
 *   > **B13 `llm/retry`** —— 每次重试决策在等待前落盘（先持久后等待）：
 *   > `{requestId, kind, attemptNo, backoffMs, decision:'retry'|'fallback'|'abort'}`。
 * 同文件 §3 原则 5 亦为：「重试（`llm/retry`）、压缩（`compaction/start` 锁）、审批（`approval/asked`）
 * 都在等待/执行前先落日志，崩溃不留隐形待办」。
 * A11 重试纪律（§5.C）：rate_limit/overloaded/server/timeout/transport/empty 可重试；
 * 「**先持久后等待**：等待前先落 `llm/retry` 记录」。
 *
 * 形状说明（每个字段都取实现里**已有**的信息，不发明语义）：
 *  - `requestId` —— 冻结请求的确定性 id（`req_<turnId>_step<step>`），同一次逻辑请求的各 attempt
 *    共享（与 `model_stream_*` 事件族同一个 id）。
 *  - `kind` —— `classifyModelError` 的既有分类（= 总线 `llm_retry` 载荷的 `errorClass`）。
 *  - `attemptNo` —— 该次失败的 attempt 序号（1-based，与总线事件 `attempt` 同值）。
 *  - `backoffMs` —— **仅 `decision:'retry'` 时出现**：等待前算出的退避毫秒数。终止决策没有等待，
 *    键**省略**（写 0 会冒充「等过 0ms」）。
 *  - `decision` —— 该次重试决策：`'retry'` = 确实会重试；`'abort'` = 终止（不可重试的错误类别，
 *    或重试预算耗尽）。`'fallback'` 是规格词表里的取值，本仓 AgentLoop 无 fallback chain ⇒
 *    当前**不产出**该值（词表不窄化，以免将来接线 fallback 时要改记录形状）。
 */
export interface LlmRetryRecord extends SessionRecordBase {
  type: 'llm/retry';
  requestId: string;
  kind: ModelRetryKind;
  attemptNo: number;
  backoffMs?: number;
  decision: 'retry' | 'fallback' | 'abort';
  surface: false;
}

/**
 * B12 `request/header` —— 每个冻结请求的持久镜像（模型身份 + 上下文体量）。
 *
 * 规格原文（`docs/EVENT-SPEC.md` §6「自动持久记录清单」B12 行）：
 *   > **B12 `request/header`** —— 每个冻结请求的全量 envelope（system/messages/tools/配置/
 *   > 适配器默认值），可 `foldRequestHeader` 重建请求；「模型可见 ⟺ 已记录」不变式落点。
 * 触发时机（§5.C A08 ModelRequest）：请求**已冻结**、即将调用 `ctx.llm.stream` 时
 * （BeforeModel 全部修改完成后）。
 *
 * ⚠ 规格字面要求落「**全量** envelope（system/messages/tools/…）」，与本记录**只落最小集**
 * 存在已知冲突，按裁决**只上报不擅自实现**（体积：每个 step 一行全量 messages，日志随上下文
 * 体积近似平方级膨胀；隐私：messages 含用户输入与工具结果原文，等于把会话正文再抄一份；
 * 兼容：既有 session 文件的行形状/消费方假设会被撑大）。故本记录只承载**规格已点名的
 * 模型 id 与规模信息**，不落任何 messages/system/tools 正文。
 *
 * 逐字段取值（都是实现里**已有**的值，不做估算、不推断、不编造）：
 *  - `requestId`/`turnId`/`step` —— 相关信封（与 `model_stream_*` 事件族同形；`requestId` 是
 *    冻结请求的确定性 id）。
 *  - `provider`/`model` —— `ChatProvider.id` 与冻结 envelope 的 `model`（后者 = `before_model`
 *    事件载荷里的**同一个值**，也就是真正发给 provider 的 `ChatRequest.model`）。
 *  - `estimateTokens` —— `RequestEnvelope.estimateTokens`（ContextBuilder 组装时算出的既有估计）。
 *  - `messageCount`/`toolCount` —— 被省略的 `messages`/`tools` 的**条数**（整数，无内容）。
 *  - `contextWindow`（A07 载荷里的窗口大小）、`system` 分层、`tools` schema、`temperature`/
 *    `maxTokens` 等配置 —— **不落**：AgentLoop 在冻结点拿不到它们（属 ContextBuilder/组合根内部），
 *    如实缺失，绝不拿估算值冒充。
 */
export interface RequestHeaderRecord extends SessionRecordBase {
  type: 'request/header';
  requestId: string;
  turnId: string;
  step: number;
  provider: string;
  model: string;
  estimateTokens: number;
  messageCount: number;
  toolCount: number;
  surface: false;
}

/**
 * B19 `audit/decision` —— `PolicyDecision`(A13) 的**持久镜像**（verdict + decisionPath 决策轨迹）。
 *
 * **当前状态：已登记、未接线（保留）** —— 全仓**零生产者、零消费者**：
 *  - 生产者 0：没有任何 `session.appendSync({ type: 'audit/decision', … })`。A13 `policy_decision`
 *    事件只有一处 emit（`packages/core/src/agent-loop/AgentLoop.ts` 的 `recordDenial`），而且它
 *    **只在拒绝时**发、`verdict` 恒为 `'deny'` ⇒ "allow 也落一份决策镜像"这条规格语义没有实现；
 *  - 消费者 0：`Telemetry.finalizeRecord` 没有这个 `case`，没有任何回放/UI/conformance 读它；
 *    仓里仅有的两处提及是**反向断言**（`AgentLoop.before-stop-verdict.test.ts` 与
 *    `AgentLoop.llm-retry-record.test.ts` 各断言"本会话里 `audit/decision` 有 0 条"），
 *    即用它的缺席当负对照，不是消费。
 *
 * 为什么**保留而不是删除**：它是 `docs/EVENT-SPEC.md` §5.A A13/§6 B19 与
 * `docs/POLICY-SPEC.md` §7.2 写明的契约（"每次走策略链的调用恰好一次 PolicyDecision(A13)
 * + audit/decision(B19)"，供审计/UI 透明展示/conformance 校验）。删类型会让未来接线的人
 * 丢掉契约；把它标成"已接线"则会让读文档的人以为有这条证据链——两者都是撒谎。
 *
 * 为什么本卡**不接线**：生产者必须落在 `AgentLoop`（`packages/core/**`）——那正是本卡的禁改面
 * （放宽 deny-only 的 A13 语义属产品决策，见 `docs/product-evolution/PRODUCT-STATE.md`）。
 * **v1 口径已拍定（2026-09-18，task 135）：决策镜像只记 deny** —— 本记录**不接线**；
 * 把"allow 也落一份"登记为**未来可选增强（须先有消费方：审计 UI / conformance / 回放）**，
 * 属 core 运行时语义变更，须独立卡 + 独立评审。见 `docs/POLICY-SPEC.md` §2.5、`docs/EVENT-SPEC.md` B19。
 * 可执行守卫：`packages/shared/src/unwiredRecords.test.ts`（一旦有人接线，该用例先红）。
 */
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
   * **两个值当前无生产者（本卡逐条复核，值一律保留、不删）**：
   *  - `'sandbox'`：全仓没有任何 `audit/denial` 的铸造点会传它。仅有的两个落点分别是
   *    `AgentLoop.recordDenial(...)`（调用处只传 `'rule'|'hook'|'approval'`，见
   *    `packages/core/src/agent-loop/AgentLoop.ts` 的 `fromListenerError ? 'hook' : 'rule'` 与
   *    ask 分支的 `'approval'`）与 `AgentLoop.recordTurnDenial(...)`（恒传 `'before_turn'`）。
   *    沙箱层的事实走的是**另一条记录形状**：DENIED 的 `tool/result` +
   *    `meta.guard`（`packages/tools/src/filesystem/fsTools.ts` 三处），以及 M12 规格里那个
   *    "保留但未接线"的 `errorClass:'SANDBOX_DENIAL'`（`packages/telemetry/src/auditRecordWiring.test.ts`
   *    把它钉成"零铸造点"）。本字段的 `sandboxMode` 另行填写，与本词表取值不是一回事。
   *  - `'guard'`：guard 阶段的拒绝**只铸 DENIED 的 `tool/result`**（`meta.guard`，
   *    同上 fsTools.ts 三处），**不铸 `audit/denial`** —— 这点由判据层逐字记录在案：
   *    `benchmarks/runners/src/asserts.ts` 的 `denial_seen` 分支写明"`stage: 'guard'` reads the
   *    DENIED `tool/result` instead: the guard stage is the only stage that never mints an
   *    audit/denial record"，`guard_seen` 判据因此直接读 `tool/result`。
   *  为什么**保留而不是删除**：它们是 `docs/EVENT-SPEC.md` §6 的 B20 词表与
   *  `docs/POLICY-SPEC.md` §7.2 的契约（沙箱拒绝/工具层守卫同样是"拒绝终态所在阶段"）；
   *  删值会让未来接线的人丢掉契约（且会让 `stage` 联合与两份规格静默分叉），
   *  而把"无生产者"写进注释既不删值也不冒充证据链。接线时请一并改本段。
   *  **可执行守卫**：`packages/shared/src/unwiredRecords.test.ts` 的
   *  「AuditDenialRecord.stage —— 有类型、无生产者：sandbox / guard」那组从头抽本联合、
   *  扫描全仓铸造语句，断言"生产者只产出其中 4 个"（rule/hook/approval/before_turn）并把
   *  上面这段话的两句标注逐字钉住 —— 谁给这两个值加了生产者，那组用例先红。
   *
   * 注意：这条词表与 `PolicyDecision.decisionPath[].stage`
   * （`'rule'|'hook'|'guard'|'approval'|'profile'`，EVENT-SPEC §5.A A13）是**两个不同的词表**，
   * 不要互相代入（`'guard'` 在**那张**表里是有生产者的）。
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
  | RequestHeaderRecord
  | LlmRetryRecord
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
