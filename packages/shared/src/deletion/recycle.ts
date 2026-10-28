/**
 * The one recycle primitives used by the whole repo.
 *
 * Every "delete" in Vessel goes to the OS recycle bin, never a permanent delete.
 * Windows uses PowerShell + Microsoft.VisualBasic.FileIO, macOS uses Finder via
 * osascript, and Unix uses `gio trash`. Callers keep their own failure policy
 * (warn, refuse, retry); this module only reports what happened.
 *
 * Nothing here touches the filesystem beyond `lstat` — the removal itself is the
 * platform tool's job, so a test can inject `run` and never touch a real bin.
 */
import { spawn } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';

export type RecycleResult =
  | { ok: true; target: string }
  | { ok: false; reason: 'unsupported-platform' | 'not-found' | 'failed'; detail: string };

/** Injected command runner: resolves with the exit code, never rejects. */
export type RecycleRun = (
  command: string,
  args: string[],
) => Promise<{ code: number | null; error?: string }>;

export interface RecycleOptions {
  run?: RecycleRun;
  /** Defaults to `process.platform`; explicit so tests do not depend on the host. */
  platform?: NodeJS.Platform;
}

const UNIX_GIO: readonly NodeJS.Platform[] = [
  'linux', 'freebsd', 'openbsd', 'netbsd', 'sunos', 'aix', 'android',
];

const defaultRun: RecycleRun = (command, args) =>
  new Promise(resolve => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', error => resolve({ code: null, error: (error as Error).message }));
    child.once('close', code =>
      resolve({ code, error: code === 0 ? undefined : `exit ${code ?? 'null'}` }),
    );
  });

/**
 * PowerShell single-quoted literal. Inside single quotes `$` and backticks are
 * literal, so only `'` needs doubling — that was the bug in two earlier copies.
 */
export function powershellLiteral(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

/** AppleScript double-quoted literal: backslash and double quote escape. */
export function appleScriptLiteral(value: string): string {
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

export async function recyclePath(
  target: string,
  options: RecycleOptions = {},
): Promise<RecycleResult> {
  const run = options.run ?? defaultRun;
  const platform = options.platform ?? process.platform;
  const resolved = path.resolve(target);

  if (!existsSync(resolved)) return { ok: false, reason: 'not-found', detail: resolved };

  let stat;
  try {
    stat = lstatSync(resolved);
  } catch (error) {
    return { ok: false, reason: 'failed', detail: (error as Error).message };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, reason: 'failed', detail: 'refusing to recycle a symbolic link' };
  }

  let command: string;
  let args: string[];
  if (platform === 'win32') {
    const operation = stat.isDirectory() ? 'DeleteDirectory' : 'DeleteFile';
    command = 'powershell.exe';
    args = [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName Microsoft.VisualBasic; ' +
        `[Microsoft.VisualBasic.FileIO.FileSystem]::${operation}(${powershellLiteral(resolved)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
    ];
  } else if (platform === 'darwin') {
    command = 'osascript';
    args = ['-e', `tell application "Finder" to delete POSIX file ${appleScriptLiteral(resolved)}`];
  } else if (UNIX_GIO.includes(platform)) {
    command = 'gio';
    args = ['trash', '--', resolved];
  } else {
    return { ok: false, reason: 'unsupported-platform', detail: platform };
  }

  try {
    const result = await run(command, args);
    if (result.code === 0) return { ok: true, target: resolved };
    return { ok: false, reason: 'failed', detail: result.error ?? `exit ${result.code ?? 'null'}` };
  } catch (error) {
    return { ok: false, reason: 'failed', detail: (error as Error).message };
  }
}
