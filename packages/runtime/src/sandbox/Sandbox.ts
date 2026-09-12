import type { ConfinedArgv, SandboxStatus } from '@vessel/shared';
import { runCommand, type SpawnOptions, type SpawnResult } from '../process/Process.js';
import {
  WindowsJobObject,
  createJobObject,
  type JobObjectConfinement,
  type JobObjectLimits,
} from './backend/windows-job-object.js';
import {
  createIsolatedDirectory,
  type IsolatedDirectory,
} from './backend/isolated-directory.js';
import {
  ProcessTreeTracker,
  detectEscapes,
  type ProcessTreeAuditEvent,
  type ProcessTreeAuditKind,
  type ProcessNode,
  type ProcessTreeSnapshot,
  type EscapeDetectionReport,
  type EscapeDetectionOptions,
} from './backend/process-tree.js';

/**
 * runtime/sandbox — language-neutral confine seam (ARCHITECTURE §4.7 / D3 #9).
 *
 * Task 071: Windows Job Object backend replaces the v0.1 passthrough with a
 * real OS-level process backend:
 *
 *   - process-tree kill (ERROR_JOB): a named Job Object wraps the spawned child
 *     and `TerminateJobObject` kills grandchildren — closing the Windows gap
 *     where `child.kill` only TerminateProcess the direct child.
 *   - resource cap (best-effort): active-process cap inside the job (anti
 *     fork-bomb), OS-enforced rather than polling.
 *   - isolation directory: each confined command runs in a fresh os.tmpdir
 *     subfolder (never the main workspace), cleaned via recycle bin on dispose.
 *   - honest status: `status()` reports `enabled:true active:true
 *     backend:'job-object'` only when the backend is genuinely active — no
 *     "looks enabled, actually passthrough" (roadmap §13.3).
 *
 * Deliberate scope boundary: cannot safely create a Windows restricted-token /
 * low-integrity drop from a TS/PowerShell path without a native helper (no Rust
 * toolchain installed). That capability is NOT claimed; the backend reports the
 * delivered subset, and 072 (process-tree) / 073 (filesystem) remain separate
 * cards.
 *
 * Sidecar relationship (070): the sandbox stays a TS-native runtime backend, NOT
 * a sidecar protocol method. Reasons: (a) no Rust sidecar binary exists to host
 * `sandbox.confine`; (b) the seam's `confine(argv)` only augments argv and
 * cannot attach a job handle to an already-spawned child — mechanism-level
 * confinement must live at the spawn site (`runCommand`), which is TS. The
 * sidecar `SidecarMethod.SandboxConfine` placeholder remains declared but
 * unwired; when a native sidecar ships, `confine` can forward here.
 */

export interface SandboxLimits {
  /** max active processes permitted inside the confined job (anti fork-bomb). */
  maxActiveProcesses?: number;
  /** per-process CPU time budget in ms (best-effort, OS-enforced when applied). */
  maxProcessTimeMs?: number;
  /** per-process working-set ceiling in bytes (soft target, best-effort). */
  maxWorkingSetBytes?: number;
  /**
   * task 072 tree-escape hard response: when a live descendant is found running
   * outside the confined set, terminate it. Off by default (audit-only).
   */
  terminateEscaped?: boolean;
  /**
   * task 072 timing-window closure: after attaching the root, enumerate current
   * descendants and pull them into the job too (catches pre-attach grandchildren
   * that the 071 holder could not retroactively include). Default true.
   */
  closeTimingWindow?: boolean;
}

