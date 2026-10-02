param([string]$Prefix = 'delivery')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
Push-Location $repo
try {
  $gates = @(
    @{Name='180';Exe='npx';Args=@('vitest','run','packages/tools/src/execution/sandbox/windowsRestricted.test.ts','packages/tools/src/execution/sandbox/platformSandbox.test.ts')},
    @{Name='181';Exe='npx';Args=@('vitest','run','packages/memory/src/sqlite/hybridSearch.test.ts','packages/memory/src/sqlite/reflectiveRules.test.ts')},
    @{Name='type-build';Exe='npx';Args=@('tsc','-b','tsconfig.json')},
    @{Name='type-tests';Exe='npm';Args=@('run','typecheck:tests')},
    @{Name='test-all';Exe='npm';Args=@('run','test:all')}
  )
  foreach ($gate in $gates) {
    $log = Join-Path $PSScriptRoot "$Prefix-$($gate.Name).log"
    $arguments = $gate.Args
    # Windows PowerShell 5 treats native stderr warnings as ErrorRecords.
    # Command exit code, not an experimental SQLite warning, decides the gate.
    $ErrorActionPreference = 'Continue'
    & $gate.Exe @arguments *> $log
    $result = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Write-Output "$($gate.Name): exit $result; $log"
    if ($result -ne 0) { Get-Content $log -Tail 60; exit $result }
  }
} finally { Pop-Location }
