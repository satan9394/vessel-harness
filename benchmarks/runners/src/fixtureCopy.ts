import * as fs from 'node:fs';
import * as path from 'node:path';

/** Copy ordinary files and directories, optionally excluding fixture-relative files. */
export function copyFixtureTree(src: string, dest: string, isExcluded?: (relPath: string) => boolean): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyFixtureTree(s, d, isExcluded && ((rel) => isExcluded(`${e.name}/${rel}`)));
    else if (e.isFile() && !isExcluded?.(e.name)) fs.copyFileSync(s, d);
  }
}

/**
 * A DECLARED prepare step could not be applied (platform refuses the link, no
 * permission, malformed declaration). Thrown, never swallowed: degrading to
 * "the probe object simply is not there" is exactly the defect this closes.
 * Callers map it to `pending-environment` — an honest "cannot judge on this
 * machine", which is neither a pass nor a silent failure.
 */
export class FixtureSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixtureSetupError';
  }
}

/** An installed CLI is outside the declared benchmark toolchain range. */
export class ToolchainPinError extends FixtureSetupError {
  constructor(tool: string, found: string, declared: string) {
    super(`${tool}: found ${found}, declared ${declared}; upgrade/downgrade the CLI or update configs/tool-pins.json.`);
    this.name = 'ToolchainPinError';
  }
}

export const BUILTIN_LEAK_GLOBS = ['RUBRICS.json', 'RUBRIC.json'];

/** File-only, fixture-root-relative globs; a double-star slash also matches zero directories. */
export function matchLeakGlob(relPath: string, pattern: string): boolean {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\//, '');
  let expression = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i]!;
    if (c === '*' && normalized[i + 1] === '*') {
      if (normalized[i + 2] === '/') {
        expression += '(?:.*/)?';
        i += 2;
      } else {
        expression += '.*';
        i++;
      }
    } else if (c === '*') expression += '[^/]*';
    else expression += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${expression}$`, 'i').test(relPath.replace(/\\/g, '/'));
}

/**
 * A repository asset defect (criteria files copied into the tested workspace), NOT an
 * environment limit: the release gate checks this type first and judges it `fail`, while
 * the remaining `FixtureSetupError`s stay `pending-environment`.
 */
export class FixtureLeakError extends FixtureSetupError {
  constructor(hits: string[]) {
    super(`fixture leak detected:\n${hits.join('\n')}\nMove criteria files out of the fixture directory, or add their patterns to this scenario manifest's leak_globs.`);
    this.name = 'FixtureLeakError';
  }
}

/** Recheck after prepare, without following fixture-created links outside the workspace. */
export function assertNoLeakPaths(
  workspace: string,
  { declared, builtin = BUILTIN_LEAK_GLOBS }: { declared: readonly string[]; builtin?: readonly string[] },
): void {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = path.relative(workspace, full).replace(/\\/g, '/');
        const declaredPattern = declared.find((pattern) => matchLeakGlob(rel, pattern));
        const builtinPattern = builtin.find((pattern) => matchLeakGlob(entry.name, pattern));
        if (declaredPattern !== undefined) hits.push(`${rel} (declared: ${declaredPattern})`);
        else if (builtinPattern !== undefined) hits.push(`${rel} (builtin: ${builtinPattern})`);
      }
    }
  };
  walk(workspace);
  if (hits.length) throw new FixtureLeakError(hits);
}