/** Dependency slice injected by tests so the enforcement logic is unit-testable. */
export interface SandboxDeps {
  platform?: NodeJS.Platform;
  createJob?: (
    pid: number,
    limits: JobObjectLimits,
  ) => Promise<JobObjectConfinement>;
  makeIsolatedDir?: () => Promise<IsolatedDirectory>;
  /** job-owned OS helpers (descendant enumeration + attach) — injectable for tests. */
  enumerateDescendants?: (rootPid: number) => Promise<number[]>;
  attachPidsToJob?: (jobName: string, pids: number[]) => Promise<number>;
  /**
   * hard escape-response terminator (defaults to TerminateProcess via PowerShell).
   * Returns the pids that were **verified terminated** — a pid that could not be
   * opened/terminated is NOT part of the result, so the audit can tell the truth.
   */
  terminatePids?: (pids: number[]) => Promise<number[]>;
  /**
   * degradation reporter (plain-function injection, no `vi.fn`/mock restore).
   * Defaults to `console.warn`; tests inject a recorder to keep output clean.
   */
  warn?: (message: string) => void;
}

/**
 * Why confinement is NOT actually in force, when it isn't. This is the field
 * that makes a silent degradation visible: `active` is never true unless the
 * backend genuinely attached.
 *
 *  - `job-object-not-attempted`     → nothing has been confined yet on this instance
 *  - `job-object-attach-failed`     → the job factory threw (this command ran unconfined)
 *  - `job-object-target-exited`     → the target was ALREADY gone when the holder
 *    finished compiling, so there was nothing left to confine. This is NOT an
 *    attach failure: it is not warned about (`degradeJobObject` is never called
 *    for it) but it IS surfaced here, because "confinement was not in force for
 *    that command" has to stay visible and accurate. It is the normal outcome
 *    for a short-lived command — the holder's `Add-Type` compile takes 1–10 s
 *    and happens after the child spawns (`windows-job-object.ts`).
 *  - `job-object-unavailable`       → the platform has no Job Object backend (linux/darwin)
 */
export type ConfinementDegradeReason =
  | 'job-object-not-attempted'
  | 'job-object-attach-failed'
  | 'job-object-target-exited'
  | 'job-object-unavailable';

/** A confinement session: a fresh isolation cwd + a lazily-attached kill handle. */
export interface ConfinementSession {
  cwd: string;
  /** attach the spawned child's pid to the Job Object (for whole-tree kill). */
  attach(pid: number): Promise<void>;
  /** terminate the job tree + recycle the isolation dir. Idempotent. */
  dispose(): Promise<void>;
  /** recorded process tree (task 072 auditability). */
  tree(): ProcessTreeSnapshot;
  /** append-only audit trail of tree events (task 072 auditability). */
  audit(): ProcessTreeAuditEvent[];
}

export class Sandbox {
  private readonly platform: NodeJS.Platform;
  private readonly createJob: NonNullable<SandboxDeps['createJob']>;
  private readonly makeIsolatedDir: NonNullable<SandboxDeps['makeIsolatedDir']>;
  private readonly enumerateDescendants: NonNullable<SandboxDeps['enumerateDescendants']>;
  private readonly attachPidsToJob: NonNullable<SandboxDeps['attachPidsToJob']>;
  private readonly terminatePids: NonNullable<SandboxDeps['terminatePids']>;
  private readonly warn: NonNullable<SandboxDeps['warn']>;
  /**
   * Did the Job Object backend ACTUALLY attach? `statusSnapshot()` reads this —
   * never the platform alone. `false` until an attach for the current round has
   * really succeeded.
   */
  private jobAttached = false;
  /** why confinement is not in force (undefined when it is). */
  private degraded?: ConfinementDegradeReason;
  /** human-readable degradation detail (the caught error message). */
  private degradedDetail?: string;
  /**
   * Warn de-duplication (BRIEF §③): one Sandbox instance == one session in
   * `compose.ts`, so each degradation REASON is announced on stderr at most once
   * per session instead of once per command. Before this, a session that ran ten
   * short commands printed ten identical "sandbox degraded" lines and the actual
   * signal ("confinement is not in force") drowned in its own noise.
   *
   * Nothing is lost by de-duplicating: the LATEST detail always stays readable
   * in `statusSnapshot().fallbackReason` (and the CLI prints it), so the newest
   * cause is visible even when its warning line was suppressed.
   */
  private readonly warnedDegradations = new Set<ConfinementDegradeReason>();

