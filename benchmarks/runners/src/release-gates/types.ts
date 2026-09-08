/**
 * task 084 — Release Gates (8 道发布门禁 + release-report).
 *
 * Shared types for the release-gate framework. A "gate" is one release
 * checkout gate (Build / Unit / Deterministic Bench / Real Model Bench /
 * Safety / Resume / UX Smoke / Packaging) with a machine judgeable criterion.
 *
 * Honesty / no self-certification (§21 "不以自证为证"):
 *  - every gate's executor returns a tri-state verdict { pass | fail | pending }
 *    plus evidence (not a bare "it works").
 *  - environment-sensitive gates (real model bench / UX smoke / packaging)
 *    PROBE the required tooling; when it is absent they return `pending` with an
 *    explicit note — they NEVER silently pass (082 lane mode).
 *  - the injected `RunCommand` boundary lets tests mock the real command path
 *    while keeping the「真实命令在非受限环境跑」seam intact.
 */
import type { ChatProvider } from '@vessel/shared';
import type { LaneModel, ProviderResolver } from '../lane/real-model-lane.js';

/** Tri-state verdict from one gate executor. */
export type GateVerdictStatus = 'pass' | 'fail' | 'pending';

/** Ordered gate registry id (mirrors docs §21 Gate 1..8). */
export type GateId =
  | 'build'
  | 'unit'
  | 'deterministic-bench'
  | 'real-model-bench'
  | 'safety'
  | 'resume'
  | 'ux-smoke'
  | 'packaging';

/** Machine evidence a gate executor collects. `urls`/`artifacts` remain optional. */
export interface GateEvidence {
  /** one-line human summary of what was judged. */
  summary: string;
  /** optional machine-readable detail lines (command exit codes, pass counts…). */
  detail?: string[];
  /** optional artifact paths produced by the gate (reports, build output…). */
  artifacts?: string[];
}

/** The judgeable result a gate executor returns (before the runner wraps it). */
export interface GateVerdict {
  status: GateVerdictStatus;
  evidence: GateEvidence;
  /** environment annotation (e.g. "no credentials → pending"), optional. */
  note?: string;
  /** when true the gate was probed-but-unavailable (pending), never a silent pass. */
  pending?: boolean;
}

/** Static definition of one gate: id + display name + the criterion being judged. */
export interface GateDefinition {
  id: GateId;
  /** short display name, e.g. "Build (tsc -b)". */
  name: string;
  /** the §21 criterion this gate enforces, human readable. */
  criterion: string;
  /** §21 gate number (1..8) for the report/MD ordering. */
  position: number;
}

/**
 * Layout options a runner passes to executors (repo/version context) so a gate
 * can resolve real paths without hard-coding. Injected by the runner.
 */
export interface ReleaseContext {
  /** repository root (absolute), used to resolve tsc/vitest/fixtures. */
  repoRoot: string;
  /** where gate artifacts/reports may be written. */
  reportsDir: string;
  /** optional version tag (e.g. "v1.0.0") surfaced in the report. */
  version?: string;
}

/** Injectable command-runner the real executors shell through. */
export type RunCommand = (
  command: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

/**
 * Injectable per-gate executor. The runner receives an array of these (so tests
 * can substitute mocks) but each real executor names a `gate` it implements so
 * the runner can label results + enforce ordering + report criteria.
 */
export interface GateExecutor {
  gate: GateDefinition;
  run(ctx: ReleaseContext & { exec: RunCommand }): Promise<GateVerdict>;
}

/**
 * Injectable provider dependencies for the model-dependent gates.
 * When no provider/resolver is present the gate PROBES and, finding none,
 * marks pending — never a silent pass (082 lane mode).
 */
export interface RealModelDeps {
  models?: LaneModel[];
  providerResolver?: ProviderResolver;
  /** direct ChatProvider injectable in tests to fake an available lane. */
  provider?: ChatProvider | null;
  /**
   * Factory producing the offline mock provider for the deterministic-bench and
   * safety gates (null → deterministic mock lane). Injectable so tests can
   * short-circuit real scenario runs.
   */
  providerFactory?: (scenarioIds: string[]) => ProviderFactoryResult;
}

/** Result of the gate provider factory — null means "use the mock lane". */
export type ProviderFactoryResult = ChatProvider | null | undefined;