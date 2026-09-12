import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFsTools, createSearchTools } from '../index.js';
import { ToolRegistry } from '../registry/Registry.js';
import {
  FsGuardError,
  assertConfined,
  canonicalize,
  isWithinAllow,
  type FsPolicyConfig,
} from './guards.js';

/**
 * Directory-link capability of this host (Windows junction needs no elevation;
 * POSIX dir symlink needs none either), probed ONCE so the link-dependent cases
 * can be `skipIf`-skipped visibly instead of silently returning.
 * The probe's own link target lives inside the probe dir, so even a recursive
 * cleanup that followed the link could not touch anything else.
 */
const LINK_KIND: 'junction' | 'dir' = process.platform === 'win32' ? 'junction' : 'dir';
const CAN_CREATE_DIR_LINK: boolean = (() => {
  let probe: string | undefined;
  let ok = false;
  try {
    probe = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-link-probe-'));
    fs.mkdirSync(path.join(probe, 'target'));
    fs.symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'), LINK_KIND);
    ok = fs.existsSync(path.join(probe, 'link'));
  } catch {
    ok = false;
  }
  if (probe) {
    try {
      fs.rmSync(probe, { recursive: true, force: true });
    } catch {
      /* probe cleanup is best-effort */
    }
  }
  return ok;
})();

/**
 * task 073 filesystem confinement — tool-layer hard enforcement + guard unit tests.
 * Sentinel files live under os.tmpdir (repo test-fixture convention); confined
 * denials must never touch the main workspace path.
 */
