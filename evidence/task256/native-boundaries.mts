/** Host-run supplement to task255/native-token-smoke.mts. Only self-created temp fixtures are provisioned. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { WindowsRestrictedRunner, restrictedWriteSid } from '../../packages/tools/src/execution/sandbox/windowsRestricted.js';
import { PlatformSandboxRunner } from '../../packages/tools/src/execution/sandbox/platformSandbox.js';

const roots = ['allowed', 'outside', 'unprovisioned', 'access-denied'].map(name => mkdtempSync(join(tmpdir(), `vessel-256-${name}-`)));
const [cwd, outside, unprovisioned, accessDenied] = roots as [string, string, string, string];
const sid = restrictedWriteSid(cwd);
const events: unknown[] = [];
const runner = new PlatformSandboxRunner({ audit: event => { events.push(event); } });
const report: Record<string, any> = { cwd, outside, sid };
const ps = (script: string) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000 });
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
try {
  for (const root of [cwd, outside, accessDenied]) {
    // Outside is Low too: denial must come from the restricted SID, not Medium mandatory integrity.
    const rights = root === cwd ? 'Modify' : 'ReadAndExecute';
    ps(`$ErrorActionPreference='Stop'; $d=New-Object IO.DirectoryInfo ${quote(root)}; $a=$d.GetAccessControl();
      ${root === outside ? '' : `$s=New-Object Security.Principal.SecurityIdentifier '${sid}'; $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule $s,'${rights}','ContainerInherit,ObjectInherit','None','Allow')); $d.SetAccessControl($a);`}
      icacls ${quote(root)} /setintegritylevel '(OI)(CI)Low' | Out-Null; if($LASTEXITCODE -ne 0){throw 'Low label provisioning failed'}`);
  }
  const options = { cwd, allowedWritePaths: [cwd], cpuTimeoutMs: 20_000 };
  report.outsideWrite = await runner.execute('cmd.exe', ['/c', `echo started>outside-started.txt & echo escape>"${join(outside, 'escape.txt')}"`], options);
  report.outsideChildStarted = existsSync(join(cwd, 'outside-started.txt'));
  report.outsideFileExists = existsSync(join(outside, 'escape.txt'));
  // Direct native executable, no cmd/PowerShell intermediary; also reports actual child integrity.
  report.nonCmd = await runner.execute(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), ['/groups'], options);
  report.lowIntegrityProven = /S-1-16-(4096|0)\b/.test(report.nonCmd.stdout);
  report.denials = [];
  for (const root of [unprovisioned, accessDenied]) {
    try {
      await runner.execute('cmd.exe', ['/c', `echo unexpected>"${join(cwd, 'preflight-started.txt')}"`], { ...options, allowedWritePaths: [root] });
      report.denials.push({ root, denied: false });
    } catch (error) {
      const expected = root === unprovisioned ? 'requires provisioned' : 'restricted write access denied';
      report.denials.push({ root, denied: String(error).includes(expected), reason: String(error), childMarkerExists: existsSync(join(cwd, 'preflight-started.txt')) });
    }
  }
  // Disabling Low must fail before any helper invocation.
  let calls = 0;
  const noHelper = new WindowsRestrictedRunner({ run: async () => { calls++; throw new Error('unexpected helper'); } });
  try { await noHelper.execute('cmd.exe', [], { ...options, lowIntegrity: false }); }
  catch (error) { report.lowDisabled = { denied: /cannot be disabled/.test(String(error)), helperCalls: calls }; }
  report.events = events;
  report.pass = report.outsideWrite.exitCode !== 0 && report.outsideChildStarted && !report.outsideFileExists
    && report.nonCmd.exitCode === 0 && report.lowIntegrityProven
    && report.denials.every((d: any) => d.denied && d.childMarkerExists === false)
    && events.filter((e: any) => e.outcome === 'denied').length === 2
    && report.lowDisabled?.denied && calls === 0;
} catch (error) {
  report.error = String(error);
  report.pass = false;
} finally {
  for (const root of roots) {
    try { ps(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(${quote(root)},'OnlyErrorDialogs','SendToRecycleBin')`); }
    catch (error) { (report.cleanupErrors ??= []).push(String(error)); }
  }
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.pass === true ? 0 : 1;
