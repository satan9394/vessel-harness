import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFsTools, createSearchTools } from '../index.js';
import { ToolRegistry } from '../registry/Registry.js';
import {
  assertConfined,
  isWithinAllow,
  type FsPolicyConfig,
} from './guards.js';

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