  constructor(deps: SandboxDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.createJob = deps.createJob ?? createJobObject;
    this.makeIsolatedDir = deps.makeIsolatedDir ?? createIsolatedDirectory;
    this.enumerateDescendants =
      deps.enumerateDescendants ?? ((pid) => WindowsJobObject.enumerateDescendants(pid));
    this.attachPidsToJob =
      deps.attachPidsToJob ?? ((job, pids) => WindowsJobObject.attachPidsToJob(job, pids));
    this.terminatePids = deps.terminatePids ?? ((pids) => WindowsJobObject.terminatePids(pids));
    this.warn = deps.warn ?? ((message: string) => console.warn(message));
  }

  /** Backend kind configured on this platform. */
  private backendFor(): SandboxStatus['supported'] {
    if (WindowsJobObject.isSupported(this.platform)) return 'windows-job-object';
    return this.platform === 'darwin' ? 'macos-seatbelt' : 'linux-bwrap';
  }

  /**
   * Whether confinement CAN be attempted on this platform (precondition gate for
   * `attach`). This is deliberately NOT the same question as "is confinement
   * actually in force" — that one is answered by {@link statusSnapshot} from the
   * recorded attach outcome, never from the platform alone.
   */
  private canAttempt(): boolean {
    return WindowsJobObject.isSupported(this.platform);
  }

  /** Reset the round-scoped confinement fact (called when a round opens). */
  private beginRound(): void {
    this.jobAttached = false;
    this.degraded = undefined;
    this.degradedDetail = undefined;
  }

  /** Record a REAL attach success — the only thing that may turn `active` true. */
  private markJobAttached(): void {
    this.jobAttached = true;
    this.degraded = undefined;
    this.degradedDetail = undefined;
  }

  private jobUnavailableReason(): ConfinementDegradeReason {
    return WindowsJobObject.isSupported(this.platform)
      ? 'job-object-not-attempted'
      : 'job-object-unavailable';
  }

  /**
   * Record a REAL confinement failure (degradation is kept — commands still run —
   * but it is no longer silent: the status reflects it and a warn carries the
   * cause). The warn fires once per reason per Sandbox instance (= per session);
   * see {@link warnedDegradations}.
   */
  private degradeJobObject(detail: string): void {
    this.jobAttached = false;
    this.degraded = 'job-object-attach-failed';
    this.degradedDetail = detail;
    if (this.warnedDegradations.has('job-object-attach-failed')) return;
    this.warnedDegradations.add('job-object-attach-failed');
    this.warn(
      `[vessel] sandbox degraded: windows job object attach failed (${detail}) — this command runs with NO process-tree confinement (direct-child kill only)`,
    );
  }

  /**
   * Record a NON-alarming outcome: the target PID was already gone before the
   * job could be attached (errno 87 — the normal case for a short-lived command).
   * There is nothing left to confine, so this is deliberately NOT routed through
   * {@link degradeJobObject}: no stderr warning, no `job-object-attach-failed`.
   * It only makes the status tell the truth (`active:false`,
   * `degraded:'job-object-target-exited'`), which the CLI surfaces.
   *
   * Safety direction: this must NOT swallow a real failure. It is reached only
   * when the backend explicitly answered `attached:false, reason:'target-exited'`
   * (errno 87 = the PID does not exist); errno 5 (access denied), a holder error
   * and a timeout all still throw and degrade loudly.
   */
  private noteTargetExited(): void {
    this.jobAttached = false;
    this.degraded = 'job-object-target-exited';
    this.degradedDetail = undefined;
  }

  status(): SandboxStatus {
    return this.statusSnapshot();
  }

