@echo off
rem Double-click to start the Pachikoma remote controller (staff phone -> game PCs). ASCII only on purpose.
rem Needs Node.js. Open the URL shown below on a phone connected to the same Wi-Fi.
rem To change the PIN or the number of machines, edit the two lines below.
setlocal
cd /d "%~dp0"
set PORT=8900
set STATIONS=3
rem Leave PIN empty to use a random 4-digit PIN (saved in remote_pin.txt and shown below). Example: set PIN=1234
set PIN=
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js was not found. Install Node.js or run this on a PC that has it.
  goto end
)
if "%PIN%"=="" (
  node "%~dp0remote_server.mjs" --port %PORT% --stations %STATIONS%
) else (
  node "%~dp0remote_server.mjs" --port %PORT% --stations %STATIONS% --pin %PIN%
)
:end
echo.
echo Stopped. Press any key to close.
pause >nul
