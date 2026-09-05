import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** max stdout+stderr bytes captured (default 1 MiB) */
  maxOutputBytes?: number;
  /** run through the platform shell (cmd.exe /bin/sh) — required for command strings */
  shell?: boolean;
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

    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < maxOut) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < maxOut) stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut, killed });
    });
  });
}
