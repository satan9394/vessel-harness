/**
 * runtime/sandbox/backend — isolated working directory (task 071).
 *
 * A confined command should run with its own working/temp directory so it cannot
 * collide with or observe the main workspace temp area. This module creates a
 * per-confinement directory under the OS temp root (NEVER the main workspace
 * path) and cleans it up on dispose.
 *
 * Cleanup follows the repo deletion rule: our OWN ephemeral os.tmpdir artifacts
 * go to the recycle bin through the shared `recyclePath` primitive
 * (packages/shared/src/deletion/recycle.ts), never a permanent delete.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recyclePath } from '@vessel/shared';

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
      // Recycle bin via the shared primitive; dispose stays idempotent and never throws.
      await recyclePath(path).catch(() => undefined);
    },
  };
}