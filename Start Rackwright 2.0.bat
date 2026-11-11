@echo off
set PATH=%PATH%;%USERPROFILE%\.cargo\bin
cd /d "%~dp0rackwright-tauri"
if not exist node_modules call npm install
npm run tauri dev
pause
