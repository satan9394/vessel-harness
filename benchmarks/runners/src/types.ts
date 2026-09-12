export type AssertType =
  | 'indeterminate' // declared capability gap; never contributes a passing verdict
  | 'file_content'
  | 'no_mutation'
  | 'tool_family_seen'
  | 'no_tool_family'
  | 'metric_le'
  | 'metric_ge'
  | 'run_check'
  | 'file_absent'
  | 'file_exists'
  | 'git_diff_scope'
  | 'event_seen'
  | 'record_seen'
  // --- task 075 safety benchmark pack ---
  | 'denial_seen'   // a policy/guard audit/denial record whose ruleRef/reason matches a pattern
  | 'guard_seen'    // a DENIED tool/result whose meta.guard matches a pattern (tool-layer hard enforcement)
  | 'no_executed_call' // the anchored tool call produced NO executed (non-DENIED) tool/result — "the operation really did not happen"
  | 'content_absent' // target text (final_text or file:) must NOT contain any golden substring (e.g. secret leak)
  | 'path_absent'   // a workspace-relative path must NOT exist (e.g. a suppressed exfil/leak file)
  // --- task V1.1-D: streaming / interrupt / steering / resume L1 deterministic scenarios ---
  | 'stream_seen'   // observed model_stream_delta chunks of a given kind (text|tool) with optional min/pattern
  | 'turn_interrupted' // a turn/end session record whose kind === 'interrupted' exists
  | 'steer_seen'    // a user/message record with source='steer' whose content matches a pattern
  | 'resume_seen';  // a user/message record with source='handoff' whose content matches a pattern

export interface AssertionSpec {
  type: AssertType;
  target?: string;
  golden?: string[];
  golden_expr?: string;
  json_path?: string;
  family?: string;
  metric?: string;
  limit?: number;
  command?: string;
  pattern?: string;
  include?: string;
  expected?: number;
  paths?: string[];
  /** record_seen: session record type to look for */
  record?: string;
  /** record_seen: optional record field value (e.g. source=plan) */
  source?: string;
  /** denial_seen/guard_seen: optional predicate on the enforcement stage (rule|hook|approval|sandbox|guard) */
  stage?: string;
  /**
   * denial_seen/guard_seen/no_executed_call/content_absent/path_absent: anchor to the EXACT tool call by matching
   * this regex against the JSON of the paired `tool/call` arguments (joined on
   * toolCallId). Absent ⇒ unchanged legacy behaviour. With it, the assert says
   * "THIS call to THIS path was denied" instead of "some call was denied
   * somewhere" — the difference between a real S003 criterion and a global
   * `escape` substring that any lexical `../` would also satisfy.
   *
   * For `no_executed_call` the anchor carries the whole criterion: "THIS call
   * really did not run". An unanchored `no_executed_call` therefore means "no
   * tool call at all executed" (legacy no-pattern behaviour, still fail-closed
   * on a missing attempt).
   */
  arguments_pattern?: string;
  /** stream_seen: which kind of stream chunk to inspect ('text' | 'tool') */
  kind?: string;
  /** stream_seen: minimum number of matching stream chunks (default 1) */
  min?: number;
}

export interface HiddenSpec {
  source: string;
  into: string;
  run?: string;
}

export interface PolicyOverride {
  profile?: string;
  approval?: string;
}

/** V0.2 harness wiring for a scenario (subagent / MCP / planner / evaluator). */
export interface HarnessSpec {
  subagent?: { enabled?: boolean; maxConcurrent?: number; maxDepth?: number };
  mcp?: { serverName: string }[];
  /** planner driver: generatePlan → injectPlan → executePlan */
  planner?: boolean;
  /** evaluator driver: run generator, then EvaluatorAgent reviews the output */
  evaluator?: boolean;
  /**
   * V0.4: task routing driver — compose is wired with a TaskRouter over two
   * offline mock providers (pro/fast tiers); the scenario task is classified
   * and routed to a tier. Assertions (e.g. event_seen on a marker only the
   * routed provider returns) prove the route machine-wise.
   */
  taskRouter?: { enabled?: boolean };
  /**
   * V0.5: Loop Engine driver — one full iteration (select → generate →
   * evaluate → persist) runs with deterministic mock generator/evaluator in an
   * isolated temp workspace. The reported final text carries the verdict and
   * the generator golden, asserted machine-wise.
   */
  engine?: { enabled?: boolean };
  /**
   * V1.1-D: streaming driver — the turn runs through provider.stream() and the
   * runner captures every model_stream_delta chunk (text + interleaved tool
   * calls) so `stream_seen` assertions prove text/tool interleaving
   * machine-wise rather than trusting the mock's words.
   */
  streaming?: { enabled?: boolean };
  /**
   * V1.1-D: interrupt driver — a bus listener calls loop.interrupt() at a
   * deterministic mid-turn point (after the first tool_call stream chunk), so
   * the turn closes with kind='interrupted' (turn/start → turn/end pairing
   * preserved) and `turn_interrupted` asserts the record.
   */
  interrupt?: { enabled?: boolean };
  /**
   * V1.1-D: steering driver — a bus listener enqueues a user direction-change
   * directive via loop.steer() after the first tool completes. The steer is
   * drained at the next step boundary as a user/message record (source='steer')
   * so the redirect is asserted machine-wise (interrupt = 停, steer = 改向).
   */
  steering?: { enabled?: boolean };
  /**
   * V1.1-D: resume driver — the session is seeded from a Context Reset Handoff
   * (source='handoff') before the turn runs, then the model continues from
   * handoff.next_actions. `resume_seen` asserts the handoff context record and
   * the continuation golden proves the run resumed, not started fresh.
   */
  resume?: { enabled?: boolean };
}

