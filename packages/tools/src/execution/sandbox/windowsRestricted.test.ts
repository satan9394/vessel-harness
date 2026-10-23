import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(script).toContain('true,0x4|0x8,IntPtr.Zero,cwd'); expect(script).toContain('0x2000|0x100|0x8|0x2');
    expect(script).toContain('flags=0x100,input=ri,output=wo,error=we');
    expect(script.indexOf('CloseHandle(wi); wi=IntPtr.Zero;')).toBeLessThan(script.indexOf('Check(CreateProcessAsUser'));
    expect(script).not.toContain('Set-Acl'); expect(script).not.toContain('SetNamedSecurityInfo');
  });

  it('requests integrity adjustment rights and fails closed unless the token is verified Low', () => {
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('OpenProcessToken(GetCurrentProcess(),0x2B,out original)');
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('if(IntegrityRid(token)<=4096) return;');
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('if(IntegrityRid(token)>4096) throw new Win32Exception(error,"SetTokenIntegrityLevel")');
    // CreateRestrictedToken 的句柄不带 TOKEN_ADJUST_DEFAULT：降级必须在 0x1F01FF 的主令牌副本上做，并从该副本启动。
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('DuplicateTokenEx(token,0x1F01FF,IntPtr.Zero,2,1,out primary)');
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('SetLowIntegrity(primary,ref label)');
    expect(WINDOWS_RESTRICTED_SOURCE).not.toContain('SetLowIntegrity(token,ref label)');
    expect(WINDOWS_RESTRICTED_SOURCE.indexOf('DuplicateTokenEx(token,0x1F01FF,IntPtr.Zero,2,1,out primary)'))
      .toBeLessThan(WINDOWS_RESTRICTED_SOURCE.indexOf('SetLowIntegrity(primary,ref label)'));
    expect(WINDOWS_RESTRICTED_SOURCE.indexOf('SetLowIntegrity(primary,ref label)'))
      .toBeLessThan(WINDOWS_RESTRICTED_SOURCE.indexOf('Check(CreateProcessAsUser(primary,'));
  });

  it.skipIf(process.platform !== 'win32')('compiles the production C# launcher on Windows', () => {
    const source = join(cwd, 'VesselRestricted.cs');
    writeFileSync(source, WINDOWS_RESTRICTED_SOURCE);
    const compiler = join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    expect(() => execFileSync(compiler, ['/nologo', '/target:library', `/out:${join(cwd, 'VesselRestricted.dll')}`, source], { encoding: 'utf8', timeout: 30000 })).not.toThrow();
  }, 40000);

  it('derives a stable per-worktree restricted SID and keeps injected shell data outside script syntax', () => {
    expect(restrictedWriteSid(cwd)).toBe(restrictedWriteSid(cwd.toUpperCase()));
    expect(restrictedWriteSid(cwd)).not.toBe(restrictedWriteSid(cwd + '-other'));
    const injected = "'; throw 'injected'; #";
    expect(buildWindowsRestrictedScript('cmd.exe', [injected], { cwd })).not.toContain(injected);
  });

  it('requires explicit Low mandatory labels and restricted write AccessCheck before launching', () => {
    // AccessCheck 需要描述符自带 owner/group，否则固定返回 ERROR_INVALID_SECURITY_DESCR(1338)。
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('GetNamedSecurityInfo(root,1,1|2|4|16,');
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('(ML;OICI;NW;;;LW)');
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('AccessCheck(sd,token,0x120116');
    expect(WINDOWS_RESTRICTED_SOURCE.indexOf('foreach(string root in roots) CheckRoot')).toBeLessThan(WINDOWS_RESTRICTED_SOURCE.indexOf('Check(CreateProcessAsUser'));
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('TerminateProcess(process.process,1)');
  });

  it('does not quote arguments that do not need it, and reports the child token integrity', () => {
    // 无条件加引号会把 /c 变成 "/c"，受限令牌下 cmd 对内置命令的解析会失败。
    expect(WINDOWS_RESTRICTED_SOURCE).toContain("if(s.Length>0 && s.IndexOfAny(new[]{' ','\\t','\\n','\\v','\"'})<0) return s;");
    expect(WINDOWS_RESTRICTED_SOURCE).toContain('ChildIntegrityRid=childRid');
  });

  it('surfaces the child integrity RID when the launcher reports it', async () => {
    const run = vi.fn().mockResolvedValue(result(JSON.stringify({ Stdout: 'ok', Stderr: '', ExitCode: 0, Enforced: true, ChildIntegrityRid: 4096 })));
    const runner = new WindowsRestrictedRunner({ run });
    const executed = await runner.execute('cmd.exe', ['/c', 'echo ok'], { cwd, allowedWritePaths: [cwd] });
    expect(executed.constraints?.integrityRid).toBe(4096);
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

  it.each([
    'sandbox directory requires provisioned Low Integrity and restricted SID ACL',
    'SetTokenIntegrityLevel',
    'sandbox restricted write access denied',
  ])('fails closed for %s with no fallback or command replay', async (reason) => {
    const run = vi.fn().mockResolvedValue({ ...result('', 1), stderr: reason });
    const audit = vi.fn();
    const runner = new PlatformSandboxRunner({ platform: 'win32', run, windows: new WindowsRestrictedRunner({ run }), audit });
    await expect(runner.execute('cmd.exe', ['/c', 'mock'], { cwd })).rejects.toThrow(reason);
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
