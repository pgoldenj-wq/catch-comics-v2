@echo off
rem Catch Comics - Command Centre launcher wrapper.
rem Exists so a desktop shortcut works regardless of PowerShell ExecutionPolicy.
rem All arguments pass through to the .ps1 (e.g. -SkipChecks -Page smoke-test-v4.html).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-command-centre.ps1" %*
if %errorlevel% neq 0 (
  echo.
  echo  Launcher exited with an error - see messages above.
  pause
)