export interface ScenarioManifest {
  id: string;
  type: string;
  goal: string;
  fixture: string;
  task_file: string;
  hidden?: HiddenSpec;
  policy?: PolicyOverride;
  harness?: HarnessSpec;
  pass: AssertionSpec[];
  measured: string[];
  mode: string;
}

export interface AssertResult {
  id: string;
  type: AssertType;
  target: string;
  result: 'pass' | 'fail' | 'skip';
  evidence: Record<string, unknown>;
}

/**
 * 回合结束的 kind —— 与 core 循环 `TurnResult.kind` **同构**
 * （packages/core/src/agent-loop/AgentLoop.ts:60-62）。
 *
 * 这里刻意**镜像**而不是 `import type { TurnResult } from '@vessel/core'`：本包
 * package.json 的 dependencies 只有 application/llm/shared（core 是间接类型面），
 * 镜像可保持依赖面不变（本卡禁引入依赖）。漂移不是静默的：runner.ts / contracts/vessel.ts
 * 的赋值处是 `TurnOutcomeKind` 位置，core 若**新增**取值会在那里报编译错误。
 */
export type TurnOutcomeKind = 'success' | 'error' | 'interrupted' | 'budget';

export interface ScenarioReport {
  scenarioId: string;
  runId: string;
  success: boolean;
  asserts: AssertResult[];
  metrics: Record<string, number>;
  finalText: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  reportPath: string;
  workspace: string;
  sessionLog: string;
  /**
   * 本 run 报告的这次 loop 回合以什么 kind 收尾（**可选**，向后兼容：旧报告无此键）。
   *
   * 缺席 ≠ success：缺席表示该 lane 的 `finalText` **不由单次 loop turn 产出**
   * （planner / engine 是 runner 自己的模板文本），此时"回合是否正常收尾"无从谈起。
   * 绝不能把"无从谈起"写成 `'success'` —— 那正是本卡要关掉的沉默。
   */
  turnKind?: TurnOutcomeKind;
  /**
   * 显式的场景级信号：`true` ⇔ `turnKind` 存在且 !== `'success'`。
   * 与 `turnKind` 同进退（缺席表示同上的"无从谈起"，**不是** false）。
   * 判据层不因它为 true 而改判（本卡纪律：不得改变任何既有场景的通过/失败）；
   * 它的职责是让"这一轮根本没正常收尾"在报告里**可见、可判、可追溯**。
   */
  turnEndedAbnormally?: boolean;
}

/**
 * A normalized observation of one model_stream_delta chunk captured by the
 * streaming/interrupt/steering driver. Text chunks carry the incremental text;
 * tool chunks carry the tool name being streamed (interleaved with text).
 * These are live bus observations (NOT session records), so they are threaded
 * through the AssertContext rather than read from the replay.
 */
export interface StreamObservation {
  /** which stream chunk type produced this observation. */
  kind: 'text' | 'tool';
  /** text_delta content (kind='text'). */
  text?: string;
  /** tool_call_start tool name (kind='tool'). */
  toolName?: string;
}

/** Result of one scenario driver — final reported text + captured stream observations. */
export interface DriverResult {
  finalText: string;
  streamEvents: StreamObservation[];
  /**
   * 产出（或被判据/下游当作）本次 run 结果的那次 loop 回合的 kind。
   *
   * 缺席 = 本次 run 的结果不是单次 loop turn 的产物（planner 的执行模板文本、
   * engine 的 LoopRunReport 回述）；有值时必须**忠实**透传 `runTurn()` 的 kind，
   * 包括 `'error'`（熔断器打死）与 `'budget'`（步数耗尽）—— 这类回合只会把
   * 错误文案/半截文本放进 `finalText`，丢掉 kind 就等于把"这轮没跑完"当成"这轮的答案"。
   */
  turnKind?: TurnOutcomeKind;
}
