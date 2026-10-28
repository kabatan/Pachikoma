@echo off
rem Double-click this file to play. (ASCII only on purpose: safe for any Windows code page.)
rem Uses Node.js if installed, otherwise the built-in PowerShell server. Opens your default browser.
setlocal
cd /d "%~dp0"
set PORT=8800
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0work\game_demo\play\prepare_release.ps1"
if errorlevel 1 goto end
where node >nul 2>nul
if %errorlevel%==0 goto usenode
echo Node.js not found. Using the built-in PowerShell server.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0work\game_demo\play\serve.ps1" -Port %PORT%
goto end
:usenode
echo Starting Pachikoma. A browser window opens by itself. Close this window to stop.
node "%~dp0work\game_demo\play\serve.mjs" %PORT% --open
:end
echo.
echo Stopped. Press any key to close.
pause >nul
