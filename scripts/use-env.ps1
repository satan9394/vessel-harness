# Load project-scoped secrets into the current PowerShell session.
#
#   . .\scripts\use-env.ps1
#
# Dot-source it (note the leading dot) so the variables land in your shell rather than a child scope.
# Values come from .env.local, which .gitignore excludes; nothing here is committed as a secret.
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) '.env.local'
if (-not (Test-Path $envFile)) {
  Write-Error "缺少 .env.local（见 .env.local.example 的字段说明）"
  return
}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { continue }
  Set-Item -Path ("env:" + $matches[1]) -Value $matches[2].Trim()
  Write-Verbose ("已加载 " + $matches[1])
}
Write-Host "已从 .env.local 载入环境变量"
