import * as fs from 'node:fs';
import * as path from 'node:path';
import { MAX_FILE_BYTES } from '@vessel/shared';
import { globMatch } from '../globmatch.js';

export interface FsPolicyConfig {
  /** write-protected path globs (never exemptable) */
  protected: string[];
  /** read-denied path globs (credentials by default) */
  denyRead: string[];
  /** explicit read/write allow dirs */
  allow: { path: string; mode: 'read' | 'write' }[];
  /**
   * task 073 filesystem confinement. When true, the allow set becomes the
   * authoritative access boundary: a path is reachable only if it lies inside
   * the workspace root (always in the allow set) OR matches an explicit `allow`
   * entry of the required mode. Everything else (out-of-workspace with no
   * matching allow) is denied with guard kind 'confinement'. Escape and symlink
   * escapes are independently rejected by `canonicalize` regardless of this flag.
   * When false/undefined, `allow` is advisory (dead back-compat) and the
   * workspace root remains the only boundary — i.e. the pre-073 behaviour.
   */
  confinement?: boolean;
}

export const DEFAULT_FS_POLICY: FsPolicyConfig = {
  protected: ['.git', '.git/**', '.claude', '.ssh', '.harness/credentials', '.env'],
  denyRead: [],
  allow: [],
};

export class FsGuardError extends Error {
  constructor(
    message: string,
    public readonly guard: 'escape' | 'protected' | 'deny-read' | 'confinement' | 'size' | 'nul' | 'missing',
  ) {
    super(message);
  }
}

/**
 * task 073 — whether a resolved absolute path lies inside ANY explicit absolute
 * `allow` entry (prefix match, mode-agnostic; the precise mode gate happens in
 * `assertConfined`). Used as the canonicalize escape hatch for confinement's
 * "显式授权路径": an allow-listed external dir may be reached instead of being
 * rejected as a workspace escape.
 */
function withinAbsoluteAllow(config: FsPolicyConfig, resolved: string): boolean {
  return config.allow.some((entry) => {
    if (!path.isAbsolute(entry.path)) return false;
    const dir = path.resolve(entry.path);
    const rel = path.relative(dir, resolved).replace(/\\/g, '/');
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/**
 * Canonicalize a workspace-relative or absolute path against workspaceRoot.
 * Rejects `..` escapes and symlink escapes (canonical before lexical, per
 * ARCHITECTURE §4.5 file_guards / POLICY-SPEC §3.3).
 *
 * task 073: when `config.confinement` is true, a path that resolves outside the
 * workspace is NOT an immediate escape IF it lies inside an explicit absolute
 * `allow` entry (显式授权路径). The mode-scoped authorization is then enforced
 * by `assertConfined`. When confinement is off (or no matching absolute allow),
 * behaviour is identical to pre-073: any escape is rejected. The optional param
 * is back-compatible — existing call sites omit it and keep the old hard gate.
 */
export function canonicalize(root: string, p: string, config?: FsPolicyConfig): string {
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  const resolved = path.resolve(abs);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    // confinement explicit-allow hatch: permit an allow-listed external dir.
    if (config?.confinement === true && withinAbsoluteAllow(config, resolved)) {
      return resolved;
    }
    throw new FsGuardError(`path escapes workspace: ${p}`, 'escape');
  }
  // symlink escape check (best-effort on Windows)
  try {
    const real = fs.realpathSync.native(resolved);
    const realRel = path.relative(fs.realpathSync.native(root), real);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      // symlink escapes are always rejected — even under an allow dir a symlink
      // pointing outside is treated as a hard escape (mechanism-level, per the
      // "符号链接出界" deny rule). This is stricter than a lexical allow and is
      // intentional: allow names real paths, not redirector links.
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

/**
 * task 073 — canonical-relative position of `canonicalPath` vs the workspace.
 * Returns true when the path lies inside (or at) the workspace root.
 */
function isInsideRoot(root: string, canonicalPath: string): boolean {
  const rel = path.relative(root, canonicalPath).replace(/\\/g, '/');
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Whether a single `allow` entry authorizes `canonicalPath`. Entries are matched
 * against the canonical path: absolute entry paths match as written; workspace-
 * relative entries (incl. globs) match against the path relative to the root.
 * Mode must match the operation being authorized.
 */
export function isWithinAllow(
  root: string,
  canonicalPath: string,
  entry: FsPolicyConfig['allow'][number],
  mode: 'read' | 'write',
): boolean {
  if (entry.mode !== mode) return false;
  if (path.isAbsolute(entry.path)) {
    const resolved = path.resolve(entry.path);
    // allow the exact path or anything beneath it (glob supported for segments)
    const rel = path.relative(resolved, canonicalPath).replace(/\\/g, '/');
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }
  // workspace-relative glob (may include **)
  const rel = path.relative(root, canonicalPath).replace(/\\/g, '/');
  const pattern = entry.path.replace(/\\/g, '/');
  if (/[\*\?\{\}\[\]]/.test(pattern)) {
    return globMatch(pattern, rel);
  }
  const allowRel = path.relative(path.resolve(root, entry.path), canonicalPath).replace(/\\/g, '/');
  return allowRel === '' || (!allowRel.startsWith('..') && !path.isAbsolute(allowRel));
}

/**
 * task 073 — filesystem confinement hard enforcement (allow-set strategy).
 * The allow set = workspace root (always) ∪ explicit `allow` entries of the
 * required mode. When `config.confinement !== true` this is a no-op (back-compat:
 * workspace root remains the boundary, `allow` advisory). When enabled, any
 * path outside the workspace root that is not covered by a matching-mode allow
 * entry is denied with guard kind 'confinement'. This is the authoritative
 * canonical check that the tool layer runs before every file access; the policy
 * layer runs a lexical pre-check at the Executor seam (audit/denial), see
 * policy/risk Compiler `fs-confinement` rule.
 */
export function assertConfined(
  root: string,
  canonicalPath: string,
  mode: 'read' | 'write',
  config: FsPolicyConfig,
): void {
  if (config.confinement !== true) return; // disabled → pre-073 behaviour
  if (isInsideRoot(root, canonicalPath)) return; // workspace root is always in the allow set
  // escape/symlink-escape is rejected by canonicalize before this is reached;
  // reaching here means a path genuinely outside the root → needs an explicit allow.
  const allowed = config.allow.some((entry) => isWithinAllow(root, canonicalPath, entry, mode));
  if (!allowed) {
    throw new FsGuardError(
      `path outside confinement allow set (${mode}): ${path.relative(root, canonicalPath) || canonicalPath}`,
      'confinement',
    );
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
