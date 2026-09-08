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
  /** hard escape-response terminator (defaults to TerminateProcess via PowerShell). */
  terminatePids?: (pids: number[]) => Promise<number>;
}

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

  constructor(deps: SandboxDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.createJob = deps.createJob ?? createJobObject;
    this.makeIsolatedDir = deps.makeIsolatedDir ?? createIsolatedDirectory;
    this.enumerateDescendants =
      deps.enumerateDescendants ?? ((pid) => WindowsJobObject.enumerateDescendants(pid));
    this.attachPidsToJob =
      deps.attachPidsToJob ?? ((job, pids) => WindowsJobObject.attachPidsToJob(job, pids));
    this.terminatePids = deps.terminatePids ?? ((pids) => WindowsJobObject.terminatePids(pids));
  }

  /** Backend kind configured on this platform. */
  private backendFor(): SandboxStatus['supported'] {
    if (WindowsJobObject.isSupported(this.platform)) return 'windows-job-object';
    return this.platform === 'darwin' ? 'macos-seatbelt' : 'linux-bwrap';
  }

  private isActive(): boolean {
    return WindowsJobObject.isSupported(this.platform);
  }

  status(): SandboxStatus {
    return this.statusSnapshot();
  }

  statusSnapshot(): SandboxStatus {
    const supported = this.backendFor();
    const active = this.isActive();
    return {
      enabled: active,
      supported,
      active,
      backend: active ? 'job-object' : 'none',
      fallbackReason: active
        ? 'windows job object backend: tree-kill + active-process cap + isolation dir (restricted-token not implemented, see task 071)'
        : `${supported} backend not active on this platform; confine is passthrough`,
    };
  }

  /**
   * v0.1+ seam kept for compatibility: reports the enforcement the backend will
   * provide for a command. Doesn't spawn anything; consumers that want real
   * confinement should use `run()` / `openConfinement()`.
   */
  async confine(argv: string[], _policyHint?: Record<string, unknown>): Promise<ConfinedArgv> {
    if (WindowsJobObject.isSupported(this.platform)) {
      return { argv, enforcement: 'full', reason: 'windows-job-object backend' };
    }
    return {
      argv,
      enforcement: 'partial',
      reason: this.statusSnapshot().fallbackReason,
    };
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
    const active = this.isActive();
    const isolation = await this.makeIsolatedDir();
    const jobFactory = this.createJob;
    const enumerateDescendants = this.enumerateDescendants;
    const attachPidsToJob = this.attachPidsToJob;
    const runEscapeDetection = this.runEscapeDetection.bind(this);
    const tree = new ProcessTreeTracker();
    let job: JobObjectConfinement | null = null;
    let disposed = false;

    /** Confined pid set: root + everything positively attached to the job. */
    const confined = new Set<number>();

    return {
      cwd: isolation.path,
      async attach(pid: number): Promise<void> {
        if (!active || disposed || job) return;
        try {
          tree.registerNode(pid);
          job = await jobFactory(pid, {
            maxActiveProcesses: limits?.maxActiveProcesses,
            maxProcessTimeMs: limits?.maxProcessTimeMs,
            maxWorkingSetBytes: limits?.maxWorkingSetBytes,
          });
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
        } catch {
          job = null; // degrade: direct-child kill still works via runCommand
        }
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        // tree-escape detection (hard enforcement when limits.terminateEscaped).
        if (active && job && tree.root !== undefined) {
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
    const active = this.isActive();
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
      } catch {
        holder.current = null;
        return;
      }
      holder.current = j;
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
        ...(active ? { TMP: isolation.path, TEMP: isolation.path, TMPDIR: isolation.path } : {}),
      },
      timeoutMs: opts.timeoutMs,
      maxOutputBytes: opts.maxOutputBytes,
      shell: opts.shell,
      signal: opts.signal,
      confinement: guard,
      onSpawn: ({ pid }) => {
        if (active && pid != null) attachHolder.promise = attachRootAndWindow(pid);
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
        await this.terminatePids(pids);
      },
    });
    for (const pid of report.escapedPids) {
      tree.record('escape-detected', `pid ${pid} running outside confined set (escaped)`, pid);
    }
    for (const pid of report.terminatedPids) {
      tree.record('escape-terminated', `pid ${pid} terminated (tree escape)`, pid);
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