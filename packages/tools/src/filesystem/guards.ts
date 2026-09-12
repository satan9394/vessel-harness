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

/**
 * Guard classification contract. `guard` is not a log label — it is propagated to
 * `meta.guard` on the `tool/result` record and folded by `EnforcementProjection`
 * (task 074) and matched by the `guard_seen` benchmark assert. So the value is
 * AUDIT SEMANTICS: it decides whether a denial gets counted as a security event.
 *
 *   - `'escape'`       — PROVEN out of bounds. Exactly three ways to earn it: a
 *                        lexical `..`/absolute escape; a `realpath` that succeeded
 *                        and landed outside the root; a dangling link out of
 *                        bounds (an entry `realpath` cannot resolve, so writing
 *                        through it would create the file at an unverifiable
 *                        place). Evidence, not suspicion.
 *   - `'unverifiable'` — NO VERDICT was reached: EACCES/EPERM/ELOOP/UNKNOWN (the
 *                        probe is blind) or ENOTDIR/ENAMETOOLONG/
 *                        ERR_INVALID_ARG_VALUE (the path is structurally unusable).
 *                        Still DENIED — fail-closed is unchanged — but this is NOT
 *                        evidence of an attack and must never be counted as one.
 *                        A stray `Write existing-file/sub.txt` (ENOTDIR) is a
 *                        user slip, not a symlink escape, and reporting it as one
 *                        would corrupt escape telemetry and falsely accuse.
 *
 * Both kinds reject. Neither ever allows, and `'unverifiable'` is strictly a
 * relabelling of a denial that already happened — it cannot widen any boundary.
 */
