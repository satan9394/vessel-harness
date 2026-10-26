# 本机全量门禁：分批跑，避免单进程全量在文件切换处挂起。
# 用法：pwsh -NoProfile -File scripts/gate-batched.ps1 [-SkipConformance] [-Only <substring>]
# 产物：每一步只打印 exit 与耗时；日志落 %TEMP%，不写仓库。
[CmdletBinding()]
param(
  [switch]$SkipConformance,
  [string]$Only = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $env:TEMP ("vessel-gate-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$steps = @(
  @{ name = 'shared+core';        args = @('packages/shared', 'packages/core') },
  @{ name = 'llm';                args = @('packages/llm') },
  @{ name = 'behavior+context';   args = @('packages/behavior', 'packages/context') },
  @{ name = 'tools+policy';       args = @('packages/tools', 'packages/policy') },
  @{ name = 'runtime+memory';     args = @('packages/runtime', 'packages/memory') },
  @{ name = 'skills+agents';      args = @('packages/skills', 'packages/agents') },
  @{ name = 'telemetry+engine';   args = @('packages/telemetry', 'packages/engine') },
  @{ name = 'application';        args = @('packages/application') },
  @{ name = 'cli';                args = @('apps/cli') },
  @{ name = 'local-server';       args = @('apps/local-server') },
  @{ name = 'benchmarks';         args = @('benchmarks/runners') },
  @{ name = 'root-index';         args = @('index.test.ts') }
)

$results = @()
$index = 0
foreach ($step in $steps) {
  if ($Only -and $step.name -notlike "*$Only*") { continue }
  $index++
  $log = Join-Path $logDir ("{0:d2}-{1}.log" -f $index, ($step.name -replace '[^a-zA-Z0-9]', '_'))
  $start = Get-Date
  node node_modules/vitest/vitest.mjs run @($step.args) *> $log
  $code = $LASTEXITCODE
  $secs = [int]((Get-Date) - $start).TotalSeconds
  $tail = (Select-String -Path $log -Pattern 'Test Files|Tests  ' | Select-Object -Last 2 | ForEach-Object { $_.Line.Trim() }) -join ' | '
  "{0,-18} exit={1} {2,4}s  {3}" -f $step.name, $code, $secs, $tail
  $results += [pscustomobject]@{ step = $step.name; exit = $code; seconds = $secs }
}

if (-not $Only) {
  foreach ($extra in @(
    @{ name = 'web-root'; args = @('node_modules/vitest/vitest.mjs', 'run', '--root', 'apps/web') },
    @{ name = 'tsc-build'; args = @('node_modules/typescript/bin/tsc', '-b', 'tsconfig.json') },
    @{ name = 'tsc-tests'; args = @('node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json', '--noEmit') },
    @{ name = 'tsc-web'; args = @('node_modules/typescript/bin/tsc', '-p', 'apps/web/tsconfig.json', '--noEmit') }
  )) {
    $log = Join-Path $logDir ("{0}.log" -f $extra.name)
    $start = Get-Date
    node @($extra.args) *> $log
    $code = $LASTEXITCODE
    $secs = [int]((Get-Date) - $start).TotalSeconds
    $tail = (Select-String -Path $log -Pattern 'Test Files|Tests  ' | Select-Object -Last 2 | ForEach-Object { $_.Line.Trim() }) -join ' | '
    "{0,-18} exit={1} {2,4}s  {3}" -f $extra.name, $code, $secs, $tail
    $results += [pscustomobject]@{ step = $extra.name; exit = $code; seconds = $secs }
  }
  if (-not $SkipConformance) {
    $log = Join-Path $logDir 'conformance.log'
    $start = Get-Date
    npm run bench:conformance *> $log
    $code = $LASTEXITCODE
    $secs = [int]((Get-Date) - $start).TotalSeconds
    $tail = (Select-String -Path $log -Pattern 'totals' | Select-Object -Last 1 | ForEach-Object { $_.Line.Trim() })
    "{0,-18} exit={1} {2,4}s  {3}" -f 'conformance', $code, $secs, $tail
    $results += [pscustomobject]@{ step = 'conformance'; exit = $code; seconds = $secs }
  }
}

'---'
$results | Format-Table -AutoSize | Out-String -Width 120
$failed = @($results | Where-Object { $_.exit -ne 0 })
if ($failed.Count -gt 0) {
  "FAILED STEPS: " + (($failed | ForEach-Object { $_.step }) -join ', ')
  "logs: $logDir"
  exit 1
}
"all steps green; logs: $logDir"
exit 0
