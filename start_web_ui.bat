@echo off
title Universal Video and Music Downloader Web UI

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_web_ui.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
