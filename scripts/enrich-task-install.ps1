# enrich-task-install.ps1 — register the CatchComicsEnrichment scheduled task.
# Run ONCE (or after editing). Idempotent — replaces any existing task.

$TaskName   = 'CatchComicsEnrichment'
$WorkDir    = 'C:\Users\pgold\Documents\CatchComics\catch-comics'
$ScriptPath = Join-Path $WorkDir 'scripts\enrich-loop.ps1'

if (-not (Test-Path $ScriptPath)) {
  Write-Error "Wrapper script not found at $ScriptPath"
  exit 1
}

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
  -WorkingDirectory $WorkDir

# Run at user logon — task survives terminal/VS Code close and re-fires after reboot.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Auto-restart on failure (the wrapper itself loops, but this catches OS-level kills too).
# ExecutionTimeLimit 0 = never time-out (this is a multi-day run).
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
  -Description 'Catch Comics — CV catalogue enrichment. Resumable; auto-restarts on exit.' | Out-Null

Write-Host ''
Write-Host '[OK] Task registered: CatchComicsEnrichment'
Write-Host ''
Write-Host 'Manage with:'
Write-Host '  Start  : Start-ScheduledTask    -TaskName CatchComicsEnrichment'
Write-Host '  Status : Get-ScheduledTaskInfo  -TaskName CatchComicsEnrichment'
Write-Host '  Stop   : Stop-ScheduledTask     -TaskName CatchComicsEnrichment'
Write-Host '  View   : schtasks /Query /TN CatchComicsEnrichment /V /FO LIST'
Write-Host '  Remove : Unregister-ScheduledTask -TaskName CatchComicsEnrichment -Confirm:0'
Write-Host ''
Write-Host 'Live log tail:'
Write-Host '  Get-Content C:\Users\pgold\Documents\CatchComics\catch-comics\logs\enrich-catalogue.log -Tail 30 -Wait'
Write-Host ''
Write-Host 'Progress at any time:'
Write-Host '  cd C:\Users\pgold\Documents\CatchComics\catch-comics; npm run enrich:catalogue:report'
