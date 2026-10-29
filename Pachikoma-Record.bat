@echo off
rem Double-click to open the system-audio recorder page (work\audio\tools\record_system_audio.html) through a local server.
rem (ASCII only on purpose: safe for any Windows code page.) Use Chrome or Edge. Close this window to stop.
setlocal
cd /d "%~dp0"
set PORT=8801
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:%PORT%/audio/tools/record_system_audio.html"
where node >nul 2>nul
if %errorlevel%==0 goto usenode
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0work\game_demo\play\serve.ps1" -Port %PORT% -NoOpen
goto end
:usenode
node "%~dp0work\game_demo\play\serve.mjs" %PORT%
:end
echo.
echo Stopped. Press any key to close.
pause >nul
