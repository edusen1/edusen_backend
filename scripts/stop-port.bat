@echo off
REM Wrapper to run the PowerShell stop-port script
IF "%~1"=="" (
  SET PORT=3000
) ELSE (
  SET PORT=%1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-port.ps1" -Port %PORT%
