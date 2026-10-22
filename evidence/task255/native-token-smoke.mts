/**
 * Task 255 native smoke probe.
 *
 * Executes the production Windows restricted launcher for real (no mocks) against a
 * self-created, explicitly provisioned temp directory, and reports whether the child
 * actually runs under a Low-integrity restricted token.
 *
 * Before the fix, CreateRestrictedToken's handle lacks TOKEN_ADJUST_DEFAULT, so
 * SetTokenInformation(TokenIntegrityLevel) returned ERROR_ACCESS_DENIED and no child launched.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WindowsRestrictedRunner, restrictedWriteSid } from '../../packages/tools/src/execution/sandbox/windowsRestricted.js';

const dir = mkdtempSync(join(tmpdir(), 'vessel-sandbox-smoke-'));
const sid = restrictedWriteSid(dir);
const runner = new WindowsRestrictedRunner();
const report: Record<string, unknown> = { platform: process.platform, cwd: dir, restrictedSid: sid };

const provision = `
$ErrorActionPreference = 'Stop'
$dir = '${dir}'
$sidStr = '${sid}'
$di = New-Object System.IO.DirectoryInfo $dir
$acl = $di.GetAccessControl()
$sid = New-Object System.Security.Principal.SecurityIdentifier $sidStr
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule $sid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
$di.SetAccessControl($acl)
icacls $dir /setintegritylevel '(OI)(CI)Low' | Out-Null
`;

try {
  // Out-of-band ACL provisioning for this self-created temp root: Low mandatory label + restricted SID write grant.
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', provision], { encoding: 'utf8' });
  report.provisioned = true;

  report.available = await runner.isAvailable();

  // 1) Plain command execution: proves the restricted token is built, relabeled, and a child is launched.
  const echo = await runner.execute('cmd.exe', ['/c', 'echo sandbox-ok'], { cwd: dir, allowedWritePaths: [dir], cpuTimeoutMs: 20_000 });
  report.echo = { stdout: echo.stdout.trim(), stderr: echo.stderr.trim(), exitCode: echo.exitCode, tier: echo.isolationTier, sandboxed: echo.sandboxed };

  // 2) Native integrity label of the child token: requires the relabel to have succeeded.
  const whoami = await runner.execute('cmd.exe', ['/c', 'whoami /groups'], { cwd: dir, allowedWritePaths: [dir], cpuTimeoutMs: 20_000 });
  const mandatory = whoami.stdout
    .split(/\r?\n/)
    .filter(line => /mandatory label|强制标签/i.test(line))
    .map(line => line.trim());
  report.integrityLabelLines = mandatory;
  report.lowIntegrityProven = mandatory.some(line => /S-1-16-4096/.test(line));
  report.untrustedIntegrity = mandatory.some(line => /S-1-16-0\b/.test(line));

  // 3) Writable root actually usable by the Low-integrity child.
  const write = await runner.execute('cmd.exe', ['/c', 'echo probe>write-probe.txt && type write-probe.txt'], { cwd: dir, allowedWritePaths: [dir], cpuTimeoutMs: 20_000 });
  report.write = { stdout: write.stdout.trim(), stderr: write.stderr.trim(), exitCode: write.exitCode };

  report.pass = report.echo.exitCode === 0
    && report.echo.stdout === 'sandbox-ok'
    && (report.lowIntegrityProven === true || report.untrustedIntegrity === true)
    && report.write.exitCode === 0;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.pass = false;
} finally {
  // Self-created temp directory: recycle it, then drop the temporary restricted-SID grant.
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName Microsoft.VisualBasic; icacls '${dir}' /remove:g '*${sid}' | Out-Null; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${dir}','OnlyErrorDialogs','SendToRecycleBin')`],
    { encoding: 'utf8' });
  } catch (error) {
    report.cleanupError = error instanceof Error ? error.message : String(error);
  }
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.pass === true ? 0 : 1;
