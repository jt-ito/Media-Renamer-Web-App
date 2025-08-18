<#
PowerShell dev helper for Windows (native PowerShell)
Usage:
  # single-window (tails logs)
  powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1

  # open two separate PowerShell windows (recommended for interactive dev)
  powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1 -NewWindows

This script assumes pnpm is on PATH and your projects use `pnpm -C <folder> run dev`.
#>
[CmdletBinding()]
param(
  [switch]$NewWindows
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir
$RepoRoot = Resolve-Path ".." | Select-Object -ExpandProperty Path
Set-Location $RepoRoot

$PORT = '8787'
$STATIC_ROOT = Join-Path $RepoRoot 'web\dist'
$WebLog = Join-Path $RepoRoot 'web-dev.log'
$ServerLog = Join-Path $RepoRoot 'server-dev.log'

# remove old logs
Remove-Item -Path $WebLog -ErrorAction SilentlyContinue
Remove-Item -Path $ServerLog -ErrorAction SilentlyContinue

if ($NewWindows) {
  Write-Host "Opening web dev in new window..." -ForegroundColor Cyan
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-Command',"pnpm -C web run dev") -WindowStyle Normal

  Write-Host "Opening server dev in new window with PORT=$PORT STATIC_ROOT=$STATIC_ROOT..." -ForegroundColor Cyan
  $serverCmd = "`$env:PORT='$PORT'; `$env:STATIC_ROOT='${STATIC_ROOT.Replace("'","''") }'; pnpm -C server run dev"
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-Command',$serverCmd) -WindowStyle Normal

  Write-Host "Started processes in separate windows. Logs will be written to:`n  $WebLog`n  $ServerLog" -ForegroundColor Green
  exit 0
}

# Single-window mode: start jobs and tail logs here
Write-Host "Starting web dev job (logs -> $WebLog)" -ForegroundColor Cyan
$webJob = Start-Job -Name WebDev -ScriptBlock {
  pnpm -C web run dev *>&1 | Out-File -FilePath (Join-Path $using:RepoRoot 'web-dev.log') -Append -Encoding utf8
}

Write-Host "Starting server dev job (logs -> $ServerLog) with PORT=$PORT STATIC_ROOT=$STATIC_ROOT" -ForegroundColor Cyan
$serverJob = Start-Job -Name ServerDev -ScriptBlock {
  `$env:PORT = $using:PORT
  `$env:STATIC_ROOT = $using:STATIC_ROOT
  pnpm -C server run dev *>&1 | Out-File -FilePath (Join-Path $using:RepoRoot 'server-dev.log') -Append -Encoding utf8
}

# Wait briefly to let logs start
Start-Sleep -Seconds 1
Write-Host "Tailing logs (press Ctrl+C to stop tailing; jobs will continue running)." -ForegroundColor Yellow
Get-Content -Path $WebLog, $ServerLog -Wait -Tail 200

# Note: To stop the background jobs later, run:
# Get-Job -Name WebDev,ServerDev | Stop-Job; Get-Job -Name WebDev,ServerDev | Remove-Job
