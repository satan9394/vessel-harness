import { realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SandboxExecutionOptions } from './types.js';

/** Resolve junctions before mounting. Only the worktree and host temp root can be writable. */
export function allowedWriteRoots(options: SandboxExecutionOptions): string[] {
  const cwd = realpathSync(options.cwd);
  const temp = realpathSync(tmpdir());
  const roots = options.allowedWritePaths ?? [cwd, temp];
  if (!roots.length) throw new Error('sandbox requires at least one write root');
  const inside = (root: string, target: string) => {
    const rel = relative(root, target);
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  };
  return [...new Set(roots.map(root => {
    const canonical = realpathSync(resolve(cwd, root));
    if (!statSync(canonical).isDirectory() || (!inside(cwd, canonical) && !inside(temp, canonical))) {
      throw new Error(`sandbox write path outside worktree/temp: ${root}`);
    }
    return canonical;
  }))];
}

export function validateSandboxOptions(options: SandboxExecutionOptions): void {
  for (const value of [options.cpuTimeoutMs, options.maxMemoryBytes]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('sandbox resource limits must be positive integers');
  }
  if (options.signal?.aborted) throw new Error('sandbox execution interrupted');
}
