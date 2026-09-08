/**
 * task 076 — Harness Adapter Contract (cross-harness).
 *
 * One contract so the SAME benchmark fixture can be run on different harnesses
 * (Vessel + external CLIs) and uniformly collect §15 L3 metrics. 077-081
 * external harness adapters implement this contract; this package ships the
 * Vessel self-adapter (see vessel.ts) proving the contract is usable & testable
 * without depending on an external harness.
 *
 * Vocabulary alignment:
 *  - `HarnessAdapter` mirrors BENCHMARK-SPEC §7.1 / §6.1 but simplifies the
 *    surface to `id/version/run(fixture)/capabilities` (task 076 shape); the
 *    existing runner keeps preparing/asserting/reporting so adapters only do
 *    "run one fixture and return one RunResult".
 *  - `RunResult` fields align to docs/Vessel路线 §15.1 L3 (success / wall time /
 *    tool calls / invalid calls / retries / tokens / cost / context peak /
 *    compactions / human intervention / policy violations / resume success).
 */

/** One benchmark fixture — a directory + a task description file to inject. */
export interface HarnessFixture {
  /** scenario / fixture id (e.g. 'B001'), used for reports & caches. */
  id: string;
  /** absolute path to the fixture workspace root (task.md + assets). */
  workspaceRoot: string;
  /** task description file relative to workspaceRoot (default 'task.md'). */
  taskFile?: string;
  /** arbitrary caller context the adapter may need (policy path, model, …). */
  options?: Record<string, unknown>;
}

/**
 * §15.1 L3 cross-harness run metrics. Every field is REQUIRED (validated by
 * validateRunResult) so all six target harnesses emit the same surface and a
 * caller can aggregate rows across harnesses without per-adapter branching.
 */
export interface RunResultMetrics {
  /** boolean success of the run (asserts pass on the runner side = 1, else 0). */
  success: boolean;
  /** wall-clock duration of the run in milliseconds. */
  wallTimeMs: number;
  /** total tool calls dispatched (initiated), incl. denied/failed. */
  toolCalls: number;
  /** parameter-validation / malformed tool call count (INVALID_ARGS class). */
  invalidCalls: number;
  /** retries (harness auto-retry + model rewrite retries, same intent ≥2nd try). */
  retries: number;
  /** cumulative input tokens across model requests (cache excluded, switchable). */
  inputTokens: number;
  /** cumulative output tokens across model requests. */
  outputTokens: number;
  /** cumulative cache-read tokens (context cache hits). */
  cacheReadTokens: number;
  /** estimated cost in USD (Σ input×price + output×price + cache×price). */
  costUsd: number;
  /** run-local context peak (max single-request input+cache read tokens). */
  contextPeak: number;
  /** number of context compactions during the run. */
  compactions: number;
  /** number of human interventions required (approval asks steered to human, steers, interrupts). */
  humanIntervention: number;
  /** count of policy violations (audit/denial: policy deny + sandbox DENIAL + never-approval deny). */
  policyViolations: number;
  /** whether the run was completed via resume of a prior session (true) or gauge N/A as false. */
  resumeSuccess: boolean | null;
}

/**
 * Result of running one fixture through a harness adapter. `metrics` carries
 * the §15 L3 surface; `artifacts` points at session logs / reports the caller
 * may persist for auditability (never the source of truth for asserts).
 */
export interface RunResult {
  /** which harness produced this result ('vessel' | 'dsh' | 'opencode' | …). */
  adapterId: string;
  /** adapter package/version that produced the result. */
  adapterVersion: string;
  /** fixture id the run belongs to (echo of HarnessFixture.id). */
  fixtureId: string;
  metrics: RunResultMetrics;
  /** ISO timestamp of when the run started. */
  startedAt: string;
  /** optional session/report artifact paths (session JSONL, summary, workspace). */
  artifacts?: { kind: string; path: string }[];
  /** adapter-provided notes about metric provenance / approximations. */
  notes?: string[];
}

/** Scenario-capability keys used to honestly mark which fixtures a harness can run. */
export type CapabilityKey =
  | 'tool_calls'
  | 'file_edit'
  | 'exec'
  | 'subagent'
  | 'mcp'
  | 'planner'
  | 'evaluator'
  | 'memory'
  | 'skill'
  | 'resume'
  | 'compaction'
  | 'policy'
  | 'matrix';

/**
 * The canonical cross-harness adapter surface (task 076). External adapters
 * (077-081) implement `run` by shelling out to their CLI / SDK and normalizing
 * into a validated RunResult; the Vessel self-adapter runs the local engine.
 *
 * `run` MUST throw on hard setup errors (fixture missing, adapter miswired) and
 * MUST return a RunResult (metrics.success=false) for run-time failures — the
 * runner never swallows a harness crash silently.
 */
export interface HarnessAdapter {
  /** stable adapter id, e.g. 'vessel' | 'dsh' | 'opencode' | 'codex' | 'pi' | 'claude-code'. */
  id: string;
  /** adapter implementation version (bump on contract-affecting changes). */
  version: string;
  /**
   * Run one fixture and return a validated RunResult. The adapter is
   * responsible for isolation (normally a temp copy of the fixture workspace).
   */
  run(fixture: HarnessFixture): Promise<RunResult>;
  /**
   * Declare which scenario capabilities this harness supports. Used to decide
   * skipped-vs-run before invoking `run` (BENCHMARK-SPEC §6.1 step 3).
   */
  capabilities: Record<CapabilityKey, boolean | 'tbd'>;
}