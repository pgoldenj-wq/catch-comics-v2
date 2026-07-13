# Catch Comics - Command Centre launcher (Wave 3 follow-up, 2026-07-13)
#
# One click: run launch:health + launch:smoke, ensure the Mission Control
# static server is up (reusing it if already running), open Mission Control.
#
# Safety: runs ONLY the two read-only launch commands. Never syncs retailers,
# never runs enrichment/backfills, never calls paid APIs, never writes to the
# production database. Failures stay on screen - the window pauses on any
# failure instead of closing.
#
# Usage (normally via open-command-centre.cmd / the desktop shortcut):
#   open-command-centre.ps1                                # full daily run
#   open-command-centre.ps1 -SkipChecks -Page smoke-test-v4.html
#   open-command-centre.ps1 -NonInteractive -NoBrowser     # automated testing
param(
  [switch]$SkipChecks,      # skip health+smoke (just ensure server + open page)
  [switch]$NoBrowser,       # don't open the browser (testing)
  [switch]$NonInteractive,  # never prompt (testing / scripted runs)
  [string]$Page = 'mission-control.html'
)

$ErrorActionPreference = 'Continue'
$Port = 8317
$BaseUrl = "http://localhost:$Port"

function Say($msg, $color) { if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg } }

# -- Locate the repo dynamically: this script lives at <repo>\launch\operations --
$RepoRoot = $null
try { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path } catch {}
$pkg = if ($RepoRoot) { Join-Path $RepoRoot 'package.json' } else { $null }
if (-not $RepoRoot -or -not (Test-Path $pkg) -or -not ((Get-Content $pkg -Raw) -match '"name":\s*"catch-comics"')) {
  Say "ERROR: Could not locate the catch-comics repository from $PSScriptRoot" Red
  Say "This script must stay inside <repo>\launch\operations\." Red
  if (-not $NonInteractive) { Read-Host 'Press Enter to close' }
  exit 1
}
Set-Location $RepoRoot

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
  Say 'ERROR: npm not found on PATH. Install Node.js (nodejs.org) and reopen.' Red
  if (-not $NonInteractive) { Read-Host 'Press Enter to close' }
  exit 1
}

Say ''
Say '  CATCH COMICS - COMMAND CENTRE' Cyan
Say "  Repo: $RepoRoot"
Say ''

$healthStatus = 'SKIPPED'
$smokeStatus  = 'SKIPPED'
$anyFailure   = $false

if (-not $SkipChecks) {
  # -- 1. Data & trust health (read-only DB snapshot) ------------------------
  Say '-- 1/3 . launch:health (read-only data snapshot, ~30s) --------------' DarkGray
  if (-not (Test-Path (Join-Path $RepoRoot '.env.local'))) {
    Say '  FAILED - .env.local not found (database credentials needed for health check)' Red
    $healthStatus = 'FAILED'; $anyFailure = $true
  } else {
    & npm run launch:health
    if ($LASTEXITCODE -eq 0) { $healthStatus = 'PASSED'; Say '  launch:health PASSED' Green }
    else { $healthStatus = 'FAILED'; $anyFailure = $true; Say "  launch:health FAILED (exit $LASTEXITCODE) - read the output above" Red }
  }

  # -- 2. Production smoke (20 public checks) --------------------------------
  Say ''
  Say '-- 2/3 . launch:smoke (production checks, ~15s) ---------------------' DarkGray
  & npm run launch:smoke
  $smokeExit = $LASTEXITCODE
  # The script writes its verdict JSON - use it to distinguish warnings.
  $smokeJson = Join-Path $RepoRoot 'launch\operations\launch-smoke-latest.json'
  $verdict = $null
  try { $verdict = (Get-Content $smokeJson -Raw | ConvertFrom-Json).verdict } catch {}
  if ($smokeExit -eq 0 -and $verdict -eq 'PASS') { $smokeStatus = 'PASSED'; Say '  launch:smoke PASSED' Green }
  elseif ($smokeExit -eq 0) { $smokeStatus = 'PASSED WITH WARNINGS'; Say '  launch:smoke PASSED WITH WARNINGS - review above' Yellow }
  else { $smokeStatus = 'FAILED'; $anyFailure = $true; Say "  launch:smoke FAILED (exit $smokeExit) - production needs attention. See launch/operations/incident-response.md" Red }
}

# -- 3. Mission Control server: reuse if healthy, start if absent ------------
Say ''
Say '-- 3/3 . Mission Control server -------------------------------------' DarkGray
function Test-McServer {
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/mission-control.html" -UseBasicParsing -TimeoutSec 3
    return ($r.StatusCode -eq 200 -and $r.Content -match 'Mission Control')
  } catch { return $false }
}

$serverStatus = ''
if (Test-McServer) {
  $serverStatus = "already running on port $Port (reused - no duplicate started)"
  Say "  Server $serverStatus" Green
} else {
  $portBusy = $false
  try { $portBusy = [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop) } catch {}
  if ($portBusy) {
    $serverStatus = "PORT $Port IS BUSY with something that is not Mission Control"
    Say "  $serverStatus - close whatever holds port $Port and rerun" Red
    $anyFailure = $true
  } else {
    Say "  Starting static server on port $Port (npx http-server launch/)..."
    Start-Process -FilePath 'npx.cmd' `
      -ArgumentList '--yes','http-server',(Join-Path $RepoRoot 'launch'),'-p',"$Port",'-c-1','--silent' `
      -WorkingDirectory $RepoRoot -WindowStyle Minimized
    $up = $false
    foreach ($i in 1..30) { Start-Sleep -Milliseconds 500; if (Test-McServer) { $up = $true; break } }
    if ($up) { $serverStatus = "started on port $Port"; Say "  Server $serverStatus" Green }
    else { $serverStatus = 'FAILED TO START within 15s'; Say "  Server $serverStatus" Red; $anyFailure = $true }
  }
}

# -- Open the browser only once the server actually responds ----------------
$targetUrl = "$BaseUrl/$Page"
if (-not $NoBrowser -and (Test-McServer)) {
  Start-Process $targetUrl
  Say "  Opened $targetUrl" Green
} elseif (-not $NoBrowser) {
  Say "  NOT opening the browser - server is not responding" Red
}

# -- Summary -----------------------------------------------------------------
Say ''
Say '  -- SUMMARY ----------------------------------------------' Cyan
$hc = 'Yellow'; if ($healthStatus -eq 'PASSED') { $hc = 'Green' } elseif ($healthStatus -eq 'FAILED') { $hc = 'Red' }
$sc = 'Yellow'; if ($smokeStatus  -eq 'PASSED') { $sc = 'Green' } elseif ($smokeStatus  -eq 'FAILED') { $sc = 'Red' }
Say "  Data health   : $healthStatus" $hc
Say "  Prod smoke    : $smokeStatus" $sc
Say "  Server        : $serverStatus"
Say "  Mission Control: $targetUrl"
Say ''

if ($anyFailure) {
  Say '  Something FAILED above - the window stays open so you can read it.' Red
  Say '  Playbook: launch/operations/incident-response.md' Red
  if (-not $NonInteractive) { Read-Host 'Press Enter to close' }
  exit 1
}
if (-not $SkipChecks -and -not $NonInteractive) { Read-Host 'All good. Press Enter to close' }
exit 0
