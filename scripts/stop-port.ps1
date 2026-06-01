<#
Stops processes listening on a given TCP port (Windows PowerShell).

Usage:
  .\stop-port.ps1 -Port 3000
  .\stop-port.ps1 3000
#>

param(
    [Parameter(Position=0)]
    [int]$Port = 3000
)

Write-Output "Stopping processes listening on port $Port..."
try {
    $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
} catch {
    Write-Output "Get-NetTCPConnection not available. Falling back to netstat parsing."
    $conns = @()
}

if (-not $conns -or $conns.Count -eq 0) {
    # fallback using netstat
    $lines = netstat -ano | Select-String ":$Port\s"
    $pids = $lines | ForEach-Object { $_.Line.Trim() -replace '\s+',' ' } | ForEach-Object { ($_ -split ' ')[-1] } | Sort-Object -Unique
    if ($pids.Count -eq 0) {
        Write-Output "No process found on port $Port."
        exit 0
    }
} else {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
}

foreach ($targetPid in $pids) {
    if ($targetPid -and $targetPid -ne 0) {
        try {
            Stop-Process -Id $targetPid -Force -ErrorAction Stop
            Write-Output "Stopped PID $targetPid on port $Port"
        } catch {
            Write-Output "Failed to stop PID $targetPid"
        }
    } else {
        Write-Output "Skipping PID $targetPid"
    }
}

Start-Sleep -Milliseconds 300
$check = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($check) {
    Write-Output "Port $Port still in use:"
    $check | Format-Table -AutoSize
    exit 1
} else {
    Write-Output "Port $Port is free."
    exit 0
}
