@echo off
cd /d "C:\Users\pgold\Documents\CatchComics\catch-comics"
echo.
echo  Generating Catch Comics Founder Command Centre...
node launch\generate-dashboard.js
if %errorlevel% neq 0 (
  echo.
  echo  ERROR: Could not generate dashboard.
  echo  Make sure Node.js is installed and you are in the project folder.
  pause
  exit /b 1
)
start "" "launch\dashboard.html"
