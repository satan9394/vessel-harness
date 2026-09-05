import * as fs from 'node:fs';
import * as path from 'node:path';
import { MAX_FILE_BYTES } from '@cah/shared';
import { globMatch } from '../globmatch.js';

export interface FsPolicyConfig {
  /** write-protected path globs (never exemptable) */
  protected: string[];
  /** read-denied path globs (credentials by default) */
  denyRead: string[];
  /** explicit read/write allow dirs */
  allow: { path: string; mode: 'read' | 'write' }[];
}

export const DEFAULT_FS_POLICY: FsPolicyConfig = {
  protected: ['.git', '.git/**', '.claude', '.ssh', '.harness/credentials', '.env'],
  denyRead: [],
  allow: [],
};

export class FsGuardError extends Error {
  constructor(
    message: string,
    public readonly guard: 'escape' | 'protected' | 'deny-read' | 'size' | 'nul' | 'missing',
  ) {
    super(message);
  }
}

/**
 * Canonicalize a workspace-relative or absolute path against workspaceRoot.
 * Rejects `..` escapes and symlink escapes (canonical before lexical, per
 * ARCHITECTURE §4.5 file_guards / POLICY-SPEC §3.3).
 */
export function canonicalize(root: string, p: string): string {
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  const resolved = path.resolve(abs);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new FsGuardError(`path escapes workspace: ${p}`, 'escape');
  }
  // symlink escape check (best-effort on Windows)
  try {
    const real = fs.realpathSync.native(resolved);
    const realRel = path.relative(fs.realpathSync.native(root), real);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new FsGuardError(`symlink escapes workspace: ${p}`, 'escape');
    }
  } catch (err) {
    if (err instanceof FsGuardError) throw err;
    // file may not exist yet (write) — lexical check already applied
  }
  return resolved;
}

/** Match a canonical path against glob patterns (relative to workspace root). */
export function matchesGlobList(root: string, canonicalPath: string, globs: string[]): boolean {
  const rel = path.relative(root, canonicalPath).replace(/\\/g, '/');
  return globs.some((g) => globMatch(g, rel));
}

export function assertWritable(root: string, canonicalPath: string, config: FsPolicyConfig): void {
  if (matchesGlobList(root, canonicalPath, config.protected)) {
    throw new FsGuardError(`write protected path: ${path.relative(root, canonicalPath)}`, 'protected');
  }
}

export function assertReadable(root: string, canonicalPath: string, config: FsPolicyConfig): void {
  if (matchesGlobList(root, canonicalPath, config.denyRead)) {
    throw new FsGuardError(`read denied path: ${path.relative(root, canonicalPath)}`, 'deny-read');
  }
  const rel = path.relative(root, canonicalPath).replace(/\\/g, '/');
  if (rel === '' || rel.startsWith('..')) {
    throw new FsGuardError(`path outside workspace: ${rel}`, 'escape');
  }
}

export function assertNoNul(data: Buffer | string): void {
  const s = typeof data === 'string' ? data : data.toString('utf8');
  if (s.includes('\u0000')) {
    throw new FsGuardError('NUL byte detected', 'nul');
  }
}

export function assertSizeWithin(bytes: number): void {
  if (bytes > MAX_FILE_BYTES) {
    throw new FsGuardError(`file exceeds ${MAX_FILE_BYTES} bytes cap`, 'size');
  }
}
