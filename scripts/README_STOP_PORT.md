Stop port helper

Usage:

- PowerShell (recommended):

  .\stop-port.ps1 -Port 3000

- From cmd.exe (wrapper):

  stop-port.bat 3000

Default port is 3000 when no argument is provided.

The script attempts to use `Get-NetTCPConnection`, and falls back to `netstat -ano` parsing if needed.
