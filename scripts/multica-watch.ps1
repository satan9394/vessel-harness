# Multica squad health watchdog
#
# Checks, every time it runs:
#   1. the local Multica daemon is alive (starts it when not)
#   2. every issue in `in_progress` has an active run
#   3. no active run has been running longer than -StaleMinutes
#   4. an `in_progress` issue is not idle (no run and no run activity for -IdleMinutes)
#
# Actions are limited on purpose: restart a dead daemon, cancel + rerun a stale run,
# and log the rest. It never edits the repository and never commits.
#
# Usage:
#   pwsh -NoProfile -File scripts/multica-watch.ps1            # normal run
#   pwsh -NoProfile -File scripts/multica-watch.ps1 -WhatIf    # report only, no actions

param(
    [int]$StaleMinutes = 60,
    [int]$IdleMinutes = 45,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo '.tmp'
$log = Join-Path $logDir 'multica-watch.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 512KB) {
    Move-Item -LiteralPath $log -Destination "$log.1" -Force
}

function Invoke-Multica([string[]]$Arguments) {
    $out = & multica @Arguments 2>&1 | Out-String
    return $out
}

function ConvertFrom-JsonSafe([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    # The CLI may prepend notices/warnings on stderr (merged into the same stream by
    # Invoke-Multica), so take the outermost JSON payload and drop everything else.
    $body = $Text
    $start = $body.IndexOfAny([char[]]('{', '['))
    if ($start -gt 0) { $body = $body.Substring($start) }
    $end = $body.LastIndexOfAny([char[]]('}', ']'))
    if ($end -ge 0 -and $end -lt ($body.Length - 1)) { $body = $body.Substring(0, $end + 1) }
    try { return $body | ConvertFrom-Json } catch {
        try { return $Text | ConvertFrom-Json } catch { return $null }
    }
}

# 1. daemon ---------------------------------------------------------------
$status = Invoke-Multica @('daemon', 'status')
$firstLine = ($status -split "`r?`n")[0]
Write-Log "daemon: $firstLine"
if ($status -notmatch 'running') {
    Write-Log "DAEMON down ($firstLine) -> start"
    if (-not $WhatIf) {
        Invoke-Multica @('daemon', 'start') | Out-Null
        Start-Sleep -Seconds 6
        $status = Invoke-Multica @('daemon', 'status')
        Write-Log ('DAEMON after start: ' + (($status -split "`r?`n")[0]))
    }
}

$nowUtc = [DateTime]::UtcNow

# A transient CLI/network failure must never look like "nothing is running".
$listRaw = $null
$issues = $null
for ($attempt = 1; $attempt -le 3; $attempt++) {
    $listRaw = Invoke-Multica @('issue', 'list', '--status', 'in_progress', '--output', 'json')
    $issues = ConvertFrom-JsonSafe $listRaw
    if ($issues -and $null -ne $issues.issues) { break }
    if ($attempt -lt 3) { Start-Sleep -Seconds 4 }
}
if (-not $issues -or $null -eq $issues.issues) {
    $snippet = ($listRaw -replace '\s+', ' ')
    if ($snippet.Length -gt 160) { $snippet = $snippet.Substring(0, 160) }
    Write-Log "WARN cannot read the in_progress list after 3 tries: $snippet"
    $list = @()
}
else {
    $list = @($issues.issues)
    Write-Log "in_progress issues: $($list.Count)"
}

foreach ($issue in $list) {
    $key = if ($issue.identifier) { $issue.identifier } else { $issue.key }
    if (-not $key) { Write-Log "WARN issue without identifier: $($issue.id)"; continue }
    $runsRaw = Invoke-Multica @('issue', 'runs', $key, '--active', '--output', 'json')
    $runs = @()
    $parsed = ConvertFrom-JsonSafe $runsRaw
    if ($null -eq $parsed -and $runsRaw -notmatch '^\s*\[\s*\]\s*$') {
        $snippet = ($runsRaw -replace '\s+', ' ')
        if ($snippet.Length -gt 120) { $snippet = $snippet.Substring(0, 120) }
        Write-Log "WARN $key cannot read active runs: $snippet"
        continue
    }
    if ($parsed) { $runs = @($parsed) }

    if ($runs.Count -eq 0) {
        # idle check: last run finish time from the full run list
        $allRaw = Invoke-Multica @('issue', 'runs', $key, '--output', 'json')
        $all = @()
        $allParsed = ConvertFrom-JsonSafe $allRaw
        if ($allParsed) { $all = @($allParsed) }
        $last = $all | Sort-Object { $_.completed_at } | Select-Object -Last 1
        $idle = $true
        $detail = 'no runs'
        if ($last -and $last.completed_at) {
            $done = [DateTime]::Parse($last.completed_at, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
            $mins = [int]($nowUtc - $done).TotalMinutes
            $detail = "last run finished ${mins}m ago"
            $idle = $mins -ge $IdleMinutes
        }
        if ($idle) {
            Write-Log "WARN $key in_progress but idle ($detail)"
        }
        else {
            Write-Log "OK $key no active run but recent activity ($detail)"
        }
        continue
    }

    foreach ($run in $runs) {
        $rid = if ($run.id) { $run.id.ToString().Substring(0, 8) } else { '?' }
        $agent = if ($run.agent_id) { $run.agent_id.ToString().Substring(0, 8) } else { '?' }
        $started = $run.started_at
        $ageMin = -1
        if ($started) {
            try {
                $st = [DateTime]::Parse($started, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
                $ageMin = [int]($nowUtc - $st).TotalMinutes
            }
            catch { $ageMin = -1 }
        }

        if ($ageMin -ge $StaleMinutes) {
            Write-Log "STALE $key run $rid ($agent) running ${ageMin}m -> cancel + rerun fresh"
            if (-not $WhatIf) {
                $c = Invoke-Multica @('issue', 'cancel-task', $run.id, '--issue', $key)
                Write-Log "  cancel: $(($c -split "`r?`n")[0])"
                Start-Sleep -Seconds 3
                $r = Invoke-Multica @('issue', 'rerun-task', $run.id, '--issue', $key, '--fresh')
                Write-Log "  rerun: $(($r -split "`r?`n")[0])"
            }
        }
        else {
            $shown = if ($ageMin -ge 0) { "${ageMin}m" } else { 'unknown' }
            Write-Log "OK $key run $rid ($agent) running $shown"
        }
    }
}

# memory headroom: the squad runs have failed before at <300MB free
$freeMB = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
if ($freeMB -lt 400) { Write-Log "WARN low memory ${freeMB}MB free" }