  /**
   * HONEST status: `active`/`enabled` are true only when the Job Object backend
   * genuinely attached — the platform gate alone is never enough. When it did
   * not, `degraded` carries the machine-readable reason and `fallbackReason`
   * the human one, so a silent downgrade ("looks enabled, actually passthrough")
   * is impossible.
   */
  statusSnapshot(): SandboxStatus {
    const supported = this.backendFor();
    const active = this.jobAttached;
    const degraded = active ? undefined : (this.degraded ?? this.jobUnavailableReason());
    const fallbackReason =
      degraded === 'job-object-unavailable'
        ? `${supported} backend not active on this platform; confine is passthrough`
        : degraded === 'job-object-attach-failed'
          ? `windows job object attach FAILED${this.degradedDetail ? ` (${this.degradedDetail})` : ''}; this run had no process-tree confinement`
          : `windows job object backend not attached yet; confinement engages per command (restricted-token not implemented, see task 071)`;
    return {
      enabled: active,
      supported,
      active,
      backend: active ? 'job-object' : 'none',
      degraded,
      fallbackReason,
    };
  }

  /**
   * v0.1+ seam kept for compatibility: reports the enforcement the backend will
   * provide for a command. Doesn't spawn anything; consumers that want real
   * confinement should use `run()` / `openConfinement()`.
   */
  async confine(argv: string[], _policyHint?: Record<string, unknown>): Promise<ConfinedArgv> {
    if (!this.canAttempt()) {
      return {
        argv,
        enforcement: 'partial',
        reason: this.statusSnapshot().fallbackReason,
      };
    }
    if (this.degraded === 'job-object-attach-failed') {
      // a real attach already failed: do not keep claiming 'full'.
      return {
        argv,
        enforcement: 'partial',
        reason: this.statusSnapshot().fallbackReason,
      };
    }
    return { argv, enforcement: 'full', reason: 'windows-job-object backend' };
  }

  /**
   * Open a confinement session for a process the caller will spawn itself:
   * returns a fresh isolation cwd + an `attach(pid)` that pulls the child into a
   * Job Object + `dispose()` that kills the tree and recycles the dir. Task 072:
   * the session also tracks the process tree (enumerable + auditable) and, on
   * attach, closes the 071 timing window by pulling pre-attach descendants into
   * the job.
   */
  async openConfinement(limits?: SandboxLimits): Promise<ConfinementSession> {
    const attemptable = this.canAttempt();
    this.beginRound();
    const isolation = await this.makeIsolatedDir();
    const jobFactory = this.createJob;
    const enumerateDescendants = this.enumerateDescendants;
    const attachPidsToJob = this.attachPidsToJob;
    const runEscapeDetection = this.runEscapeDetection.bind(this);
    const degradeJobObject = this.degradeJobObject.bind(this);
    const markJobAttached = this.markJobAttached.bind(this);
    const tree = new ProcessTreeTracker();
    let job: JobObjectConfinement | null = null;
    let disposed = false;

    /** Confined pid set: root + everything positively attached to the job. */
    const confined = new Set<number>();

    return {
      cwd: isolation.path,
      async attach(pid: number): Promise<void> {
        if (!attemptable || disposed || job) return;
        tree.registerNode(pid);
        try {
          job = await jobFactory(pid, {
            maxActiveProcesses: limits?.maxActiveProcesses,
            maxProcessTimeMs: limits?.maxProcessTimeMs,
            maxWorkingSetBytes: limits?.maxWorkingSetBytes,
          });
          // the job handle exists only once the factory resolved ⇒ confinement is
          // genuinely in force for this round (status must say so).
          markJobAttached();
          confined.add(pid);
          // close the 071 timing window: pre-attach grandchildren are not in the
          // job yet, so enumerate current descendants and pull them in.
          const descendants = await enumerateDescendants(pid);
          if (limits?.closeTimingWindow !== false && descendants.length > 0) {
            for (const d of descendants) {
              tree.registerNode(d, pid);
              const n = await attachPidsToJob(job.jobName, [d]);
              if (n > 0) {
                confined.add(d);
                tree.record('attached', `timing-window descendant pid ${d} pulled into job`, d);
              }
            }
            tree.record('window-closed', `closed timing window for root pid ${pid} (${descendants.length} descendants)`, pid);
          }
        } catch (err) {
          // degrade: direct-child kill still works via runCommand — but the
          // degradation is recorded + warned, never silent.
          job = null;
          degradeJobObject(err instanceof Error ? err.message : String(err));
        }
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        // tree-escape detection (hard enforcement when limits.terminateEscaped).
        if (attemptable && job && tree.root !== undefined) {
          await runEscapeDetection(tree, confined, limits);
        }
        if (job) await job.dispose();
        // mark remaining recorded nodes as exited so the audit trail is honest.
        for (const n of tree.nodesList()) {
          if (n.alive) tree.markExit(n.pid);
        }
        await isolation.dispose();
      },
      tree: () => tree.snapshot(),
      audit: () => tree.auditLog(),
    };
  }

