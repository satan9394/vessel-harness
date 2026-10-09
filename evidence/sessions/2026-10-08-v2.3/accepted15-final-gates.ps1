$ErrorActionPreference = 'Continue'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '../../..'))
$taskResults = [ordered]@{ startedAt = [DateTime]::UtcNow.ToString('o'); approvedDoD = @{ meanMs = 15; maximumMs = 25 }; gates = @() }
function Invoke-TaskGate($taskName, $taskCommand, $taskLog) {
  $taskStart = [DateTime]::UtcNow.ToString('o')
  & $taskCommand *> (Join-Path $PSScriptRoot $taskLog)
  $taskCode = $LASTEXITCODE
  $taskResults.gates += @{ name = $taskName; exitCode = $taskCode; startedAt = $taskStart; finishedAt = [DateTime]::UtcNow.ToString('o'); log = $taskLog }
  $taskResults | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'accepted15-final-gates.json')
  Write-Output "$taskName exit $taskCode"
}
Invoke-TaskGate 'npm run test:all' { npm run test:all } 'accepted15-test-all.log'
Invoke-TaskGate 'npx tsc -b tsconfig.json' { npx tsc -b tsconfig.json } 'accepted15-build.log'
Invoke-TaskGate 'npm run typecheck:tests' { npm run typecheck:tests } 'accepted15-test-types.log'
Invoke-TaskGate 'npm run test:web' { npm run test:web } 'accepted15-web-tests.log'
Invoke-TaskGate 'npm run -w @vessel/web build -- --emptyOutDir false' { npm run -w @vessel/web build -- --emptyOutDir false } 'accepted15-web-build.log'
$taskResults.finishedAt = [DateTime]::UtcNow.ToString('o')
$taskResults | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'accepted15-final-gates.json')
if (@($taskResults.gates | Where-Object { $_.exitCode -ne 0 }).Count) { exit 1 }
exit 0
