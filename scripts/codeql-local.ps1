# CodeQL 本地自查：用与 GitHub Code Scanning 相同版本的 CodeQL 复现告警，回答「这条告警被哪条 taint 路径触发」。
# 用法：pwsh -NoProfile -File scripts/codeql-local.ps1 [-Query shell|redos|all] [-Ref <git-ref>] [-WorkingTree]
#        [-CodeQlHome <包含 codeql.cmd 的目录>] [-FailOnResults]
# 产物：数据库、CSV、日志落 %TEMP%\vessel-codeql-<id>，不写仓库（写进仓库会撞 PDW 的 source drift）。
# 前置：本机要有 CodeQL CLI（见 docs/CODEQL-LOCAL.md；首次需要下载约 700 MB 的 bundle）。
# 为什么不用 `codeql database analyze`：Windows 上当路径含 8.3 短名（如 SATANC~1）时它会以
#   "Expected downward-relative query path" 崩在结果解释阶段；`query run` + `bqrs decode` 不受影响。
[CmdletBinding()]
param(
  [ValidateSet('shell', 'redos', 'all')]
  [string]$Query = 'all',
  [string]$Ref = 'HEAD',
  [switch]$WorkingTree,
  [string]$CodeQlHome = '',
  [switch]$FailOnResults
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$id = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$work = Join-Path $env:TEMP "vessel-codeql-$id"
$src = Join-Path $work 'src'
$db = Join-Path $work 'db'
New-Item -ItemType Directory -Force -Path $src | Out-Null

function Find-CodeQl {
  $candidates = @()
  if ($CodeQlHome) { $candidates += $CodeQlHome }
  if ($env:CODEQL_HOME) { $candidates += $env:CODEQL_HOME }
  $onPath = Get-Command codeql.cmd -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += (Split-Path -Parent $onPath.Source) }
  $candidates += @(
    (Join-Path $env:TEMP 'codeql\codeql'),
    (Join-Path $env:TEMP 'codeql371\codeql'),
    'C:\tools\codeql\codeql',
    'D:\tools\codeql\codeql'
  )
  foreach ($c in $candidates) {
    $cmd = Join-Path $c 'codeql.cmd'
    if (Test-Path $cmd) { return $cmd }
  }
  return $null
}

