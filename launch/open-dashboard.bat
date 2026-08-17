@echo off
rem Catch Comics - opens the LIVE command centre (Mission Control).
rem
rem This file used to regenerate and open launch\dashboard.html and announce
rem itself as the "Founder Command Centre". That page is built from LAUNCH.md
rem and WEEK.md, which were frozen on 2026-06-23, so it shows the June/July
rem launch sprint - old dates, Smoke Test V3, an obsolete readiness %, and no
rem Browser Trust card. Having two entry points both called "Command Centre"
rem meant the stale one got opened and read as current status.
rem
rem Mission Control is the live command centre. It is the only one that shows
rem current Production status, Browser Trust, Cost Guard and retailer health,
rem and it is the one with the working "Run Browser Trust" control.
rem
rem The historical sprint dashboard is still available - it is linked from
rem Mission Control, and generate-dashboard.js still builds it (now clearly
rem banner-marked as historical).

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0operations\open-command-centre.ps1" %*
if %errorlevel% neq 0 (
  echo.
  echo  Launcher exited with an error - see messages above.
  pause
)
