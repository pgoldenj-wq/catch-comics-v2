# Catch Comics - create the operations desktop shortcuts. Run once:
#   powershell -ExecutionPolicy Bypass -File launch\operations\create-desktop-shortcut.ps1
#
# Creates:
#   Desktop\Catch Comics Command Centre.lnk           (one-click daily launcher)
#   Desktop\Catch Comics <emdash> Operations\         (folder with all three)
#     - Catch Comics Command Centre.lnk
#     - Smoke Test V4.lnk         (ensures server, opens V4, skips the checks)
#     - Catch Comics Production.url
#
# Follows the pattern of launch/setup-shortcut.ps1 (the older dashboard shortcut).

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Cmd      = Join-Path $PSScriptRoot 'open-command-centre.cmd'
if (-not (Test-Path $Cmd)) { Write-Host "ERROR: $Cmd not found" -ForegroundColor Red; exit 1 }

$Desktop  = [Environment]::GetFolderPath('Desktop')
# Folder name uses a real em dash, built from its code point so this file
# stays pure ASCII (PowerShell 5.1 misreads BOM-less UTF-8 source).
$OpsDir   = Join-Path $Desktop ('Catch Comics ' + [char]0x2014 + ' Operations')
if (-not (Test-Path $OpsDir)) { New-Item -ItemType Directory -Path $OpsDir | Out-Null }

$Shell = New-Object -ComObject WScript.Shell

# NB: parameter must not be called $Args - that collides with PowerShell's
# automatic $args variable and silently drops the shortcut arguments.
function New-CmdShortcut($LnkPath, $LaunchArgs, $Description) {
  $s = $Shell.CreateShortcut($LnkPath)
  $s.TargetPath       = $Cmd
  if ($LaunchArgs) { $s.Arguments = $LaunchArgs }
  $s.WorkingDirectory = $RepoRoot
  $s.Description      = $Description
  $s.WindowStyle      = 1   # normal window - failures must stay visible
  $s.IconLocation     = '%SystemRoot%\System32\shell32.dll,137'
  $s.Save()
}

# 1. Command Centre - on the Desktop itself AND inside the folder
New-CmdShortcut (Join-Path $Desktop 'Catch Comics Command Centre.lnk') '' `
  'Run health + smoke checks and open Mission Control'
New-CmdShortcut (Join-Path $OpsDir 'Catch Comics Command Centre.lnk') '' `
  'Run health + smoke checks and open Mission Control'

# 2. Smoke Test V4 - same launcher, skips the ~1 min of checks, opens V4
New-CmdShortcut (Join-Path $OpsDir 'Smoke Test V4.lnk') '-SkipChecks -Page smoke-test-v4.html' `
  'Open Smoke Test V4 (starts the local server if needed)'

# 3. Production - plain internet shortcut
$urlFile = Join-Path $OpsDir 'Catch Comics Production.url'
Set-Content -Path $urlFile -Encoding ASCII -Value @(
  '[InternetShortcut]',
  'URL=https://www.catchcomics.com'
)

Write-Host ''
Write-Host "  Created:" -ForegroundColor Green
Write-Host "    $Desktop\Catch Comics Command Centre.lnk"
Write-Host "    $OpsDir\Catch Comics Command Centre.lnk"
Write-Host "    $OpsDir\Smoke Test V4.lnk"
Write-Host "    $OpsDir\Catch Comics Production.url"
Write-Host ''
Write-Host '  Double-click "Catch Comics Command Centre" for the daily run.'
Write-Host ''