describe('tools/filesystem — guard unit: confinement allow set', () => {
  let root: string;
  let outsideDir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-conf-root-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-conf-out-'));
  });
  afterEach(() => {
    for (const d of [root, outsideDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  it('confinement disabled: workspace-interior and out-of-workspace-with-no-allow are both reachable (pre-073 back-compat)', () => {
    const cfg: FsPolicyConfig = { protected: [], denyRead: [], allow: [], confinement: false };
    const inside = path.join(root, 'a.txt');
    expect(() => assertConfined(root, inside, 'read', cfg)).not.toThrow();
    // out-of-workspace is allowed when confinement is off (canonicalize guards escapes separately)
    const out = path.join(outsideDir, 'x.txt');
    expect(() => assertConfined(root, out, 'write', cfg)).not.toThrow();
  });

  it('confinement on: workspace interior is always in the allow set (no breakage)', () => {
    const cfg: FsPolicyConfig = { protected: [], denyRead: [], allow: [], confinement: true };
    expect(() => assertConfined(root, path.join(root, 'sub', 'a.txt'), 'read', cfg)).not.toThrow();
    expect(() => assertConfined(root, path.join(root, 'sub', 'a.txt'), 'write', cfg)).not.toThrow();
  });

  it('confinement on: out-of-workspace path is denied with guard kind "confinement"', () => {
    const cfg: FsPolicyConfig = { protected: [], denyRead: [], allow: [], confinement: true };
    const out = path.join(outsideDir, 'x.txt');
    expect(() => assertConfined(root, out, 'read', cfg)).toThrow(/outside confinement allow set/);
    try {
      assertConfined(root, out, 'read', cfg);
    } catch (e) {
      expect((e as Error & { guard?: string }).guard).toBe('confinement');
    }
    expect(() => assertConfined(root, out, 'write', cfg)).toThrow(/outside confinement allow set/);
  });

  it('isWithinAllow: matches absolute allow paths + workspace-relative globs, mode-scoped', () => {
    const out = path.join(outsideDir, 'data', 'file.txt');
    expect(isWithinAllow(root, out, { path: outsideDir, mode: 'read' }, 'read')).toBe(true);
    expect(isWithinAllow(root, out, { path: outsideDir, mode: 'write' }, 'read')).toBe(false); // mode mismatch
    expect(isWithinAllow(root, out, { path: outsideDir, mode: 'write' }, 'write')).toBe(true);
    // workspace-relative glob
    expect(isWithinAllow(root, path.join(root, 'cache', 'a.json'), { path: 'cache/**', mode: 'write' }, 'write')).toBe(true);
    expect(isWithinAllow(root, path.join(root, 'cache', 'a.json'), { path: 'src/**', mode: 'write' }, 'write')).toBe(false);
  });

  it('confinement on + matching absolute allow authorizes out-of-workspace access', () => {
    const cfg: FsPolicyConfig = {
      protected: [], denyRead: [], allow: [{ path: outsideDir, mode: 'read' }], confinement: true,
    };
    // nested inside the allowed dir → reachable
    expect(() => assertConfined(root, path.join(outsideDir, 'nested', 'f'),
      'read', cfg)).not.toThrow();
    // sibling outside the allow dir → denied
    expect(() => assertConfined(root, path.join(os.tmpdir(), 'cah-elsewhere.txt'),
      'read', cfg)).toThrow(/outside confinement allow set/);
  });
});

describe('tools/filesystem — tool execution seam (hard enforcement point)', () => {
  let dir: string;
  let outsideDir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-conf-tool-root-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-conf-tool-out-'));
  });
  afterEach(() => {
    for (const d of [dir, outsideDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  function registry(cfg: FsPolicyConfig): ToolRegistry {
    const tools = [...createFsTools({ workspaceRoot: dir, fsPolicy: cfg })];
    return new ToolRegistry(tools);
  }
  function ctx() {
    return { workspaceRoot: dir, cwd: dir, sandbox: { confine: async () => ({ argv: [] as string[], enforcement: 'none' as const }), status: () => ({ enabled: false, supported: 'none' as const, active: false }) } };
  }

  it('allow: normal workspace Write+Read round-trips when confinement is on', async () => {
    const r = registry({ protected: ['.git'], denyRead: [], allow: [], confinement: true });
    const w = await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'sub/a.txt', content: 'hi' } }, ctx());
    expect(w.error).toBeUndefined();
    const rd = await r.execute({ toolCallId: '2', toolName: 'Read', arguments: { path: 'sub/a.txt' } }, ctx());
    expect(rd.error).toBeUndefined();
    expect(rd.content).toBe('hi');
  });

  it('reject: out-of-workspace Read is DENIED via escape guard (hard enforcement)', async () => {
    const r = registry({ protected: [], denyRead: [], allow: [], confinement: true });
    const outFile = path.join(outsideDir, 'secret.txt');
    fs.writeFileSync(outFile, 'top-secret');
    const rd = await r.execute({ toolCallId: '1', toolName: 'Read', arguments: { path: outFile } }, ctx());
    expect(rd.error?.errorClass).toBe('DENIED');
    expect(rd.error?.message).toMatch(/escapes workspace/);
  });

  it('reject: out-of-workspace Write is DENIED via escape guard and file not created', async () => {
    const r = registry({ protected: [], denyRead: [], allow: [], confinement: true });
    const outFile = path.join(outsideDir, 'created.txt');
    const w = await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: outFile, content: 'x' } }, ctx());
    expect(w.error?.errorClass).toBe('DENIED');
    expect(w.error?.message).toMatch(/escapes workspace/);
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('allow: explicit absolute allow path permits authorized out-of-workspace Read/Write', async () => {
    fs.mkdirSync(path.join(outsideDir, 'assets'));
    const sharedFile = path.join(outsideDir, 'assets', 'note.txt');
    fs.writeFileSync(sharedFile, 'shared-content');
    const r = registry({ protected: [], denyRead: [], allow: [{ path: outsideDir, mode: 'write' }], confinement: true });
    // Write into the allow-listed dir succeeds (mode write allowed)
    const w = await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: path.join(outsideDir, 'assets', 'new.txt'), content: 'new' } }, ctx());
    expect(w.error).toBeUndefined();
    expect(fs.existsSync(path.join(outsideDir, 'assets', 'new.txt'))).toBe(true);
  });

  it('allow: explicit absolute allow read-mode does NOT permit writes into that dir (mode-scoped gate)', async () => {
    fs.mkdirSync(path.join(outsideDir, 'ro'));
    const r = registry({ protected: [], denyRead: [], allow: [{ path: outsideDir, mode: 'read' }], confinement: true });
    const w = await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: path.join(outsideDir, 'ro', 'x.txt'), content: 'x' } }, ctx());
    expect(w.error?.errorClass).toBe('DENIED');
    expect(w.error?.message).toMatch(/confinement allow set|escapes workspace/);
    expect(fs.existsSync(path.join(outsideDir, 'ro', 'x.txt'))).toBe(false);
  });

  it('escape: ".." path rejected even in read (escape guard), coexists with confinement', async () => {
    const r = registry({ protected: [], denyRead: [], allow: [], confinement: true });
    const rd = await r.execute({ toolCallId: '1', toolName: 'Read', arguments: { path: '../../environ' } }, ctx());
    expect(rd.error).toBeDefined();
    expect(rd.error?.message).toMatch(/escapes workspace/);
  });

  it('symlink: a workspace directory junction pointing outside is rejected as symlink escape', async () => {
    const link = path.join(dir, 'evil-link');
    const target = path.join(outsideDir, 'target-dir');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'leak.txt'), 'sensitive');
    try {
      // directory junction works without admin on Windows; on non-win it's a symlink
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      // symlink unsupported on this host — skip (honest limitation)
      return;
    }
    const r = registry({ protected: [], denyRead: [], allow: [], confinement: true });
    const rd = await r.execute({ toolCallId: '1', toolName: 'Read', arguments: { path: 'evil-link/leak.txt' } }, ctx());
    expect(rd.error).toBeDefined();
    expect(rd.error?.message.toLowerCase()).toMatch(/symlink escapes workspace/);
  });

  it('searchTools Grep obeys confinement (skips out-of-allow files), coexists with existing guards', async () => {
    const cfg: FsPolicyConfig = { protected: [], denyRead: ['secret/**'], allow: [], confinement: true };
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'const needle = 1;');
    fs.mkdirSync(path.join(dir, 'secret'));
    fs.writeFileSync(path.join(dir, 'secret', 'b.js'), 'needle 2');
    const r = new ToolRegistry([...createSearchTools({ workspaceRoot: dir, fsPolicy: cfg })]);
    const g = await r.execute({ toolCallId: '1', toolName: 'Grep', arguments: { pattern: 'needle' } }, ctx());
    expect(g.error).toBeUndefined();
    expect(g.content).toContain('src/a.js');
    // denyRead coexists: the secret file is excluded from results
    expect(g.content).not.toContain('secret/b.js');
  });
});

