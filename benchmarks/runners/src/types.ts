export type AssertType =
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
  | 'record_seen';

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
}
