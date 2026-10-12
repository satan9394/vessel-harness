$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../../..'))
$baselineV26 = Get-Content (Join-Path $PSScriptRoot 'baseline.json') -Raw | ConvertFrom-Json
$gatesV26 = @(Get-Content (Join-Path $PSScriptRoot 'accepted-gates.json') -Raw | ConvertFrom-Json)
if ($gatesV26.Count -ne 7 -or @($gatesV26 | Where-Object exitCode -ne 0).Count) { throw 'Final gates are incomplete' }
$protectedV26 = @($baselineV26.files | Where-Object { !(Test-Path -LiteralPath $_.path) -or (Get-FileHash -LiteralPath $_.path -Algorithm SHA256).Hash -ne $_.sha256 })
if ($protectedV26.Count) { throw 'Protected source or dependency hashes changed' }
$coreV26 = @(git status --short -- packages/core)
if ($coreV26.Count) { throw 'Core changed' }
$deletedV26 = @(git diff --name-only --diff-filter=D)
if ($deletedV26.Count) { throw 'Tracked file deletion detected' }
$filesV26 = @(git ls-files --cached --others --exclude-standard)
$locksV26 = @($filesV26 | Where-Object { $_ -match '(^|/)(pnpm-lock.yaml|pnpm-workspace.yaml|bun.lockb?|yarn.lock)$' })
if ($locksV26.Count) { throw 'Alternate package-manager files detected' }
$testLogV26 = Get-Content (Join-Path $PSScriptRoot ($gatesV26 | Where-Object name -eq 'test-all').log) -Raw
$countsV26 = @([regex]::Matches($testLogV26, 'Tests\s+(\d+) passed') | ForEach-Object { [int]$_.Groups[1].Value })
if ($countsV26.Count -ne 2 -or ($countsV26 | Measure-Object -Sum).Sum -lt 3100) { throw 'Dual-root test threshold not met' }
$stateV26 = Get-Content .agent-state/run-state.json -Raw | ConvertFrom-Json
$auditV26 = [ordered]@{
  at = [DateTime]::UtcNow.ToString('o')
  rootPassed = $countsV26[0]
  webPassed = $countsV26[1]
  totalPassed = ($countsV26 | Measure-Object -Sum).Sum
  coreChangedLines = 0
  protectedFilesUnchanged = $baselineV26.files.Count
  trackedDeletions = 0
  alternatePackageManagerFiles = 0
  gates = $gatesV26.Count
  activeWorkers = $stateV26.workers.active
  head = (git rev-parse HEAD)
}
$auditV26 | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'completion-audit.json')
$auditV26 | ConvertTo-Json -Depth 5
