# Prepare a workspace for Vessel's restricted-token sandbox, or undo it.
#
#   .\scripts\provision-sandbox.ps1 -Path E:\Code_file\Projects\MyProject
#   .\scripts\provision-sandbox.ps1 -Path E:\Code_file\Projects\MyProject -Revoke
#
# Why this is a manual step: the sandbox runs child processes under a restricted token whose
# restricting SID must be granted access to the workspace, and the directory needs a Low mandatory
# label. Codex's Windows sandbox does the same at setup time with elevation; Claude Code does not
# sandbox on native Windows at all. We follow the Codex shape: explicit, once, reversible - never a
# silent ACL change during a session.
#
# The SID must match packages/tools/src/execution/sandbox/windowsRestricted.ts `restrictedWriteSid`:
#   sha256(lowercase(realpath(cwd))) -> three little-endian uint32s -> S-1-5-21-a-b-c-183
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [switch]$Revoke
)

$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $Path).Path
if (-not (Test-Path -LiteralPath $resolved -PathType Container)) { throw "not a directory: $resolved" }

$bytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($resolved.ToLowerInvariant()))
$sid = 'S-1-5-21-{0}-{1}-{2}-183' -f ([BitConverter]::ToUInt32($bytes, 0)), ([BitConverter]::ToUInt32($bytes, 4)), ([BitConverter]::ToUInt32($bytes, 8))

if ($Revoke) {
  # icacls /remove:g *<sid> answers 1332 "no mapping between account names and security IDs"
  # for a SID that does not exist in the local account database, so remove the ACE through .NET
  # (the same API that added it) instead.
  $di = New-Object System.IO.DirectoryInfo $resolved
  $acl = $di.GetAccessControl()
  $sidObject = New-Object System.Security.Principal.SecurityIdentifier $sid
  foreach ($ace in @($acl.Access)) {
    if ($ace.IdentityReference -eq $sidObject) { $acl.RemoveAccessRuleSpecific($ace) | Out-Null }
  }
  $di.SetAccessControl($acl)
  & icacls $resolved /setintegritylevel '(OI)(CI)Medium' | Out-Null

  $sddl = (New-Object System.IO.DirectoryInfo $resolved).GetAccessControl().Sddl
  $stillGranted = $sddl.Contains(';;;' + $sid)
  # Match the level *name*: Low and Medium labels both carry the (NW) no-write-up policy, so the
  # flag pattern alone cannot tell them apart.
  $stillLow = ((& icacls $resolved) -join "`n") -match 'Low Mandatory Level'
  Write-Host "workspace : $resolved"
  Write-Host "sandbox SID: $sid (removed=$(-not $stillGranted))"
  Write-Host "low label  : $stillLow"
  if ($stillGranted -or $stillLow) { Write-Error 'revoke verification failed'; exit 1 }
  Write-Host "revoked sandbox preparation from $resolved (SID $sid)"
  exit 0
}

$di = New-Object System.IO.DirectoryInfo $resolved
$acl = $di.GetAccessControl()
$sidObject = New-Object System.Security.Principal.SecurityIdentifier $sid
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule $sidObject, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
$acl.AddAccessRule($rule)
$di.SetAccessControl($acl)
& icacls $resolved /setintegritylevel '(OI)(CI)Low' | Out-Null

# Verify with the same two facts the launcher checks before it will start a child.
$sddl = (New-Object System.IO.DirectoryInfo $resolved).GetAccessControl().Sddl
$hasGrant = $sddl.Contains(';;;' + $sid)
$label = & icacls $resolved
$hasLow = ($label -join "`n") -match 'Low Mandatory Level'
Write-Host "workspace : $resolved"
Write-Host "sandbox SID: $sid (granted=$hasGrant)"
Write-Host "low label  : $hasLow"
if (-not $hasGrant -or -not $hasLow) { Write-Error 'provisioning verification failed'; exit 1 }
Write-Host 'done - Shell under a full-access session can now use the restricted sandbox here.'
