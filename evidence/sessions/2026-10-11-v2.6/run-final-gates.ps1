param([string]$RunId = ('accepted-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')))
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../../..'))
$gatesV26 = @(
  @{ name = 'test-all'; executable = 'npm.cmd'; arguments = @('run', 'test:all') },
  @{ name = 'tsc'; executable = 'npx.cmd'; arguments = @('tsc', '-b', 'tsconfig.json') },
  @{ name = 'test-types'; executable = 'npm.cmd'; arguments = @('run', 'typecheck:tests') },
  @{ name = 'web-types'; executable = 'npm.cmd'; arguments = @('run', '-w', '@vessel/web', 'typecheck') },
  @{ name = 'web-build'; executable = 'npm.cmd'; arguments = @('run', '-w', '@vessel/web', 'build', '--', '--emptyOutDir', 'false') },
  @{ name = 'cli-help'; executable = 'npx.cmd'; arguments = @('tsx', 'apps/cli/src/cli.ts', '--help') }
)
$resultsV26 = @()
foreach ($gateV26 in $gatesV26) {
  $startedV26 = [DateTime]::UtcNow.ToString('o')
  $logV26 = Join-Path $PSScriptRoot ("{0}-{1}.log" -f $RunId, $gateV26.name)
  & $gateV26.executable @($gateV26.arguments) *> $logV26
  $exitV26 = $LASTEXITCODE
  $resultsV26 += @{ name = $gateV26.name; command = "$($gateV26.executable) $($gateV26.arguments -join ' ')"; exitCode = $exitV26; startedAt = $startedV26; finishedAt = [DateTime]::UtcNow.ToString('o'); log = [IO.Path]::GetFileName($logV26) }
  $resultsV26 | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'accepted-gates.json')
  Write-Output "$($gateV26.name): exit $exitV26"
  if ($exitV26 -ne 0) { exit $exitV26 }
}
$coreDiffV26 = @(git diff --numstat -- packages/core)
if ($coreDiffV26.Count -ne 0) { throw 'Thin core gate failed' }
$baselineV26 = Get-Content (Join-Path $PSScriptRoot 'baseline.json') -Raw | ConvertFrom-Json
$changedProtectedV26 = @($baselineV26.files | Where-Object { (Get-FileHash -LiteralPath $_.path -Algorithm SHA256).Hash -ne $_.sha256 })
if ($changedProtectedV26.Count -ne 0) { throw 'Protected source or dependency lock changed' }
$resultsV26 += @{ name = 'thin-core-and-protected-hashes'; exitCode = 0; protectedFiles = $baselineV26.files.Count; coreChangedLines = 0 }
$resultsV26 | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'accepted-gates.json')
Write-Output 'thin-core-and-protected-hashes: exit 0'
