# Dispatch a Codex CLI task whose prompt is a UTF-8 file.
#
#   .\scripts\dispatch-codex.ps1 -PromptFile tasks\prompts\codex-task-276-shell-permission.md `
#       -Out evidence\sessions\2026-10-23-task276-last.md -Log evidence\sessions\2026-10-23-task276-codex.log
#
# Why this exists: piping a file into the native exe from PowerShell
#   Get-Content -Raw $f | & codex exec ... -
# re-encodes the text with the console's ANSI code page, so a UTF-8 prompt with Chinese arrives as
# "????" and the agent only sees the ASCII skeleton. cmd input redirection passes raw bytes, which is
# what the CLI expects. Verified byte-identical with a sha256 round-trip.
param(
  [Parameter(Mandatory = $true)][string]$PromptFile,
  [string]$Out,
  [string]$Log,
  [string]$Model = 'gpt-6.1-sol',
  [string]$Effort = 'medium',
  [string]$Sandbox = 'workspace-write',
  [string]$Repo = 'E:\Code_file\Projects\Vessel_Harness'
)

$ErrorActionPreference = 'Stop'
$codex = 'D:\Technology_application\NVM_Windows\nodejs\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
if (-not (Test-Path $codex)) { throw "codex.exe not found at $codex" }
if (-not (Test-Path $PromptFile)) { throw "prompt file not found: $PromptFile" }

# Fail loudly if the prompt is not valid UTF-8 with the Chinese intact, instead of silently sending '?'.
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $PromptFile))
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
if ($text -match '\uFFFD') { throw "prompt is not valid UTF-8: $PromptFile" }

$args = @('exec', '-C', $Repo, '-s', $Sandbox, '-m', $Model, '-c', "model_reasoning_effort=$Effort")
if ($Out) { $args += @('-o', $Out) }
$args += @('-')

$quoted = ($args | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
$cmdPath = Join-Path $env:TEMP ('codex-dispatch-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.cmd')
$lines = @(
  '@echo off',
  "cd /d `"$Repo`"",
  "`"$codex`" $quoted < `"$PromptFile`"" + $(if ($Log) { " > `"$Log`" 2>&1" } else { '' }),
  'echo CODEX_EXIT=%ERRORLEVEL%'
)
Set-Content -Path $cmdPath -Value $lines -Encoding ASCII
& cmd /c "`"$cmdPath`""