  /**
   * Run a command fully confined on Windows: fresh isolation dir as cwd +
   * TMP/TEMP, process tree attached to a Job Object so timeout / 050 abort kill
   * the whole tree, and automatic cleanup. Returns the spawn result plus an
   * honest status snapshot.
   */
  async run(
    command: string,
    args: string[],
    opts: Omit<SpawnOptions, 'cwd' | 'confinement' | 'onSpawn'> & {
      cwd?: string;
      limits?: SandboxLimits;
      shell?: boolean;
    } = {},
  ): Promise<
    SpawnResult & {
      sandbox: SandboxStatus;
      processTree: ProcessTreeSnapshot;
      audit: ProcessTreeAuditEvent[];
    }
  > {
    // round-scoped honest state: the status returned below reflects THIS spawn.
    const attemptable = this.canAttempt();
    this.beginRound();
    const isolateEnv = attemptable;
    const isolation = await this.makeIsolatedDir();
    const jobFactory = this.createJob;
    const tree = new ProcessTreeTracker();
    const confined = new Set<number>();
    // holder object (not a bare let) so TS control-flow doesn't narrow `current`
    // to null — the assignment happens inside the onSpawn callback.
    const holder: { current: JobObjectConfinement | null } = { current: null };
    const attachHolder: { promise: Promise<void> | null } = { promise: null };
    const guard = {
      terminate: (): Promise<void> =>
        holder.current ? holder.current.terminate() : Promise.resolve(),
    };

    const attachRootAndWindow = async (pid: number): Promise<void> => {
      tree.registerNode(pid, undefined, command);
      let j: JobObjectConfinement;
      try {
        j = await jobFactory(pid, {
          maxActiveProcesses: opts.limits?.maxActiveProcesses,
          maxProcessTimeMs: opts.limits?.maxProcessTimeMs,
          maxWorkingSetBytes: opts.limits?.maxWorkingSetBytes,
        });
      } catch (err) {
        // degrade — but say so: status goes non-active and a warn carries the cause.
        holder.current = null;
        this.degradeJobObject(err instanceof Error ? err.message : String(err));
        return;
      }
      holder.current = j;
      // the job handle resolved ⇒ confinement is genuinely in force for this run
      this.markJobAttached();
      confined.add(pid);
      // close the 071 timing window: pull pre-attach descendants into the job.
      if (opts.limits?.closeTimingWindow !== false) {
        const descendants = await this.enumerateDescendants(pid);
        if (descendants.length > 0) {
          for (const d of descendants) {
            tree.registerNode(d, pid);
            const n = await this.attachPidsToJob(j.jobName, [d]);
            if (n > 0) {
              confined.add(d);
              tree.record('attached', `timing-window descendant pid ${d} pulled into job`, d);
            }
          }
          tree.record('window-closed', `closed timing window for root pid ${pid}`, pid);
        }
      }
    };

    const result = await runCommand(command, args, {
      cwd: opts.cwd ?? isolation.path,
      env: {
        ...opts.env,
        ...(isolateEnv ? { TMP: isolation.path, TEMP: isolation.path, TMPDIR: isolation.path } : {}),
      },
      timeoutMs: opts.timeoutMs,
      maxOutputBytes: opts.maxOutputBytes,
      shell: opts.shell,
      signal: opts.signal,
      confinement: guard,
      onSpawn: ({ pid }) => {
        if (attemptable && pid != null) attachHolder.promise = attachRootAndWindow(pid);
      },
    });
    // wait for the async attach (job create + timing-window closure) to settle so
    // the audit/escape view reflects the real confinement state before dispose.
    if (attachHolder.promise) await attachHolder.promise.catch(() => undefined);
    if (holder.current && tree.root !== undefined) {
      await this.runEscapeDetection(tree, confined, opts.limits);
    }
    if (holder.current) await holder.current.dispose();
    for (const n of tree.nodesList()) {
      if (n.alive) tree.markExit(n.pid);
    }
    await isolation.dispose();
    return {
      ...result,
      sandbox: this.statusSnapshot(),
      processTree: tree.snapshot(),
      audit: tree.auditLog(),
    };
  }