$codeql = Find-CodeQl
if (-not $codeql) {
  @'
CodeQL CLI not found.
Get the bundle version that GitHub used for the alert you are investigating (the PR's SARIF names it under
tool.driver.semanticVersion / tool.extensions), then either put it on PATH or pass -CodeQlHome:

  curl.exe -L -o "$env:TEMP\codeql-bundle.tar.gz" `
    https://github.com/github/codeql-action/releases/download/codeql-bundle-v<version>/codeql-bundle-win64.tar.gz
  tar -xzf "$env:TEMP\codeql-bundle.tar.gz" -C "$env:TEMP\codeql371"

Details and the version-pinning rule: docs/CODEQL-LOCAL.md
'@ | Write-Host
  exit 2
}

$qlRoot = Split-Path -Parent $codeql
$packRoot = Get-ChildItem -Path (Join-Path $qlRoot 'qlpacks\codeql\javascript-queries') -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $packRoot) {
  "javascript-queries pack not found under $qlRoot\qlpacks\codeql" | Write-Host
  exit 2
}

# ---- source snapshot -------------------------------------------------------
# 只取 git 跟踪的文件（不含 node_modules / dist），避免把依赖树塞进数据库。
# 注意：tar 在 Windows 上对少数非 ASCII 文件名会报 "Invalid empty pathname"（历史证据文档），属非致命，
# 所以这里用「快照里有没有 package.json」判断成功，而不是看 tar 的退出码。
git archive $Ref | tar -x -C $src 2>&1 | Select-Object -First 3 | ForEach-Object { "  snapshot: $_" }
if (-not (Test-Path (Join-Path $src 'package.json'))) { "git archive $Ref produced no usable snapshot" | Write-Host; exit 1 }
if ($WorkingTree) {
  # 叠加未提交改动（新增/修改；工作树里删掉的文件不会从快照里移除，属已知简化）。
  $changed = @(git status --porcelain=v1 -uall | ForEach-Object { $_.Substring(3).Trim('"') })
  $copied = 0
  foreach ($rel in $changed) {
    $from = Join-Path $root $rel
    if (-not (Test-Path $from -PathType Leaf)) { continue }
    $to = Join-Path $src $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Force
    $copied++
  }
  "  working tree overlay: $copied file(s)"
}

# ---- database --------------------------------------------------------------
$created = Get-Date
& $codeql database create $db --language=javascript-typescript --source-root $src --overwrite --quiet *> (Join-Path $work 'create.log')
if ($LASTEXITCODE -ne 0) {
  "database create failed; see $(Join-Path $work 'create.log')" | Write-Host
  Get-Content (Join-Path $work 'create.log') -Tail 20 | ForEach-Object { "  $_" }
  exit 1
}
$createSecs = [int]((Get-Date) - $created).TotalSeconds

# ---- queries ---------------------------------------------------------------
$queries = switch ($Query) {
  'shell' { @('Security/CWE-078/UnsafeShellCommandConstruction.ql', 'Security/CWE-078/ShellCommandInjectionFromEnvironment.ql') }
  'redos' { @('Performance/PolynomialReDoS.ql') }
  default { @('Security/CWE-078/UnsafeShellCommandConstruction.ql', 'Security/CWE-078/ShellCommandInjectionFromEnvironment.ql', 'Performance/PolynomialReDoS.ql') }
}

"codeql    : $(& $codeql version --format=terse 2>$null)"
"pack      : javascript-queries $($packRoot.Name)"
"source    : $Ref$(if ($WorkingTree) { ' + working tree' })"
"database  : $db (${createSecs}s)"
''

$total = 0
$failed = 0
Push-Location $packRoot.FullName
foreach ($q in $queries) {
  $leaf = [IO.Path]::GetFileNameWithoutExtension($q)
  $bqrs = Join-Path $work "$leaf.bqrs"
  $csv = Join-Path $work "$leaf.csv"
  $start = Get-Date
  & $codeql query run --database $db --search-path . $q --output $bqrs *> (Join-Path $work "$leaf.run.log")
  $runCode = $LASTEXITCODE
  if ($runCode -ne 0) {
    "{0,-42} exit={1} (see {2})" -f $leaf, $runCode, (Join-Path $work "$leaf.run.log")
    $failed++
    continue
  }
  & $codeql bqrs decode --format=csv --output $csv $bqrs *> (Join-Path $work "$leaf.decode.log")
  $secs = [int]((Get-Date) - $start).TotalSeconds
  $rows = @(if (Test-Path $csv) { Get-Content $csv | Select-Object -Skip 1 } else { @() })
  $total += $rows.Count
  "{0,-42} results={1} {2,4}s  {3}" -f $leaf, $rows.Count, $secs, $csv
  # CSV 列就是查询自己的 select 列表（路径问题类：告警位置 / 源 / 汇 / 说明 / 源说明 / 汇说明），
  # 这里只给前几行做人工判断，完整数据在 csv 里。
  foreach ($row in ($rows | Select-Object -First 5)) { "    $row" }
  if ($rows.Count -gt 5) { "    ... $($rows.Count - 5) more row(s) in $csv" }
}
Pop-Location

''
"artifacts : $work"
if ($failed -gt 0) {
  "verdict   : $failed query/queries failed to run; read the run logs above"
  exit 1
}
if ($total -eq 0) {
  'verdict   : no results for the selected queries'
} else {
  "verdict   : $total result row(s) - read the code-flow columns before deciding anything"
  if ($FailOnResults) { exit 1 }
}
