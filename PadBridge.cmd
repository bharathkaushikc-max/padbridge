@echo off
rem Starts the PadBridge app. Double-click this file, or run it from a terminal.
cd /d "%~dp0"
start "" "node_modules\electron\dist\electron.exe" .
