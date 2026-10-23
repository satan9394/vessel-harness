/**
 * Task 256 native smoke probe.
 *
 * Runs the production Windows restricted launcher for real against a self-created,
 * out-of-band provisioned temp root and reports:
 *  - whether a child process actually starts,
 *  - the integrity RID of the child's own token (4096 = Low),
 *  - that a provisioned write root is writable,
 *  - that writing outside every provisioned root is denied.
 *
 * whoami is deliberately not used: under this restricted token it dies in DLL init, so the
 * launcher reports the child token's integrity directly instead of inferring it.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WindowsRestrictedRunner, restrictedWriteSid } from '../../packages/tools/src/execution/sandbox/windowsRestricted.js';

const dir = mkdtempSync(join(tmpdir(), 'vessel-sandbox-smoke-'));
const outside = mkdtempSync(join(tmpdir(), 'vessel-sandbox-outside-'));
const sid = restrictedWriteSid(dir);
const runner = new WindowsRestrictedRunner();
const report: Record<string, unknown> = { platform: process.platform, cwd: dir, outside, restrictedSid: sid };

const provision = `
$ErrorActionPreference = 'Stop'
$di = New-Object System.IO.DirectoryInfo '${dir}'
$acl = $di.GetAccessControl()
$sid = New-Object System.Security.Principal.SecurityIdentifier '${sid}'
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule $sid, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
$di.SetAccessControl($acl)
icacls '${dir}' /setintegritylevel '(OI)(CI)Low' | Out-Null
`;

try {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', provision], { encoding: 'utf8' });
  report.provisioned = true;
  report.available = await runner.isAvailable();

  const echo = await runner.execute('cmd.exe', ['/c', 'echo sandbox-ok'], { cwd: dir, allowedWritePaths: [dir], cpuTimeoutMs: 20_000 });
  report.echo = { stdout: echo.stdout.trim(), stderr: echo.stderr.trim(), exitCode: echo.exitCode, tier: echo.isolationTier, integrityRid: echo.constraints?.integrityRid };

  const write = await runner.execute('cmd.exe', ['/c', 'echo probe>write-probe.txt && type write-probe.txt'], { cwd: dir, allowedWritePaths: [dir], cpuTimeoutMs: 20_000 });
  report.write = { stdout: write.stdout.trim(), stderr: write.stderr.trim(), exitCode: write.exitCode };

  const blocked = await runner.execute('cmd.exe', ['/c', `echo nope> "${join(outside, 'nope.txt')}"`], { cwd: dir, allowedWritePaths: [dir], cpuTimeoutMs: 20_000 });
  report.writeOutside = { exitCode: blocked.exitCode, stderr: blocked.stderr.trim().slice(0, 120) };

  const rid = echo.constraints?.integrityRid;
  report.lowIntegrityProven = rid === 4096 || rid === 0;
  report.checks = { echoOk: echo.exitCode === 0, echoText: echo.stdout.trim() === 'sandbox-ok', low: report.lowIntegrityProven === true, writeOk: write.exitCode === 0, outsideDenied: blocked.exitCode !== 0 };
  report.pass = Object.values(report.checks as Record<string, boolean>).every(Boolean);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.pass = false;
} finally {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName Microsoft.VisualBasic; icacls '${dir}' /remove:g '*${sid}' | Out-Null; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${dir}','OnlyErrorDialogs','SendToRecycleBin'); [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${outside}','OnlyErrorDialogs','SendToRecycleBin')`],
    { encoding: 'utf8' });
  } catch (error) {
    report.cleanupError = error instanceof Error ? error.message : String(error);
  }
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.pass === true ? 0 : 1;
