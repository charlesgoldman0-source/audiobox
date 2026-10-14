@echo off
rem Double-click this file on Windows to update Audiobox to the latest version, then start it.
rem Your settings are kept: the folders, the checklist and any Spotify sign-in live in files
rem inside this folder that an update never touches.
cd /d "%~dp0"

curl -s -m 2 http://localhost:4848/api/status >nul 2>nul
if not errorlevel 1 (
  echo Audiobox is still running. Close its window first, then double-click this file again.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found. Install it from https://git-scm.com and run this again.
  pause
  exit /b 1
)

echo Fetching the latest Audiobox...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo The update could not be applied automatically. This usually means a file in this
  echo folder was edited by hand. Copy .audiobox-library.json and .audiobox-spotify.json
  echo somewhere safe, install Audiobox again from the README, and put those two files back.
  pause
  exit /b 1
)

echo Installing anything new...
call npm install
if errorlevel 1 (
  echo Install failed.
  pause
  exit /b 1
)

echo Updated. Starting Audiobox...
call "Start Audiobox.cmd"
