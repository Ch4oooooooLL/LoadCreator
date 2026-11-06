@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo   LoadCreator installer build (timestamped)
echo ============================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-exe.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [package-exe] build failed, exit code %RC%.
  pause
  exit /b %RC%
)
echo.
echo [package-exe] done.
pause
exit /b 0
