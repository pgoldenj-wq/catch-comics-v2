# enrich-loop-w2.ps1 — restart wrapper for CV catalogue enrichment, Worker 2.
# Launched by the Windows Scheduled Task "CatchComicsEnrichment-W2".
# Loops indefinitely, restarting the enrichment on any exit.
# Worker 2 partition: TPB / HARDCOVER / OTHER formats, uses COMIC_VINE_API_KEY_2.
# Checkpoint: scripts/.enrich-catalogue-checkpoint-w2.json

$ErrorActionPreference = 'Continue'
$WorkDir = 'C:\Users\pgold\Documents\CatchComics\catch-comics'
$LogDir  = Join-Path $WorkDir 'logs'
$null = New-Item -ItemType Directory -Force -Path $LogDir
$LogFile = Join-Path $LogDir 'enrich-catalogue-w2.log'
$PidFile = Join-Path $LogDir 'enrich-loop-w2.pid'

$PID | Out-File -FilePath $PidFile -Encoding ascii -Force

Set-Location $WorkDir

function Log($msg) {
  $stamp = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'
  "[$stamp] $msg" | Tee-Object -FilePath $LogFile -Append | Out-Host
}

Log "wrapper started (PID $PID); workdir=$WorkDir; worker=2"

# Prevent S0 Low Power Idle (Modern Standby) while this wrapper is alive.
# ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001) — keep system awake.
# The flag is automatically cleared when this PowerShell process exits.
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class SleepBlock {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
  // PS 5.1 parses 0x80000001 as signed Int32 (-2147483647), which it refuses to
  // widen to uint for P/Invoke.  Keep the constant in C# where the u-suffix is legal.
  public static void PreventSleep() {
    SetThreadExecutionState(0x80000001u); // ES_CONTINUOUS | ES_SYSTEM_REQUIRED
  }
}
'@
[SleepBlock]::PreventSleep()
Log "sleep-block active: ES_CONTINUOUS | ES_SYSTEM_REQUIRED"

# Restart policy — see enrich-loop.ps1. A bare 5s restart turns a job that
# exits immediately into a permanent hot loop; on 2026-08-07 that produced
# 117.6 GB/day of Neon egress for zero useful work.
$NothingToDoExit  = 3
$IdleSleepSeconds = 3600
$MinRunSeconds    = 60
$BackoffSeconds   = 900

while ($true) {
  Log "launching: npm run enrich:catalogue:full -- --worker-id 2 --rate-ms 20000"
  $started = Get-Date
  & cmd /c "npm run enrich:catalogue:full -- --worker-id 2 --rate-ms 20000" *>> $LogFile
  $exit = $LASTEXITCODE
  $ran  = [int]((Get-Date) - $started).TotalSeconds

  if ($exit -eq $NothingToDoExit) {
    Log "nothing to process (exit $exit) after ${ran}s; sleeping ${IdleSleepSeconds}s"
    Start-Sleep -Seconds $IdleSleepSeconds
  } elseif ($ran -lt $MinRunSeconds) {
    Log "exited with code $exit after only ${ran}s; backing off ${BackoffSeconds}s to avoid a hot restart loop"
    Start-Sleep -Seconds $BackoffSeconds
  } else {
    Log "exited with code $exit after ${ran}s; restarting in 5s"
    Start-Sleep -Seconds 5
  }
}
