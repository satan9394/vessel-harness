<#
.SYNOPSIS
  按「任务性质」切换 PDW 的角色路由（模型 + 思考档位），改前备份、改后跑 doctor。

.DESCRIPTION
  PDW 1.3.3 的 `.pdw/config.json` 只有一张 roles 表，运行器不支持按任务改路由
  （见 docs/PDW-LOCAL.md §3）。本脚本把选型表固化成一个参数：

    code-heavy  implement = codex / gpt-6.1-sol / high
                跨包签名、core 安全语义、并发竞态、删除主链路
    general     implement = codex / gpt-6.1-sol / medium
                多文件协调、常规功能开发、预计会返工
    small       implement = codex / gpt-6.1-terra / low
                单文件、纯测试、文档对账、机械改动
    deepseek    implement = opencode / deepseek-v4.1-flash / high
                Codex 不可用或额度受限时的兜底写者

  `-All` 同时把四个只读角色也按后端切换：
    codex    → scan / test-plan = terra/medium，review / planner = sol/high
    deepseek → scan / test-plan = deepseek/high，review / planner = deepseek/max
  不加 `-All` 时只改 implement（其余角色保持现状）。

.PARAMETER Kind
  code-heavy | general | small | deepseek

.PARAMETER All
  连同四个只读角色一起切换（额度充足时全走 Codex；额度用尽时全回 DeepSeek）。

.PARAMETER DryRun
  只打印将要写入的字段与 diff，不落盘、不跑 doctor。

.EXAMPLE
  pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind general -All

.EXAMPLE
  pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind code-heavy -DryRun
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('code-heavy', 'general', 'small', 'deepseek')]
  [string]$Kind,
  [switch]$All,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root '.pdw/config.json'
if (-not (Test-Path $configPath)) { throw "找不到 $configPath；先在本项目根跑一次 pwsh pdw.ps1 doctor" }

$opencodeExe = 'D:\Technology_application\NVM_Windows\nodejs\node_modules\@opencode\cli\bin\opencode.exe'
$codexExe = 'D:\Technology_application\NVM_Windows\nodejs\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'

$routes = @{
  'code-heavy' = @{ backend = 'codex'; executable = $codexExe; model = 'gpt-6.1-sol'; effort = 'high'; why = '跨包签名 / core 安全语义 / 并发竞态 / 删除主链路' }
  'general'    = @{ backend = 'codex'; executable = $codexExe; model = 'gpt-6.1-sol'; effort = 'medium'; why = '多文件协调、常规功能开发' }
  'small'      = @{ backend = 'codex'; executable = $codexExe; model = 'gpt-6.1-terra'; effort = 'low'; why = '单文件 / 纯测试 / 文档对账 / 机械改动' }
  'deepseek'   = @{ backend = 'opencode'; executable = $opencodeExe; model = 'commandcode/deepseek/deepseek-v4.1-flash'; effort = 'high'; why = 'Codex 不可用或额度受限时的兜底写者' }
}

# 只读角色按后端分档：Codex 用 terra 跑扫描、sol/high 做复核；DeepSeek 用 high/max。
$readOnly = @{
  codex    = @{
    scan      = @{ model = 'gpt-6.1-terra'; effort = 'medium' }
    'test-plan' = @{ model = 'gpt-6.1-terra'; effort = 'medium' }
    review    = @{ model = 'gpt-6.1-sol'; effort = 'high' }
    planner   = @{ model = 'gpt-6.1-sol'; effort = 'high' }
    executable = $codexExe
  }
  opencode = @{
    scan      = @{ model = 'commandcode/deepseek/deepseek-v4.1-flash'; effort = 'high' }
    'test-plan' = @{ model = 'commandcode/deepseek/deepseek-v4.1-flash'; effort = 'high' }
    review    = @{ model = 'commandcode/deepseek/deepseek-v4.1-flash'; effort = 'max' }
    planner   = @{ model = 'commandcode/deepseek/deepseek-v4.1-flash'; effort = 'max' }
    executable = $opencodeExe
  }
}

$route = $routes[$Kind]
if (-not $route) { throw "未知路由：$Kind" }
if (-not (Test-Path $route.executable)) { throw "可执行文件不存在：$($route.executable)" }

$raw = Get-Content $configPath -Raw -Encoding utf8
$config = $raw | ConvertFrom-Json

# 目标：role -> @{ backend; executable; model; effort }
$plan = [ordered]@{}
foreach ($role in @($config.roles.PSObject.Properties.Name)) {
  $current = $config.roles.$role
  if ($role -eq 'implement') {
    $plan[$role] = @{ backend = $route.backend; executable = $route.executable; model = $route.model; effort = $route.effort }
  } elseif ($All) {
    $table = $readOnly[$route.backend]
    $entry = $table[$role]
    if ($entry) {
      $plan[$role] = @{ backend = $route.backend; executable = $table.executable; model = $entry.model; effort = $entry.effort }
    } else {
      $plan[$role] = @{ backend = $current.backend; executable = $current.executable; model = $current.model; effort = $current.reasoning_effort }
    }
  } else {
    $plan[$role] = @{ backend = $current.backend; executable = $current.executable; model = $current.model; effort = $current.reasoning_effort }
  }
}

Write-Host "PDW 路由：$Kind$(if ($All) { '（全部角色）' }) —— $($route.why)" -ForegroundColor Cyan
$changed = @()
foreach ($role in $plan.Keys) {
  $current = $config.roles.$role
  $target = $plan[$role]
  $same = $current.backend -eq $target.backend -and $current.model -eq $target.model -and $current.reasoning_effort -eq $target.effort
  $mark = if ($same) { '  ' } else { '->' }
  Write-Host ("  {0} {1,-10} {2} / {3} / {4}" -f $mark, $role, $target.backend, $target.model, $target.effort)
  if (-not $same) { $changed += $role }
}

if ($changed.Count -eq 0) {
  Write-Host '  已是目标路由，无需改动。' -ForegroundColor DarkGray
  if (-not $DryRun) { & pwsh -NoProfile -File (Join-Path $root 'pdw.ps1') doctor | Out-Null; Write-Host '  doctor exit=0' }
  exit 0
}
if ($DryRun) { Write-Host '  （-DryRun：未写入，未跑 doctor）' -ForegroundColor Yellow; exit 0 }

$stamp = Get-Date -Format 'yyyyMMdd'
$backupDir = Join-Path $root ".pdw/skill-upgrade-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$suffix = if ($All) { "$Kind-all" } else { $Kind }
Copy-Item $configPath (Join-Path $backupDir "config.json.bak-route-$suffix-$stamp")

foreach ($role in $plan.Keys) {
  $target = $plan[$role]
  $config.roles.$role.backend = $target.backend
  $config.roles.$role.executable = $target.executable
  $config.roles.$role.model = $target.model
  $config.roles.$role.reasoning_effort = $target.effort
}
$json = $config | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "  已写入（备份 $backupDir，改动角色：$($changed -join ', ')）" -ForegroundColor Green
$doctor = & pwsh -NoProfile -File (Join-Path $root 'pdw.ps1') doctor
$code = $LASTEXITCODE
$doctor | Select-String -Pattern '"role":|"effective_model"|"ready"' | ForEach-Object { "  $($_.Line.Trim())" }
Write-Host "  doctor exit=$code"
exit $code
