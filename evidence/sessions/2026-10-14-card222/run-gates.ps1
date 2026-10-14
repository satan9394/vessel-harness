# Card 222 — ordered final gates. Each gate's stdout+stderr is captured to a log
# and the exit code recorded, so the PROOF can cite them.
$ErrorActionPreference = 'Continue'
$dir = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $dir '..\..\..')).Path
Push-Location $repo
$script:results = @()
function Run-Gate([string]$name, [string]$command) {
  Write-Host "== $name =="
  $log = Join-Path $dir "$name.log"
  $started = Get-Date
  $output = cmd /c "$command 2>&1"
  $code = $LASTEXITCODE
  $output | Out-File -FilePath $log -Encoding utf8
  $script:results += [pscustomobject]@{ gate = $name; command = $command; exitCode = $code; seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1); log = "$name.log" }
  Write-Host "$name exit=$code"
}
Run-Gate 'final-01-tsc' 'npx tsc -b tsconfig.json'
Run-Gate 'final-02-typecheck-tests' 'npm run typecheck:tests'
Run-Gate 'final-03-web-build' 'npm run -w @vessel/web build -- --emptyOutDir false'
Run-Gate 'final-04-test-all' 'npm run test:all'
$script:results | ConvertTo-Json -Depth 4 | Out-File -FilePath (Join-Path $dir 'final-gates.json') -Encoding utf8
Pop-Location
$script:results | Format-Table -AutoSize
