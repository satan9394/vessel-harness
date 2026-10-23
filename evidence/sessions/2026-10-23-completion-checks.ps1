# Run from any directory. Deliberately targeted: never invokes test:all or an installed agent CLI.
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runDirectory = Join-Path $PSScriptRoot ('2026-10-23-doc-completion\gates\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
Push-Location $projectRoot
try {
  $baselineHead = (& git rev-parse HEAD).Trim()
  $protectedBefore = @(& git diff HEAD -- packages/core tasks HANDOFF.md .pdw/config.json package.json package-lock.json)
  $checks = @(
    @{ id = 'build'; executable = 'npm'; arguments = @('run', 'build') },
    @{ id = 'test-types'; executable = 'npm'; arguments = @('run', 'typecheck:tests') },
    @{ id = 'web-types'; executable = 'npm'; arguments = @('run', '-w', '@vessel/web', 'typecheck') },
    @{ id = 'root-targeted'; executable = 'node'; arguments = @('node_modules/vitest/vitest.mjs', 'run', '--no-cache',
      'apps/local-server', 'packages/runtime/src/executor', 'packages/policy/src/engine/permit.test.ts',
      'packages/application/src/session/SessionController.test.ts', 'packages/application/src/session/RunObservation.test.ts',
      'packages/application/src/session/effect-recovery.test.ts', 'packages/application/src/team/TaskTreeScheduler.test.ts',
      'packages/application/src/providers/presets.data.test.ts', 'packages/agents/src/external/InteractiveAdapter.test.ts',
      'packages/agents/src/subagent/subagent.test.ts', 'packages/context/src/compaction',
      'packages/context/src/cache/LayeredContextCache.test.ts', 'packages/shared/src/projection.test.ts',
      'packages/shared/src/team.test.ts', 'packages/llm/src/capabilities.test.ts', 'benchmarks/runners/src/contracts/contracts.test.ts') },
    @{ id = 'web-tests'; executable = 'node'; arguments = @('node_modules/vitest/vitest.mjs', 'run', '--no-cache', '--root', 'apps/web') },
    @{ id = 'web-build'; executable = 'npm'; arguments = @('run', '-w', '@vessel/web', 'build', '--', '--emptyOutDir', 'false') },
    @{ id = 'diff-check'; executable = 'git'; arguments = @('diff', '--check') }
  )
  $results = @()
  foreach ($check in $checks) {
    $log = Join-Path $runDirectory ($check.id + '.log')
    Write-Host ('Running ' + $check.id)
    & $check.executable @($check.arguments) *> $log
    $checkExit = $LASTEXITCODE
    $results += @{ id = $check.id; executable = $check.executable; arguments = $check.arguments; exitCode = $checkExit; log = $log }
    Write-Host ($check.id + ': exit ' + $checkExit)
  }
  $protectedChanges = @(& git diff --name-only HEAD -- packages/core tasks HANDOFF.md .pdw/config.json package.json package-lock.json)
  $finalHead = (& git rev-parse HEAD).Trim()
  $protectedAfter = @(& git diff HEAD -- packages/core tasks HANDOFF.md .pdw/config.json package.json package-lock.json)
  $boundaryPass = ($protectedBefore -join "`n") -ceq ($protectedAfter -join "`n") -and $finalHead -eq $baselineHead
  $summary = @{ baselineHead = $baselineHead; finalHead = $finalHead; boundaryPass = $boundaryPass; protectedChanges = $protectedChanges; protectedBoundaryDefinition = "unchanged during this gate; concurrent preexisting protected edits preserved"; checks = $results }
  $summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $runDirectory 'summary.json') -Encoding utf8
  $summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot '2026-10-23-doc-completion-gates.json') -Encoding utf8
  if (-not $boundaryPass -or @($results | Where-Object exitCode -ne 0).Count) { exit 1 }
  Write-Host 'Targeted aggregate gates and protected paths passed.'
} finally { Pop-Location }

