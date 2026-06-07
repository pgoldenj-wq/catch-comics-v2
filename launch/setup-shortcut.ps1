# Catch Comics — Desktop Shortcut Setup
# Run once: powershell -ExecutionPolicy Bypass -File launch\setup-shortcut.ps1

$ProjectPath = "C:\Users\pgold\Documents\CatchComics\catch-comics"
$BatPath     = "$ProjectPath\launch\open-dashboard.bat"
$Desktop     = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = "$Desktop\Catch Comics.lnk"

$Shell    = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath       = $BatPath
$Shortcut.WorkingDirectory = $ProjectPath
$Shortcut.Description      = "Catch Comics Mission Control"
$Shortcut.WindowStyle      = 7   # 7 = minimised window (hides the terminal flash)
$Shortcut.Save()

Write-Host ""
Write-Host "  Shortcut created: $ShortcutPath"
Write-Host "  Double-click 'Catch Comics' on your desktop to open the dashboard."
Write-Host ""
