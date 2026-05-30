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

while ($true) {
  Log "launching: npm run enrich:catalogue:full"
  # Append stdout+stderr to the log; the script itself also writes its own
  # progress lines so this captures both the wrapper meta and the npm output.
  & cmd /c "npm run enrich:catalogue:full" *>> $LogFile
  $exit = $LASTEXITCODE
  Log "exited with code $exit; restarting in 30s"
  Start-Sleep -Seconds 30
}
