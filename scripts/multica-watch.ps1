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

$script:lastStderr = ''
$script:lastJsonError = ''
function Invoke-Multica([string[]]$Arguments) {
    $all = & multica @Arguments 2>&1
    $stdout = ($all | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
    $err = ($all | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() }) -join ' '
    $script:lastStderr = $err
    return $stdout
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
        $first = $_.Exception.Message
        try { return $Text | ConvertFrom-Json } catch {
            $script:lastJsonError = "$first | $($_.Exception.Message)"
            return $null
        }
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

# Read the board as a table and take the issue identifiers. The JSON form can come back
# truncated when the CLI runs under Task Scheduler (observed 2026-11-25: 7,275 chars and
# no JSON error on stderr), and a truncated payload must not read as "nothing running".
$table = Invoke-Multica @('issue', 'list', '--status', 'in_progress')
$keys = @()
foreach ($line in ($table -split "`r?`n")) {
    if ($line -match '^\s*([A-Z][A-Z0-9]*-\d+)\s') { $keys += $Matches[1] }
}
$keys = @($keys | Select-Object -Unique)
if ($keys.Count -eq 0 -and $table -notmatch 'KEY') {
    $snippet = ($table -replace '\s+', ' ')
    if ($snippet.Length -gt 160) { $snippet = $snippet.Substring(0, 160) }
    Write-Log "WARN cannot read the in_progress board (len=$($table.Length)): $snippet"
}
Write-Log "in_progress issues: $($keys.Count)"

foreach ($key in $keys) {
    # Table form for the same reason as the board: the runs JSON is invalid whenever a
    # trigger summary carries a raw newline (observed 2026-11-25:
    # "After parsing a value an unexpected character was encountered: w ... trigger_summary").
    $runsTable = Invoke-Multica @('issue', 'runs', $key, '--active')
    $runs = @()
    foreach ($line in ($runsTable -split "`r?`n")) {
        if ($line -match '^\s*([0-9a-f]{8})\s{2,}') {
            $cols = @($line.Trim() -split '\s{2,}')
            $runs += [pscustomobject]@{
                id         = $cols[0]
                agent      = if ($cols.Count -gt 1) { $cols[1] } else { '?' }
                status     = if ($cols.Count -gt 2) { $cols[2] } else { '?' }
                started_at = if ($cols.Count -gt 3) { $cols[3] } else { $null }
            }
        }
    }
    if ($runs.Count -eq 0 -and $runsTable -match 'running') {
        $snippet = ($runsTable -replace '\s+', ' ')
        if ($snippet.Length -gt 160) { $snippet = $snippet.Substring(0, 160) }
        Write-Log "WARN $key has a running row but the columns could not be parsed: $snippet"
        continue
    }

    if ($runs.Count -eq 0) {
        # idle check: last run finish time from the full run list (table form again)
        $allRaw = Invoke-Multica @('issue', 'runs', $key)
        $completions = @()
        foreach ($line in ($allRaw -split "`r?`n")) {
            if ($line -match '^\s*[0-9a-f]{8}\s{2,}') {
                $cols = @($line.Trim() -split '\s{2,}')
                if ($cols.Count -ge 5 -and $cols[4] -match '^\d{4}-\d{2}-\d{2}') { $completions += $cols[4] }
            }
        }
        $lastDone = $completions | Sort-Object | Select-Object -Last 1
        $idle = $true
        $detail = 'no runs'
        if ($lastDone) {
            $done = [DateTime]::Parse($lastDone, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
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
        $agent = if ($run.agent) { $run.agent } else { '?' }
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

# MCP health: report only. Restarting the opencode service kills live sessions, so the
# remedy stays manual (see AGENT-OPS.md "MCP 报错速查").
try {
    $mcpRaw = & opencode mcp list 2>&1 | Out-String
    $bad = [regex]::Matches($mcpRaw, '✗\s+(\S+)')
    if ($bad.Count -gt 0) {
        $names = ($bad | ForEach-Object { $_.Groups[1].Value }) -join ','
        Write-Log "WARN mcp failed: $($bad.Count) ($names) -> opencode service restart"
    }
}
catch {
    Write-Log "WARN mcp check failed: $($_.Exception.Message)"
}