export class FsGuardError extends Error {
  constructor(
    message: string,
    public readonly guard:
      | 'escape'
      | 'unverifiable'
      | 'protected'
      | 'deny-read'
      | 'confinement'
      | 'size'
      | 'nul'
      | 'missing',
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

/** errno code of an unknown thrown value (undefined when there is none). */
function errnoCode(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * `lstat` (never follows links) classified by errno. The failure bucket `'error'`
 * deliberately collapses TWO different situations, and both are named here so the
 * comment does not claim more resolution than the code has:
 *
 *   - **structurally impossible** — ENOTDIR (a component of the parent chain is a
 *     regular file, e.g. `existing-file/sub.txt`), ENAMETOOLONG, and
 *     ERR_INVALID_ARG_VALUE (node rejects the argument, e.g. an embedded NUL).
 *     "No directory entry can exist at this position" is CERTAIN here — but that
 *     is a conclusion about the path's SHAPE, not an ENOENT observation about a
 *     well-formed name.
 *   - **genuinely undetermined** — EACCES / EPERM / ELOOP / UNKNOWN / …: the probe
 *     is blind and existence is unknown in either direction.
 *
 * Neither may be read as "does not exist, so skip the link check". `canonicalize`
 * fails closed on both and records them as guard `'unverifiable'` (not
 * `'escape'`), because a malformed or unreadable path proves nothing about
 * whether a link redirects the reachable part of the chain.
 */
function probePath(abs: string): 'exists' | 'missing' | 'error' {
  try {
    fs.lstatSync(abs);
    return 'exists';
  } catch (err) {
    return errnoCode(err) === 'ENOENT' ? 'missing' : 'error';
  }
}

/**
 * Deepest existing ancestor of `abs` (inclusive), or null when nothing in the
 * chain exists (e.g. a workspace root that has not been created yet).
 *
 * Fails closed — but as `'unverifiable'`, NOT `'escape'`: an undecidable or
 * structurally invalid probe is a failure to reach a verdict, not proof that the
 * path leaves the workspace. Only a genuine ENOENT step continues the walk.
 */
function deepestExistingAncestor(abs: string, p: string): string | null {
  let cur = path.resolve(abs);
  for (;;) {
    const kind = probePath(cur);
    if (kind === 'exists') return cur;
    if (kind === 'error') {
      throw new FsGuardError(`cannot verify path is inside workspace: ${p}`, 'unverifiable');
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
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
  // symlink escape check (task 073 / hardened: the ONLY defence against a link
  // that redirects a workspace-relative path outside the workspace, since every
  // downstream check — assertReadable/assertWritable/assertConfined — works on
  // this lexical `resolved` and therefore cannot see the redirection).
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
    const code = errnoCode(err);
    if (code !== 'ENOENT') {
      // EACCES / EPERM / ELOOP (no verdict possible) and ENOTDIR / ENAMETOOLONG /
      // ERR_INVALID_ARG_VALUE (structurally impossible path) — the real path could
      // NOT be verified, so the check must NOT be skipped: fail closed.
      // (Previously every non-FsGuardError was swallowed here.)
      //
      // Guard kind is `'unverifiable'`, deliberately NOT `'escape'`. This branch
      // also absorbs ordinary slips — `Write existing-file/sub.txt` (ENOTDIR) and
      // paths node refuses outright (NUL → ERR_INVALID_ARG_VALUE). Labelling those
      // as security escapes would feed false positives into the audit/telemetry
      // that counts escapes (`meta.guard` → EnforcementProjection, `guard_seen`)
      // and would accuse the caller of an attack that never happened. The verdict
      // is untouched: still a denial.
      throw new FsGuardError(
        `cannot verify path is inside workspace${code ? ` (${code})` : ''}: ${p}`,
        'unverifiable',
      );
    }
    // ENOENT: the target itself does not exist yet (a fresh Write/Edit). The
    // lexical check above is NOT sufficient here: an ancestor DIRECTORY can be a
    // symlink/junction pointing outside the workspace, so writing through it
    // would create the file out of bounds while the lexical path stays "inside".
    // Everything below the deepest EXISTING ancestor is nonexistent and can
    // therefore not be a link, so verifying that ancestor is sufficient.
    const rootKind = probePath(path.resolve(root));
    if (rootKind === 'missing') {
      // The workspace root itself does not exist yet ⇒ nothing inside it can
      // exist, so no link planted in the workspace can be involved. Keep the
      // pre-existing behaviour for this (host-configured) case.
      //
      // PREMISE, stated rather than implied: the root is INJECTED BY THE HOST
      // (`createFsTools({ workspaceRoot })`), and this function does NOT verify the
      // root's own ancestor chain. `canonicalize` bounds paths *within* a root it
      // trusts the host to have chosen; if a link had been planted on the way to
      // that root, the party naming the root is already the compromised one, so
      // checking it here would buy nothing. What THIS branch does guarantee is the
      // part the symlink check is responsible for: a root that does not exist has
      // no entries, hence no link, hence nothing to redirect — so there is nothing
      // left to verify and returning `resolved` is safe.
      //
      // Note the deliberate narrowness: only a definite ENOENT on the root takes
      // this shortcut. A root that exists but cannot be probed (`rootKind ===
      // 'error'`) falls through to the ancestor verification below and fails closed
      // as `'unverifiable'`, rather than being mistaken for "absent".
      return resolved;
    }
    const ancestor = deepestExistingAncestor(resolved, p);
    if (ancestor === null) {
      // Unreachable while `root` exists (the root is always an ancestor of a
      // lexically-inside path) — deny rather than guess. No verdict was reached
      // about where the path lives, so this is `'unverifiable'`, not an escape.
      throw new FsGuardError(`cannot verify path is inside workspace: ${p}`, 'unverifiable');
    }
    if (ancestor === resolved) {
      // `lstat` sees an entry but `realpath` says ENOENT ⇒ a dangling link
      // (symlink/junction/reparse point whose target is missing). Writing through
      // it would create the file at a location this function cannot verify, so it
      // is denied as an escape.
      //
      // Scope note, so the label is not over-read: the rule is "unresolvable link
      // at the final component", and the link's TARGET is deliberately not
      // inspected. A dangling link whose target happens to be inside the workspace
      // is therefore denied the same way. That is an over-block, not a hole — it
      // only ever denies, so fail-closed is preserved and nothing is widened.
      throw new FsGuardError(`symlink escapes workspace: ${p}`, 'escape');
    }
    let realAncestor: string;
    let realRoot: string;
    try {
      realAncestor = fs.realpathSync.native(ancestor);
      realRoot = fs.realpathSync.native(root);
    } catch {
      // Same reasoning as the `ancestor === null` branch: re-verifying an existing
      // ancestor failed, so the location is undecided → deny as `'unverifiable'`.
      throw new FsGuardError(`cannot verify path is inside workspace: ${p}`, 'unverifiable');
    }
    const ancestorRel = path.relative(realRoot, realAncestor);
    if (ancestorRel.startsWith('..') || path.isAbsolute(ancestorRel)) {
      throw new FsGuardError(`symlink escapes workspace: ${p}`, 'escape');
    }
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
