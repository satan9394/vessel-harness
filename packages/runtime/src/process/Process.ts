import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** max stdout+stderr bytes captured (default 1 MiB) */
  maxOutputBytes?: number;
  /** Only used by Sandbox.run command-line mode; runCommand rejects shell mode. */
  shell?: boolean;
  /**
   * turn-level cancellation (task 050): when the signal aborts the child is
   * killed (SIGKILL like the timeout path) and the result resolves with
   * `killed: true`. The caller decides whether that means an error result
   * (shell tool) or an interrupt stop (AgentLoop boundary).
   */
  signal?: AbortSignal;
  /** Trusted helper script input; avoids platform command-line length limits. */
  stdin?: string;
  /** POSIX helper owns a group; cancellation kills processes remaining in that group. */
  processGroup?: boolean;
  /**
   * process-tree confinement (task 071, Windows Job Object): when present, on
   * timeout or abort we terminate the WHOLE job tree (grandchildren included)
   * via `terminate()`, not just the direct child — closing the Windows gap where
   * `child.kill` only TerminateProcess the direct child. Callers obtain this
   * handle from `Sandbox.openConfinement()`/`createJobObject()`.
   */
  confinement?: {
    terminate(): Promise<void>;
  } | null;
  /**
   * called right after the child process is spawned (Windows: after
   * `spawn()` resolves) with its pid. Used to attach a Job Object around the
   * child so the 050/timeout paths can kill the whole tree.
   */
  onSpawn?: (child: { pid?: number; command: string }) => void;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
}

/**
 * Three spawn shapes, deliberately separate, because they differ in what the caller is allowed to hand over:
 *  - runCommand(argv): a program this codebase names itself, with arguments it builds itself;
 *  - runShellCommand(commandLine): the single intentional shell boundary;
 *  - runDirectedCommand(argv): an arbitrary executable the caller names (the sandbox), kept as its own spawn
 *    site so "run the program we chose" and "run whatever the confinement layer was asked to run" never share
 *    one process-derivation node — audit trails and static analysis both read that distinction.
 */
export function runCommand(
  command: string,
  args: string[],
  opts: SpawnOptions,
): Promise<SpawnResult> {
  if (opts.shell) return Promise.reject(new TypeError('runCommand: argv is not shell-interpreted; use runShellCommand(commandLine)'));
  return supervise(() => spawn(command, args, argvSpawnOptions(opts)), opts, command);
}

export function runShellCommand(command: string, opts: SpawnOptions): Promise<SpawnResult> {
  return supervise(() => spawn(command, [], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    windowsHide: true,
    shell: true,
    detached: opts.processGroup === true && process.platform !== 'win32',
  }), opts, command);
}

/**
 * Executes an executable chosen by the caller plus its argv, under whatever confinement the caller applied
 * around this call. Same mechanics as `runCommand`, deliberately a separate spawn site (see the note above).
 */
export function runDirectedCommand(
  command: string,
  args: string[],
  opts: SpawnOptions,
): Promise<SpawnResult> {
  if (opts.shell) return Promise.reject(new TypeError('runDirectedCommand: argv is not shell-interpreted; use runShellCommand(commandLine)'));
  return supervise(() => spawn(command, args, argvSpawnOptions(opts)), opts, command);
}

function argvSpawnOptions(opts: SpawnOptions) {
  return {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    windowsHide: true,
    detached: opts.processGroup === true && process.platform !== 'win32',
  };
}

function supervise(spawnChild: () => ChildProcess, opts: SpawnOptions, command: string): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const maxOut = opts.maxOutputBytes ?? 1024 * 1024;
    let child: ChildProcess;
    try {
      child = spawnChild();
    } catch (err) {
      reject(err);
      return;
    }

    opts.onSpawn?.({ pid: child.pid, command });
    if (opts.stdin !== undefined) {
      // A helper that exits before consuming input can close its pipe; the process exit remains authoritative.
      child.stdin?.on('error', () => {});
      child.stdin?.end(opts.stdin, 'utf8');
    }

    const kill = () => {
      if (opts.processGroup && process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      } else child.kill('SIGKILL');
      if (opts.processGroup) {
        // Escaped descendants may retain inherited pipe handles. Stop capture on cancellation so they cannot hold close indefinitely.
        child.stdout?.destroy?.();
        child.stderr?.destroy?.();
        child.stdin?.destroy?.();
      }
    };

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killed = true;
      kill();
      // task 071: kill the whole job tree on Windows (grandchildren too)
      void opts.confinement?.terminate();
    }, timeoutMs);

    // task 050: external cancel (turn interrupt) kills the child like a timeout
    let onAbort: (() => void) | null = null;
    if (opts.signal) {
      if (opts.signal.aborted) {
        killed = true;
        kill();
        void opts.confinement?.terminate();
      } else {
        onAbort = () => {
          killed = true;
          try {
            kill();
          } catch {
            // child already exited — the close handler below settles the promise
          }
          void opts.confinement?.terminate(); // task 071: whole-tree kill
        };
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < maxOut) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < maxOut) stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    if (opts.processGroup && process.platform !== 'win32') {
      child.on('exit', () => {
        // A normal root exit also ends the invocation's owned group before inherited pipes can keep close pending.
        if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ } }
      });
    }
    child.on('close', (code) => {
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode: code, timedOut, killed });
    });
  });
}
