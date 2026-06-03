# enrich-task-install-w2.ps1 — register the CatchComicsEnrichment-W2 scheduled task.
# Worker 2: TPB/HARDCOVER/OTHER partition, COMIC_VINE_API_KEY_2, separate checkpoint.
# Run ONCE (or after editing). Idempotent — replaces any existing W2 task.
# Does NOT touch CatchComicsEnrichment (Worker 1).

$TaskName   = 'CatchComicsEnrichment-W2'
$WorkDir    = 'C:\Users\pgold\Documents\CatchComics\catch-comics'
$ScriptPath = Join-Path $WorkDir 'scripts\enrich-loop-w2.ps1'

if (-not (Test-Path $ScriptPath)) {
  Write-Error "Wrapper script not found at $ScriptPath"
  exit 1
}

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
  -WorkingDirectory $WorkDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed pre-existing task $TaskName"
}

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Catch Comics — CV catalogue enrichment Worker 2 (TPB/HARDCOVER/OTHER). Resumable; auto-restarts on exit.' | Out-Null

Write-Host ''
Write-Host '[OK] Task registered: CatchComicsEnrichment-W2'
Write-Host ''
Write-Host 'Manage with:'
Write-Host '  Start  : Start-ScheduledTask    -TaskName CatchComicsEnrichment-W2'
Write-Host '  Status : Get-ScheduledTaskInfo  -TaskName CatchComicsEnrichment-W2'
Write-Host '  Stop   : Stop-ScheduledTask     -TaskName CatchComicsEnrichment-W2'
Write-Host '  View   : schtasks /Query /TN CatchComicsEnrichment-W2 /V /FO LIST'
Write-Host '  Remove : Unregister-ScheduledTask -TaskName CatchComicsEnrichment-W2 -Confirm:0'
Write-Host ''
Write-Host 'Live log tail:'
Write-Host '  Get-Content C:\Users\pgold\Documents\CatchComics\catch-comics\logs\enrich-catalogue-w2.log -Tail 30 -Wait'
Write-Host ''
Write-Host 'Progress at any time:'
Write-Host '  cd C:\Users\pgold\Documents\CatchComics\catch-comics; npm run enrich:catalogue -- --worker-id 2 --report'
