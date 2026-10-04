import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWindowsRestrictedScript, restrictedWriteSid, WindowsRestrictedRunner } from './windowsRestricted.js';
import { PlatformSandboxRunner, allowedWriteRoots } from './platformSandbox.js';
import { WINDOWS_RESTRICTED_SOURCE } from './windowsRestrictedSource.js';

const result = (stdout = '', exitCode = 0) => ({ stdout, stderr: '', exitCode, timedOut: false, killed: false });
describe('Windows restricted launcher', () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'vessel-restricted-test-')); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('disables administrator groups and privileges, restricts writes, and sets Low Integrity', () => {
    const script = buildWindowsRestrictedScript('cmd.exe', ['/c', 'echo mock'], { cwd, allowedWritePaths: [cwd] });
    expect(script).toContain('CreateRestrictedToken(original,1|8,1');
    expect(script).toContain('S-1-5-32-544'); expect(script).toContain('S-1-16-4096');
    expect(script).toContain('SetTokenInformation(token,25');
    expect(script.indexOf('AssignProcessToJobObject(job,process.process)')).toBeLessThan(script.indexOf('ResumeThread(process.thread)'));
    expect(script).toContain('0x4|0x8000000'); expect(script).toContain('0x2000|0x100|0x8|0x2');
    expect(script).not.toContain('Set-Acl'); expect(script).not.toContain('SetNamedSecurityInfo');
  });

  it('derives a stable per-worktree restricted SID and keeps injected shell data outside script syntax', () => {
    expect(restrictedWriteSid(cwd)).toBe(restrictedWriteSid(cwd.toUpperCase()));
    expect(restrictedWriteSid(cwd)).not.toBe(restrictedWriteSid(cwd + '-other'));
    const injected = "'; throw 'injected'; #";
    expect(buildWindowsRestrictedScript('cmd.exe', [injected], { cwd })).not.toContain(injected);
  });

  it('requires explicit Low mandatory labels and restricted write AccessCheck before launching', () => {
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('(ML;OICI;NW;;;LW)');
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('AccessCheck(sd,token,0x120116');
    expect(WINDOWS_RESTRICTED_SOURCE.indexOf('foreach(string root in roots) CheckRoot')).toBeLessThan(WINDOWS_RESTRICTED_SOURCE.indexOf('Check(CreateProcessAsUser'));
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('TerminateProcess(process.process,1)');
  });

  it('acknowledges provisioned execution only after the native helper confirms enforcement', async () => {
    const run = vi.fn().mockResolvedValue(result(JSON.stringify({ Stdout: 'mock', Stderr: '', ExitCode: 0, Enforced: true })));
    const runner = new WindowsRestrictedRunner({ run });
    expect(await runner.execute('cmd.exe', ['/c', 'echo mock'], { cwd, allowedWritePaths: [cwd], maxMemoryBytes: 1024, cpuTimeoutMs: 100 })).toMatchObject({ stdout: 'mock', sandboxed: true, isolationTier: 'windows-job-restricted', constraints: { readOnlyPaths: [], memoryLimitBytes: 1024 } });
    const script = run.mock.calls[0]![2].stdin;
    expect(run.mock.calls[0]![0]).toMatch(/System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
    expect(script).toContain('CreateRestrictedToken'); expect(run.mock.calls[0]![2]).toMatchObject({ timeoutMs: 30100, maxOutputBytes: 1048576 });
    expect((await runner.execute('cmd.exe', [], { cwd })).constraints?.memoryLimitBytes).toBe(512 * 1024 * 1024);
  });

  it('fails closed for unprovisioned ACLs with no fallback or command replay', async () => {
    const run = vi.fn().mockResolvedValue({ ...result('', 1), stderr: 'sandbox directory requires provisioned Low Integrity and restricted SID ACL' });
    const audit = vi.fn();
    const runner = new PlatformSandboxRunner({ platform: 'win32', run, windows: new WindowsRestrictedRunner({ run }), audit });
    await expect(runner.execute('cmd.exe', ['/c', 'mock'], { cwd })).rejects.toThrow('requires provisioned');
    expect(run).toHaveBeenCalledOnce(); expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'denied', sandboxed: false }));
  });

  it('rejects missing native acknowledgement, interruption and disabling Low Integrity', async () => {
    const run = vi.fn().mockResolvedValue(result('{}'));
    const runner = new WindowsRestrictedRunner({ run });
    await expect(runner.execute('cmd.exe', [], { cwd })).rejects.toThrow('acknowledgement');
    await expect(runner.execute('cmd.exe', [], { cwd, lowIntegrity: false })).rejects.toThrow('cannot be disabled');
    run.mockResolvedValue({ ...result(), killed: true });
    await expect(runner.execute('cmd.exe', [], { cwd })).rejects.toThrow('interrupted');
  });

  it('rejects write roots outside the worktree and system temp', () => {
    expect(() => allowedWriteRoots({ cwd, allowedWritePaths: [process.cwd()] })).toThrow('outside worktree/temp');
    expect(allowedWriteRoots({ cwd, allowedWritePaths: [cwd] })).toEqual([cwd]);
  });

  it('validates direct runner options before starting any helper', async () => {
    const run = vi.fn(); const runner = new WindowsRestrictedRunner({ run });
    await expect(runner.execute('cmd.exe', [], { cwd, allowedWritePaths: [] })).rejects.toThrow('write root');
    await expect(runner.execute('cmd.exe', [], { cwd, allowedWritePaths: [process.cwd()] })).rejects.toThrow('outside worktree/temp');
    await expect(runner.execute('cmd.exe', [], { cwd, maxMemoryBytes: -1 })).rejects.toThrow('positive integers');
    const controller = new AbortController(); controller.abort();
    await expect(runner.execute('cmd.exe', [], { cwd, signal: controller.signal })).rejects.toThrow('interrupted');
    expect(run).not.toHaveBeenCalled();
  });
});
