import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformSandboxRunner, allowedWriteRoots } from './platformSandbox.js';

const result = (exitCode = 0) => ({ stdout: 'mock', stderr: '', exitCode, timedOut: false, killed: false });
describe('native platform sandbox', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'vessel-platform-test-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('probes usable bubblewrap namespaces and mounts the host read-only plus writable whitelist', async () => {
    const run = vi.fn().mockResolvedValue(result()); const audit = vi.fn();
    const runner = new PlatformSandboxRunner({ platform: 'linux', run, audit });
    const controller = new AbortController();
    const actual = await runner.execute('/bin/sh', ['-c', 'mock'], { cwd, allowedWritePaths: [cwd], signal: controller.signal });
    expect(actual).toMatchObject({ sandboxed: true, isolationTier: 'bwrap-ns', constraints: { readOnlyPaths: ['/'], memoryLimitBytes: null } });
    expect(run.mock.calls[0]![1]).toContain('--unshare-all');
    expect(run.mock.calls[0]![0]).toBe('/usr/bin/bwrap');
    expect(run.mock.calls[1]![0]).toBe('/usr/bin/bwrap');
    expect(run.mock.calls[1]![1]).toEqual(['--die-with-parent', '--unshare-all', '--new-session', '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', '--bind', cwd, cwd, '--chdir', cwd, '--', '/bin/sh', '-c', 'mock']);
    expect(run.mock.calls[1]![2]).toMatchObject({ signal: controller.signal, shell: false, processGroup: true });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'enforced', constraints: actual.constraints }));
  });

  it('uses Seatbelt deny-write profile with properly escaped subpaths', async () => {
    const run = vi.fn().mockResolvedValue(result());
    const runner = new PlatformSandboxRunner({ platform: 'darwin', run });
    expect((await runner.execute('/bin/sh', ['-c', 'mock'], { cwd, allowedWritePaths: [cwd] })).isolationTier).toBe('macos-seatbelt');
    expect(run.mock.calls[1]![0]).toBe('/usr/bin/sandbox-exec');
    expect(run.mock.calls[1]![1][1]).toBe(`(version 1) (allow default) (deny file-write*) (allow file-write* (subpath ${JSON.stringify(cwd)}))`);
  });

  it('audits unavailable helper fallback, and awaits the audit sink', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValue(result());
    const seen: string[] = [];
    const runner = new PlatformSandboxRunner({ platform: 'linux', run, audit: async event => { await Promise.resolve(); seen.push(event.outcome); } });
    expect(await runner.execute('/bin/sh', ['-c', 'mock'], { cwd })).toMatchObject({ isolationTier: 'passthrough-fallback', sandboxed: false });
    expect(run.mock.calls[1]![0]).toBe('/bin/sh'); expect(seen).toEqual(['fallback']);
  });

  it('does not replay an execution failure through fallback', async () => {
    const run = vi.fn().mockResolvedValueOnce(result()).mockRejectedValueOnce(new Error('execution failure'));
    await expect(new PlatformSandboxRunner({ platform: 'linux', run }).execute('/bin/sh', [], { cwd })).rejects.toThrow('execution failure');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports nonzero sandbox child exit without claiming fallback', async () => {
    const run = vi.fn().mockResolvedValueOnce(result()).mockResolvedValueOnce(result(7));
    expect(await new PlatformSandboxRunner({ platform: 'linux', run }).execute('/bin/sh', [], { cwd })).toMatchObject({ sandboxed: true, exitCode: 7 });
  });

  it('rejects invalid resources, unsupported POSIX memory caps and cancelled work before target execution', async () => {
    const run = vi.fn().mockResolvedValue(result()); const runner = new PlatformSandboxRunner({ platform: 'linux', run });
    await expect(runner.execute('/bin/sh', [], { cwd, cpuTimeoutMs: -1 })).rejects.toThrow('positive integers');
    const controller = new AbortController(); controller.abort();
    await expect(runner.execute('/bin/sh', [], { cwd, signal: controller.signal })).rejects.toThrow('interrupted');
    expect(run).not.toHaveBeenCalled();
    await expect(runner.execute('/bin/sh', [], { cwd, maxMemoryBytes: 1024 })).rejects.toThrow('POSIX helpers');
    expect(run).toHaveBeenCalledOnce();
  });

  it('canonicalizes directory junctions so write mounts cannot escape', () => {
    const link = join(cwd, 'outside');
    symlinkSync(process.cwd(), link, 'junction');
    expect(() => allowedWriteRoots({ cwd, allowedWritePaths: [link] })).toThrow('outside worktree/temp');
    mkdirSync(join(cwd, 'inside'));
    expect(allowedWriteRoots({ cwd, allowedWritePaths: ['inside'] })).toEqual([join(cwd, 'inside')]);
  });
});
