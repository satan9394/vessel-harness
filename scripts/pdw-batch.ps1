<#
.SYNOPSIS
  依次执行多个 PDW 契约（一个命令跑完一整批），失败即停并汇总。

.DESCRIPTION
  用途：把「超长任务」一次性交给 PDW 执行，中间不需要人/协调者碰仓库——
  这正是 PDW 1.3.3 的要求：`new` 之后任何文件写入都会判 source drift。

  每个契约：`new --from <contract>` → `run <id>`，一轮结束才进下一个。
  结果在 `.pdw/batches/<时间戳>.json` 落一份汇总（id / 契约 / 状态 / 报告路径），
  供协调者随后逐项复跑核验，而不是采信运行器自述。

.PARAMETER Contract
  一个或多个契约 JSON 路径（相对仓库根或绝对路径）。

.PARAMETER Kind
  可选：开跑前先按 scripts/pdw-route.ps1 切换写者路由（code-heavy/general/small/deepseek）。

.PARAMETER ContinueOnFailure
  某个任务未 accepted_local 时继续跑下一个（默认停在第一个失败）。

.EXAMPLE
  pwsh -NoProfile -File scripts/pdw-batch.ps1 -Contract .pdw/contracts/353-session-append-lease-bypass.json,.pdw/contracts/345c-server-trash-routing.json -Kind code-heavy
#>
param(
  [Parameter(Mandatory = $true)][string[]]$Contract,
  [ValidateSet('code-heavy', 'general', 'small', 'deepseek')][string]$Kind,
  [switch]$ContinueOnFailure
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pdw = Join-Path $root 'pdw.ps1'
if (-not (Test-Path $pdw)) { throw "找不到 pdw.ps1（$pdw）" }

# `-File` 模式会把 `a.json,b.json` 原样传成一个字符串，这里统一拆开。
$Contract = @($Contract | ForEach-Object { $_ -split '\s*,\s*' } | Where-Object { $_ })

if ($Kind) {
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'pdw-route.ps1') -Kind $Kind | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "路由切换失败（$Kind）" }
}

$results = @()
$index = 0
foreach ($item in $Contract) {
  $index += 1
  $path = if ([System.IO.Path]::IsPathRooted($item)) { $item } else { Join-Path $root $item }
  if (-not (Test-Path $path)) { throw "契约不存在：$path" }

  Write-Host ("`n=== [{0}/{1}] {2}" -f $index, $Contract.Count, (Split-Path -Leaf $path)) -ForegroundColor Cyan
  $created = & pwsh -NoProfile -File $pdw new --from $path | ConvertFrom-Json
  $id = $created.id
  Write-Host "  task: $id"
  $output = & pwsh -NoProfile -File $pdw run $id
  $exit = $LASTEXITCODE
  $state = $null
  $statePath = Join-Path $root ".pdw/tasks/$id/state.json"
  if (Test-Path $statePath) { $state = Get-Content $statePath -Raw -Encoding utf8 | ConvertFrom-Json }
  $status = if ($state) { $state.status } else { 'unknown' }
  $report = Join-Path $root ".pdw/tasks/$id/REPORT.md"

  $results += [pscustomobject]@{
    contract = (Split-Path -Leaf $path)
    id       = $id
    status   = $status
    exit     = $exit
    report   = $report
  }
  Write-Host ("  status={0} exit={1}" -f $status, $exit) -ForegroundColor $(if ($status -eq 'accepted_local') { 'Green' } else { 'Red' })

  if ($status -ne 'accepted_local' -and -not $ContinueOnFailure) {
    Write-Host '  非 accepted_local，按默认策略停止（要串跑用 -ContinueOnFailure）。' -ForegroundColor Yellow
    break
  }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$batchDir = Join-Path $root '.pdw/batches'
New-Item -ItemType Directory -Force -Path $batchDir | Out-Null
$outFile = Join-Path $batchDir "$stamp.json"
($results | ConvertTo-Json -Depth 5) | Set-Content -Path $outFile -Encoding utf8

Write-Host "`n=== 汇总 ===" -ForegroundColor Cyan
$results | Format-Table contract, id, status, exit -AutoSize | Out-String -Width 200 | Write-Host
Write-Host "汇总文件：$outFile"
Write-Host '提醒：运行期间不要改仓库；验收由协调者逐项复跑定向测试后落卡，不采信本汇总的自述。' -ForegroundColor DarkGray

$failed = @($results | Where-Object { $_.status -ne 'accepted_local' })
exit $(if ($failed.Count -gt 0) { 1 } else { 0 })
