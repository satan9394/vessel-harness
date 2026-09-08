/**
 * runtime/sandbox/backend — isolated working directory (task 071).
 *
 * A confined command should run with its own working/temp directory so it cannot
 * collide with or observe the main workspace temp area. This module creates a
 * per-confinement directory under the OS temp root (NEVER the main workspace
 * path) and cleans it up on dispose.
 *
 * Cleanup follows the repo deletion rule: our OWN ephemeral os.tmpdir artifacts
 * are removed, and the removal goes through the recycle bin (SendToRecycleBin)
 * rather than a permanent delete, consistent with the project-wide no-permanent-
 * delete discipline.
 */

import { mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface IsolatedDirectory {
  /** absolute path to the fresh, empty isolation directory. */
  path: string;
  /** remove the directory (recycle bin). Idempotent. */
  dispose(): Promise<void>;
}

/** Prefix used for all sandbox isolation dirs (os.tmpdir only). */
export const ISOLATION_PREFIX = 'vessel-sandbox-';

/**
 * Create a fresh isolation directory under the OS temp root. Returns both the
 * path (pass to a confined child as `cwd` / `TMP`) and an idempotent dispose.
 */
export async function createIsolatedDirectory(
  prefix: string = ISOLATION_PREFIX,
): Promise<IsolatedDirectory> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return {
    path,
    async dispose(): Promise<void> {
      await new Promise<void>((resolve) => {
        // recycle bin via Microsoft.VisualBasic, consistent with repo discipline.
        const script =
          'param([string]$d)\n' +
          'try { Add-Type -AssemblyName Microsoft.VisualBasic; ' +
          '[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($d,"OnlyErrorDialogs","SendToRecycleBin") } catch {}';
        const child = spawn('powershell', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          script,
          path,
        ], { windowsHide: true, stdio: 'ignore' });
        child.on('exit', () => resolve());
        child.on('error', () => resolve());
      });
    },
  };
}