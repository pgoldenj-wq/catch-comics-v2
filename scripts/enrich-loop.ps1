# enrich-loop.ps1 — restart wrapper for the CV catalogue enrichment.
# Launched by the Windows Scheduled Task "CatchComicsEnrichment".
# Loops indefinitely, restarting `npm run enrich:catalogue:full` on any exit
# (crash, network error, Neon connection drop, user stop, etc.).
# The script is checkpoint-resumable so restarts pick up cleanly.

$ErrorActionPreference = 'Continue'
$WorkDir = 'C:\Users\pgold\Documents\CatchComics\catch-comics'
$LogDir  = Join-Path $WorkDir 'logs'
$null = New-Item -ItemType Directory -Force -Path $LogDir
$LogFile = Join-Path $LogDir 'enrich-catalogue.log'
$PidFile = Join-Path $LogDir 'enrich-loop.pid'

# Record this wrapper's PID so the stop script can kill us cleanly.
$PID | Out-File -FilePath $PidFile -Encoding ascii -Force

Set-Location $WorkDir

function Log($msg) {
  $stamp = Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'
  "[$stamp] $msg" | Tee-Object -FilePath $LogFile -Append | Out-Host
}

Log "wrapper started (PID $PID); workdir=$WorkDir"

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

while ($true) {
  Log "launching: npm run enrich:catalogue:full -- --rate-ms 20000"
  # Append stdout+stderr to the log; the script itself also writes its own
  # progress lines so this captures both the wrapper meta and the npm output.
  & cmd /c "npm run enrich:catalogue:full -- --rate-ms 20000" *>> $LogFile
  $exit = $LASTEXITCODE
  Log "exited with code $exit; restarting in 5s"
  Start-Sleep -Seconds 5
}
