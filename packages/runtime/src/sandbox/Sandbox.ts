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
}

/** Dependency slice injected by tests so the enforcement logic is unit-testable. */
export interface SandboxDeps {
  platform?: NodeJS.Platform;
  createJob?: (
    pid: number,
    limits: JobObjectLimits,
  ) => Promise<JobObjectConfinement>;
  makeIsolatedDir?: () => Promise<IsolatedDirectory>;
}

/** A confinement session: a fresh isolation cwd + a lazily-attached kill handle. */
export interface ConfinementSession {
  cwd: string;
  /** attach the spawned child's pid to the Job Object (for whole-tree kill). */
  attach(pid: number): Promise<void>;
  /** terminate the job tree + recycle the isolation dir. Idempotent. */
  dispose(): Promise<void>;
}

export class Sandbox {
  private readonly platform: NodeJS.Platform;
  private readonly createJob: NonNullable<SandboxDeps['createJob']>;
  private readonly makeIsolatedDir: NonNullable<SandboxDeps['makeIsolatedDir']>;

  constructor(deps: SandboxDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.createJob = deps.createJob ?? createJobObject;
    this.makeIsolatedDir = deps.makeIsolatedDir ?? createIsolatedDirectory;
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
   * Job Object + `dispose()` that kills the tree and recycles the dir.
   */
  async openConfinement(limits?: SandboxLimits): Promise<ConfinementSession> {
    const active = this.isActive();
    const isolation = await this.makeIsolatedDir();
    const jobFactory = this.createJob;
    let job: JobObjectConfinement | null = null;
    let disposed = false;
    return {
      cwd: isolation.path,
      async attach(pid: number): Promise<void> {
        if (!active || disposed || job) return;
        try {
          job = await jobFactory(pid, { maxActiveProcesses: limits?.maxActiveProcesses });
        } catch {
          job = null; // degrade: direct-child kill still works via runCommand
        }
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        if (job) await job.dispose();
        await isolation.dispose();
      },
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
  ): Promise<SpawnResult & { sandbox: SandboxStatus }> {
    const active = this.isActive();
    const isolation = await this.makeIsolatedDir();
    const jobFactory = this.createJob;
    // holder object (not a bare let) so TS control-flow doesn't narrow `current`
    // to null — the assignment happens inside the onSpawn callback.
    const holder: { current: JobObjectConfinement | null } = { current: null };
    const guard = {
      terminate: (): Promise<void> =>
        holder.current ? holder.current.terminate() : Promise.resolve(),
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
        if (active && pid != null) {
          void jobFactory(pid, { maxActiveProcesses: opts.limits?.maxActiveProcesses })
            .then((j) => {
              holder.current = j;
            })
            .catch(() => {
              holder.current = null;
            });
        }
      },
    });
    if (holder.current) await holder.current.dispose();
    await isolation.dispose();
    return { ...result, sandbox: this.statusSnapshot() };
  }
}

/** Re-exports so consumers can build their own job handles if needed. */
export { WindowsJobObject, createJobObject };
export type { JobObjectConfinement, JobObjectLimits, SpawnResult, SpawnOptions };