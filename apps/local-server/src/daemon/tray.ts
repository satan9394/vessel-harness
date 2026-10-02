import { spawn } from 'node:child_process';
import type { DaemonInfo } from './types.js';

/** Built-in Windows tray surface; other platforms retain their native notification service. */
export function residentTrayScript(info: DaemonInfo): string {
  const literal = (text: string) => `'${text.replace(/'/g, "''")}'`;
  return `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$tokenPath=${literal(info.tokenPath)}
$daemonPid=${info.pid}
$instanceId=${literal(info.instanceId)}
$base='http://127.0.0.1:${info.port}'
$context=New-Object System.Windows.Forms.ApplicationContext
$icon=New-Object System.Windows.Forms.NotifyIcon
$icon.Icon=[System.Drawing.SystemIcons]::Application
$icon.Text='Vessel daemon'
$menu=New-Object System.Windows.Forms.ContextMenuStrip
$open=$menu.Items.Add('Open Vessel')
$open.Add_Click({ [System.Diagnostics.Process]::Start($base+'/api/health') > $null })
$stop=$menu.Items.Add('Stop Vessel daemon')
$stop.Add_Click({
 try { $token=[System.IO.File]::ReadAllText($tokenPath).Trim(); Invoke-RestMethod -Method Post -Uri ($base+'/api/daemon/stop') -Headers @{Authorization=('Bearer '+$token)} -TimeoutSec 1 > $null }
 catch { $context.ExitThread() }
})
$icon.ContextMenuStrip=$menu
$icon.Add_DoubleClick({ [System.Diagnostics.Process]::Start($base+'/api/health') > $null })
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=1000
$timer.Add_Tick({
 try {
  Get-Process -Id $daemonPid -ErrorAction Stop > $null
  $token=[System.IO.File]::ReadAllText($tokenPath).Trim()
  if($token -notmatch '^[0-9a-f]{48}$') { $context.ExitThread(); return }
  $status=Invoke-RestMethod -Uri ($base+'/api/daemon/status') -Headers @{Authorization=('Bearer '+$token)} -TimeoutSec 1
  if($status.pid -ne $daemonPid -or $status.instanceId -ne $instanceId) { $context.ExitThread() }
 } catch { $context.ExitThread() }
})
try { $icon.Visible=$true; $timer.Start(); [System.Windows.Forms.Application]::Run($context) }
finally { $timer.Stop(); $timer.Dispose(); $icon.Visible=$false; $icon.Dispose(); $menu.Dispose(); $context.Dispose() }`;
}

export function startResidentTray(info: DaemonInfo, platform = process.platform, launch = spawn): void {
  if (platform !== 'win32') return;
  try {
    const child = launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(residentTrayScript(info), 'utf16le').toString('base64')], {
      windowsHide: true, stdio: 'ignore', detached: false,
    });
    child.on('error', () => {});
    child.unref();
  } catch { /* ponytail: a headless desktop can still run the daemon. */ }
}
