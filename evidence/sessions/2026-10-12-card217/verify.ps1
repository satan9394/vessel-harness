$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
Push-Location $root
$results = @()
function Invoke-Gate([string]$name, [string]$command, [string[]]$arguments) {
  $started = [DateTime]::UtcNow.ToString('o')
  & $command @arguments 2>&1 | Tee-Object -FilePath (Join-Path $PSScriptRoot "$name.log")
  $code = $LASTEXITCODE
  $script:results += @{ name = $name; command = "$command $($arguments -join ' ')"; exitCode = $code; startedAt = $started; finishedAt = [DateTime]::UtcNow.ToString('o') }
  $script:results | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $PSScriptRoot 'gates.json')
  if ($code -ne 0) { throw "Gate $name failed with exit $code" }
}
try {
  Invoke-Gate '01-directed' 'npx.cmd' @('vitest', 'run',
    'packages/context/src/context.test.ts', 'packages/context/src/compaction',
    'packages/behavior/src/compiler/Compiler.test.ts', 'packages/engine/src/execution-run.test.ts',
    'packages/application/src/ExecutionLoop.test.ts', 'packages/application/src/noProgressIntegration.test.ts',
    'packages/application/src/composeActivation.test.ts',
    'packages/application/src/redGreenCompletion.test.ts', 'packages/application/src/v23Integration.test.ts',
    'apps/cli/src/providers/opencodeGoCli.test.ts', 'apps/cli/src/policyStatus.test.ts',
    'benchmarks/runners/src/contracts/contracts.test.ts', 'benchmarks/runners/src/lane/real-model-lane.test.ts',
    'benchmarks/runners/src/safety.test.ts', 'benchmarks/runners/src/safety-discrimination.test.ts',
    'packages/application/src/session/SessionController.test.ts', 'packages/application/src/projections/projections.test.ts',
    'packages/runtime/src/executor', 'packages/runtime/src/mods/modExecution.test.ts',
    'packages/policy/src/engine/permit.test.ts', 'packages/context/tests/ast/symbolGraph.test.ts',
    'packages/tools/src/execution/pipeline.test.ts', 'packages/tools/src/execution/selfHealing.test.ts',
    'packages/core/src/agent-loop/AgentLoop.test.ts', 'packages/core/src/agent-loop/AgentLoop.before-tool-gate.test.ts',
    'packages/core/src/agent-loop/AgentLoop.denial-breaker.test.ts')
  Invoke-Gate '01b-cli-regressions' 'npx.cmd' @('vitest', 'run', 'apps/cli/src/cli.test.ts', '-t', 'anthropic provider falls|BRIEF-18')
  Invoke-Gate '02-tsc' 'npx.cmd' @('tsc', '-b', 'tsconfig.json')
  Invoke-Gate '03-test-types' 'npm.cmd' @('run', 'typecheck:tests')
  Invoke-Gate '04-test-all' 'npm.cmd' @('run', 'test:all')
  $core = @(& git diff --name-only HEAD -- packages/core)
  $coreUntracked = @(& git ls-files --others --exclude-standard -- packages/core)
  $implementation = @($core + $coreUntracked | Where-Object { $_ -and $_ -notlike '*.test.ts' })
  if ($implementation.Count) { throw "Forbidden core implementation changes: $implementation" }
  $lock = @(& git diff --name-only HEAD -- package-lock.json)
  $foreignLocks = @(& git ls-files --others --exclude-standard | Where-Object { $_ -match '(^|/)(pnpm-lock.yaml|pnpm-workspace.yaml|bun.lockb?|yarn.lock)$' })
  if ($lock.Count -or $foreignLocks.Count) { throw 'Dependency lock boundary changed' }
  & git diff --stat HEAD -- packages/core | Set-Content (Join-Path $PSScriptRoot 'core-test-diff-stat.txt')
  @{ coreImplementationChangedFiles = $implementation.Count; coreTestChangedFiles = $core; rootLockChanged = $false;
     foreignLocksAdded = $foreignLocks; noPushPublish = $true; finalCheckedAt = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json -Depth 5 | Set-Content (Join-Path $PSScriptRoot 'scope-audit.json')
} finally { Pop-Location }
