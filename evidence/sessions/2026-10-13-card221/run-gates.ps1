$ErrorActionPreference = 'Continue'
$taskEvidence = Join-Path $PSScriptRoot 'accepted-gates.json'
$taskGates = @(
  @{ name = '01-tsc'; executable = 'npx.cmd'; arguments = @('tsc', '-b') },
  @{ name = '02-typecheck-tests'; executable = 'npm.cmd'; arguments = @('run', 'typecheck:tests') },
  @{ name = '03-web-build'; executable = 'npm.cmd'; arguments = @('run', '-w', '@vessel/web', 'build', '--', '--emptyOutDir', 'false') },
  @{ name = '04-test-all'; executable = 'npm.cmd'; arguments = @('run', 'test:all') }
)
$taskResults = @()
foreach ($taskGate in $taskGates) {
  $taskStarted = [DateTimeOffset]::UtcNow.ToString('o')
  $taskLog = Join-Path $PSScriptRoot ('accepted-' + $taskGate.name + '.log')
  & $taskGate.executable @($taskGate.arguments) *> $taskLog
  $taskCode = $LASTEXITCODE
  $taskResults += @{ name = $taskGate.name; command = $taskGate.executable + ' ' + ($taskGate.arguments -join ' '); startedAt = $taskStarted; finishedAt = [DateTimeOffset]::UtcNow.ToString('o'); exitCode = $taskCode; log = $taskLog }
  ConvertTo-Json -InputObject $taskResults -Depth 4 | Set-Content -LiteralPath $taskEvidence -Encoding utf8
  Write-Output ($taskGate.name + ': exit ' + $taskCode)
  if ($taskCode -ne 0) { Get-Content -LiteralPath $taskLog -Tail 45; exit $taskCode }
}
