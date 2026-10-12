Set-Location (Resolve-Path "$PSScriptRoot/../../..").Path
$v25gates = @(
  @{ Name = 'test-all'; Exe = 'npm.cmd'; Arguments = @('run', 'test:all') },
  @{ Name = 'tsc-build'; Exe = 'npx.cmd'; Arguments = @('tsc', '-b', 'tsconfig.json') },
  @{ Name = 'test-types'; Exe = 'npm.cmd'; Arguments = @('run', 'typecheck:tests') },
  @{ Name = 'web-types'; Exe = 'npm.cmd'; Arguments = @('run', '-w', '@vessel/web', 'typecheck') },
  @{ Name = 'web-build'; Exe = 'npm.cmd'; Arguments = @('run', '-w', '@vessel/web', 'build', '--', '--emptyOutDir', 'false') },
  @{ Name = 'cli-help'; Exe = 'npx.cmd'; Arguments = @('tsx', 'apps/cli/src/cli.ts', '--help') },
  @{ Name = 'boundaries'; Exe = 'node.exe'; Arguments = @('evidence/sessions/2026-10-10-v2.5/check-boundaries.cjs') }
)
$v25results = @()
foreach ($v25gate in $v25gates) {
  $v25started = (Get-Date).ToUniversalTime().ToString('o')
  & $v25gate.Exe @($v25gate.Arguments) 2>&1 | Tee-Object -FilePath "$PSScriptRoot/final-$($v25gate.Name).log"
  $v25code = $LASTEXITCODE
  $v25results += @{ gate = $v25gate.Name; exitCode = $v25code; startedAt = $v25started; endedAt = (Get-Date).ToUniversalTime().ToString('o') }
  $v25results | ConvertTo-Json -Depth 5 | Set-Content "$PSScriptRoot/final-gates.json"
  if ($v25code -ne 0) { exit $v25code }
}
