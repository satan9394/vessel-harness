$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$fixtureRoot = Join-Path $repoRoot '.tmp/2026-10-08/.tmp-v22-mod-smoke'
$unsafeRoot = Join-Path $fixtureRoot '.harness/mods/unsafe'
New-Item -ItemType Directory -Force -Path $unsafeRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures/unsafe/vessel.mod.json') -Destination $unsafeRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures/unsafe/mod.js') -Destination $unsafeRoot

# Preserve this verification fixture. No repository or user data is deleted.
$smokeLog = Join-Path $PSScriptRoot 'cli-smoke.log'
Set-Content -LiteralPath $smokeLog -Value 'Epic 195 offline CLI smoke' -Encoding utf8NoBOM
Push-Location $repoRoot
try {
  & npx tsx apps/cli/src/cli.ts mod list *>> $smokeLog
  $actual = $LASTEXITCODE
  Add-Content -LiteralPath $smokeLog -Value "mod list EXIT_CODE=$actual EXPECTED=0"
  if ($actual -ne 0) { throw 'mod list failed' }

  & npx tsx apps/cli/src/cli.ts doctor --mods *>> $smokeLog
  $actual = $LASTEXITCODE
  Add-Content -LiteralPath $smokeLog -Value "doctor --mods EXIT_CODE=$actual EXPECTED=0"
  if ($actual -ne 0) { throw 'empty-workspace Mod doctor failed' }

  & npx tsx apps/cli/src/cli.ts mod audit $unsafeRoot *>> $smokeLog
  $actual = $LASTEXITCODE
  Add-Content -LiteralPath $smokeLog -Value "unsafe audit EXIT_CODE=$actual EXPECTED=1"
  if ($actual -ne 1) { throw 'unsafe audit did not deny fixture' }

  & npx tsx apps/cli/src/cli.ts doctor --mods --workspace $fixtureRoot *>> $smokeLog
  $actual = $LASTEXITCODE
  Add-Content -LiteralPath $smokeLog -Value "unsafe doctor EXIT_CODE=$actual EXPECTED=1"
  if ($actual -ne 1) { throw 'unsafe doctor did not deny fixture' }
} finally {
  Pop-Location
}
Get-Content -LiteralPath $smokeLog
