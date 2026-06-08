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
using System;
using System.Runtime.InteropServices;
public class SleepBlock {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@
[SleepBlock]::SetThreadExecutionState(0x80000001) | Out-Null
Log "sleep-block active: ES_CONTINUOUS | ES_SYSTEM_REQUIRED"

while ($true) {
  Log "launching: npm run enrich:catalogue:full -- --worker-id 2 --rate-ms 20000"
  & cmd /c "npm run enrich:catalogue:full -- --worker-id 2 --rate-ms 20000" *>> $LogFile
  $exit = $LASTEXITCODE
  Log "exited with code $exit; restarting in 5s"
  Start-Sleep -Seconds 5
}