  /**
   * task 072 tree-escape detection: re-enumerate the CURRENT live descendants
   * of the confined root and flag any that are not in the positively-confined
   * set. Records audit entries; when `limits.terminateEscaped` is set, hard
   * terminates them via a fresh job-terminate (mechanism-level enforcement).
   *
   * Honest accounting (task 072 audit truthfulness): only the pids the
   * terminator reports as **actually terminated** are recorded as
   * `escape-terminated`; every remaining escaped pid gets an explicit
   * `escape-terminate-failed` entry. "We tried" is never recorded as "it is dead".
   */
  private async runEscapeDetection(
    tree: ProcessTreeTracker,
    confined: Set<number>,
    limits?: SandboxLimits,
  ): Promise<void> {
    if (tree.root === undefined) return;
    const rootPid = tree.root;
    const live = await this.enumerateDescendants(rootPid);
    const report = await detectEscapes(rootPid, live, confined, {
      terminateEscaped: limits?.terminateEscaped ?? false,
      terminate: async (pids) => {
        // Hard response: TerminateProcess each escaped pid directly. Terminating
        // the whole job would also kill the confined root, so we target only the
        // escaped processes — mechanism-level, pid-scoped enforcement.
        // The terminator answers with the VERIFIED-success set, never a count.
        return await this.terminatePids(pids);
      },
    });
    for (const pid of report.escapedPids) {
      tree.record('escape-detected', `pid ${pid} running outside confined set (escaped)`, pid);
    }
    const verified = new Set(report.terminatedPids);
    for (const pid of report.terminatedPids) {
      tree.record('escape-terminated', `pid ${pid} terminated (tree escape)`, pid);
    }
    for (const pid of report.escapedPids) {
      if (verified.has(pid)) continue;
      // still alive (or never verified dead) — the audit must NOT claim otherwise.
      tree.record(
        'escape-terminate-failed',
        `pid ${pid} NOT verified terminated (still alive / termination failed) — escape response incomplete`,
        pid,
      );
    }
  }
}

/** Re-exports so consumers can build their own job handles if needed. */
export { WindowsJobObject, createJobObject };
export type { JobObjectConfinement, JobObjectLimits, SpawnResult, SpawnOptions };
export {
  ProcessTreeTracker,
  detectEscapes,
  type ProcessNode,
  type ProcessTreeAuditEvent,
  type ProcessTreeAuditKind,
  type ProcessTreeSnapshot,
  type EscapeDetectionReport,
  type EscapeDetectionOptions,
};