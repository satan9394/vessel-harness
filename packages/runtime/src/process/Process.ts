import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** max stdout+stderr bytes captured (default 1 MiB) */
  maxOutputBytes?: number;
  /** run through the platform shell (cmd.exe /bin/sh) — required for command strings */
  shell?: boolean;
  /**
   * turn-level cancellation (task 050): when the signal aborts the child is
   * killed (SIGKILL like the timeout path) and the result resolves with
   * `killed: true`. The caller decides whether that means an error result
   * (shell tool) or an interrupt stop (AgentLoop boundary).
   */
  signal?: AbortSignal;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
}

/**
 * runtime/process — controlled spawn point (ARCHITECTURE §4.7).
 * All OS process derivation goes through here; supports timeout + cancel token.
 */
export function runCommand(
  command: string,
  args: string[],
  opts: SpawnOptions,
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const maxOut = opts.maxOutputBytes ?? 1024 * 1024;
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        windowsHide: true,
        shell: opts.shell ?? false,
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    // task 050: external cancel (turn interrupt) kills the child like a timeout
    let onAbort: (() => void) | null = null;
    if (opts.signal) {
      if (opts.signal.aborted) {
        killed = true;
        child.kill('SIGKILL');
      } else {
        onAbort = () => {
          killed = true;
          try {
            child.kill('SIGKILL');
          } catch {
            // child already exited — the close handler below settles the promise
          }
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
    child.on('close', (code) => {
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode: code, timedOut, killed });
    });
  });
}