/**
 * Symlink escape with a NON-EXISTENT target — the fail-open hole this block
 * pins down. `canonicalize` used to swallow every non-FsGuardError thrown by its
 * `realpathSync` pair, so a workspace-relative path whose final component did
 * not exist yet (i.e. every fresh Write) skipped the symlink check entirely:
 * an in-workspace junction/symlink pointing outside the workspace was enough to
 * write a brand-new file out of bounds. Fix = errno split (non-ENOENT → deny,
 * ENOENT → verify the deepest EXISTING ancestor), see guards.ts.
 */
describe('tools/filesystem — symlink escape with a non-existent target (fail-closed)', () => {
  let root: string;
  let outsideDir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-link-root-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-link-out-'));
  });
  afterEach(() => {
    for (const d of [root, outsideDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  function registry(cfg: FsPolicyConfig): ToolRegistry {
    return new ToolRegistry([...createFsTools({ workspaceRoot: root, fsPolicy: cfg })]);
  }
  function ctx() {
    return { workspaceRoot: root, cwd: root, sandbox: { confine: async () => ({ argv: [] as string[], enforcement: 'none' as const }), status: () => ({ enabled: false, supported: 'none' as const, active: false }) } };
  }
  const CONFINED: FsPolicyConfig = { protected: [], denyRead: [], allow: [], confinement: true };
  const UNCONFINED: FsPolicyConfig = { protected: [], denyRead: [], allow: [], confinement: false };

  it.skipIf(!CAN_CREATE_DIR_LINK)('deny: Write through an in-workspace link to an out-of-workspace dir whose target file is ABSENT (attack form A) — nothing is created outside', async () => {
    fs.symlinkSync(outsideDir, path.join(root, 'evil-link'), LINK_KIND);
    const outsideFile = path.join(outsideDir, 'authorized_keys');
    expect(fs.existsSync(outsideFile)).toBe(false); // premise: the target file does not exist
    const w = await registry(CONFINED).execute(
      { toolCallId: '1', toolName: 'Write', arguments: { path: 'evil-link/authorized_keys', content: 'ssh-rsa AAAA' } },
      ctx(),
    );
    expect(w.error?.errorClass).toBe('DENIED');
    expect(w.error?.message.toLowerCase()).toMatch(/symlink escapes workspace/);
    // decisive: the out-of-workspace dir is untouched (no file, no directory)
    expect(fs.existsSync(outsideFile)).toBe(false);
    expect(fs.readdirSync(outsideDir)).toEqual([]);
  });

  it.skipIf(!CAN_CREATE_DIR_LINK)('deny: attack form A is caught with confinement OFF too (guard is independent of the allow set)', async () => {
    fs.symlinkSync(outsideDir, path.join(root, 'evil-link'), LINK_KIND);
    const outsideFile = path.join(outsideDir, 'authorized_keys');
    const w = await registry(UNCONFINED).execute(
      { toolCallId: '1', toolName: 'Write', arguments: { path: 'evil-link/authorized_keys', content: 'ssh-rsa AAAA' } },
      ctx(),
    );
    expect(w.error?.errorClass).toBe('DENIED');
    expect(fs.existsSync(outsideFile)).toBe(false);
  });

  it.skipIf(!CAN_CREATE_DIR_LINK)('deny: nested path under an out-of-workspace link (no target dir, no target file) — deepest existing ancestor is the link', async () => {
    fs.symlinkSync(outsideDir, path.join(root, 'evil-link'), LINK_KIND);
    const w = await registry(CONFINED).execute(
      { toolCallId: '1', toolName: 'Write', arguments: { path: 'evil-link/nested/deep/authorized_keys', content: 'x' } },
      ctx(),
    );
    expect(w.error?.errorClass).toBe('DENIED');
    expect(w.error?.message.toLowerCase()).toMatch(/symlink escapes workspace/);
    expect(fs.existsSync(path.join(outsideDir, 'nested'))).toBe(false);
    expect(fs.readdirSync(outsideDir)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32' || !CAN_CREATE_DIR_LINK)('deny: a DANGLING symlink as the final component is rejected — writing through it would create the file outside the workspace', async () => {
    // POSIX: realpath(link) → ENOENT while lstat(link) → exists. The link itself
    // is the deepest existing ancestor, so it must be denied (Windows needs
    // elevation for file symlinks, hence the skip there).
    const outsideFile = path.join(outsideDir, 'dangling-target.txt');
    fs.symlinkSync(outsideFile, path.join(root, 'dangling-link'), 'file');
    expect(fs.lstatSync(path.join(root, 'dangling-link')).isSymbolicLink()).toBe(true);
    const w = await registry(CONFINED).execute(
      { toolCallId: '1', toolName: 'Write', arguments: { path: 'dangling-link', content: 'pwn' } },
      ctx(),
    );
    expect(w.error?.errorClass).toBe('DENIED');
    expect(w.error?.message.toLowerCase()).toMatch(/symlink escapes workspace/);
    // decisive: the symlink target was NOT created outside the workspace
    expect(fs.existsSync(outsideFile)).toBe(false);
  });

  it('allow: creating a brand-new in-workspace file still succeeds (negative control — ENOENT is NOT denied)', async () => {
    const r = registry(CONFINED);
    const w = await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'src/new.ts', content: 'export const x = 1;' } }, ctx());
    expect(w.error).toBeUndefined();
    expect(fs.readFileSync(path.join(root, 'src', 'new.ts'), 'utf8')).toBe('export const x = 1;');
    // every intermediate directory is missing too — deepest existing ancestor is the root
    const w2 = await r.execute({ toolCallId: '2', toolName: 'Write', arguments: { path: 'a/b/c/d.txt', content: 'deep' } }, ctx());
    expect(w2.error).toBeUndefined();
    expect(fs.readFileSync(path.join(root, 'a', 'b', 'c', 'd.txt'), 'utf8')).toBe('deep');
    // Edit of an existing file is unaffected by the hardened ENOENT path
    const e = await r.execute({ toolCallId: '3', toolName: 'Edit', arguments: { path: 'src/new.ts', old_string: '1', new_string: '2' } }, ctx());
    expect(e.error).toBeUndefined();
    expect(fs.readFileSync(path.join(root, 'src', 'new.ts'), 'utf8')).toBe('export const x = 2;');
  });

  it('regression: existing-file read/overwrite and lexical escape denials keep their previous verdicts', async () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'v1');
    const r = registry(CONFINED);
    const rd = await r.execute({ toolCallId: '1', toolName: 'Read', arguments: { path: 'src/a.txt' } }, ctx());
    expect(rd.error).toBeUndefined();
    expect(rd.content).toBe('v1');
    // absolute path inside the workspace still resolves
    const absIn = await r.execute({ toolCallId: '2', toolName: 'Read', arguments: { path: path.join(root, 'src', 'a.txt') } }, ctx());
    expect(absIn.content).toBe('v1');
    const ov = await r.execute({ toolCallId: '3', toolName: 'Write', arguments: { path: 'src/a.txt', content: 'v2' } }, ctx());
    expect(ov.error).toBeUndefined();
    expect(fs.readFileSync(path.join(root, 'src', 'a.txt'), 'utf8')).toBe('v2');
    // '..' escape unchanged
    const up = await r.execute({ toolCallId: '4', toolName: 'Read', arguments: { path: '../../escape.txt' } }, ctx());
    expect(up.error?.errorClass).toBe('DENIED');
    expect(up.error?.message).toMatch(/escapes workspace/);
    // absolute out-of-workspace path unchanged
    const absOut = await r.execute({ toolCallId: '5', toolName: 'Write', arguments: { path: path.join(outsideDir, 'nope.txt'), content: 'x' } }, ctx());
    expect(absOut.error?.errorClass).toBe('DENIED');
    expect(absOut.error?.message).toMatch(/escapes workspace/);
    expect(fs.existsSync(path.join(outsideDir, 'nope.txt'))).toBe(false);
  });

  it('fail-closed: a NON-ENOENT realpath failure is denied instead of silently skipped', () => {
    // premise (asserted, not assumed): a NUL-bearing path is rejected by node
    // itself with a non-ENOENT errno, so this exercises the errno split without
    // mocking node:fs.
    let premise: string | undefined;
    try {
      fs.realpathSync.native(path.join(root, 'nul\u0000probe'));
    } catch (e) {
      premise = (e as NodeJS.ErrnoException).code;
    }
    expect(premise).toBeDefined();
    expect(premise).not.toBe('ENOENT');
    const cfg: FsPolicyConfig = { protected: [], denyRead: [], allow: [] };
    let thrown: unknown;
    try {
      canonicalize(root, 'nul\u0000name.txt', cfg);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(FsGuardError);
    expect((thrown as FsGuardError).guard).toBe('escape');
    expect((thrown as Error).message).toMatch(/cannot verify path is inside workspace/);
  });

  it.skipIf(process.platform === 'win32')('fail-closed: a symlink loop (ELOOP) is denied — POSIX only', () => {
    // self-referential symlink: realpath cannot terminate → ELOOP (POSIX).
    // Windows needs elevation for file symlinks, so this case is skipped there.
    fs.symlinkSync('loop', path.join(root, 'loop'));
    const cfg: FsPolicyConfig = { protected: [], denyRead: [], allow: [] };
    let thrown: unknown;
    try {
      canonicalize(root, 'loop', cfg);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(FsGuardError);
    expect((thrown as FsGuardError).guard).toBe('escape');
  });
});