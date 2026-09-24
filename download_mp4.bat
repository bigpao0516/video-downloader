@echo off
setlocal DisableDelayedExpansion
title Universal Video and Music Downloader

:: Set target directory
set "DOWNLOAD_DIR=%USERPROFILE%\Videos\Download"

:: Check if an argument URL was passed
if "%~1"=="" goto interactive
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download_mp4.ps1" -Url "%~1" -DownloadDir "%DOWNLOAD_DIR%"
set "DOWNLOAD_EXIT=%ERRORLEVEL%"
goto finish

:: Interactive Mode
:interactive
cls
echo ======================================================================
echo                   Universal Video and Music Downloader
echo ======================================================================
echo  Download media from sites supported by yt-dlp
echo  Default destination: %DOWNLOAD_DIR%
echo ======================================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download_mp4.ps1" -DownloadDir "%DOWNLOAD_DIR%"
set "DOWNLOAD_EXIT=%ERRORLEVEL%"

:finish
if not "%DOWNLOAD_EXIT%"=="0" (
    echo Download failed. Review the error above.
    pause
    exit /b %DOWNLOAD_EXIT%
)
echo.
echo ======================================================================
echo Press [O] to Open download folder in File Explorer, or any key to exit.
echo ======================================================================
choice /c OE /n /m "Choose [O]pen folder or [E]xit: " /t 10 /d E
if errorlevel 2 goto end
if errorlevel 1 start explorer.exe "%DOWNLOAD_DIR%"

:end
exit /b 0
