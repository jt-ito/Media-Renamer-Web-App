param(
    [string]$Port = '8787'
)

Set-StrictMode -Version Latest
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

Write-Host "Starting media-renamer in dev mode (no build)"

function Ensure-Pnpm {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) { return }
    if (Get-Command corepack -ErrorAction SilentlyContinue) {
        try { corepack enable; corepack prepare pnpm@latest --activate; return } catch { }
    }
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Write-Host "pnpm not found — installing via npm"
        npm install -g pnpm
    }
}

Ensure-Pnpm
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "pnpm is required but not available. Install pnpm or enable corepack and retry."
}

Write-Host "Installing dependencies for server and web"
pnpm -C server install
pnpm -C web install

# Set safe defaults so the server can persist settings when run locally
$env:SETTINGS_PATH = Join-Path $scriptDir '..\config\settings.json'
$env:PORT = $Port
if (Test-Path (Join-Path $scriptDir '..\web\dist')) { $env:STATIC_ROOT = (Resolve-Path (Join-Path $scriptDir '..\web\dist')).Path }

if (-not (Test-Path .\logs)) { New-Item -ItemType Directory -Path .\logs | Out-Null }

Write-Host "Starting server -> logs\server.log"
$serverProc = Start-Process -FilePath pnpm -ArgumentList '-C','server','run','dev' -RedirectStandardOutput 'logs\server.log' -RedirectStandardError 'logs\server.err' -PassThru -NoNewWindow

Write-Host "Starting web -> logs\web.log"
$webProc = Start-Process -FilePath pnpm -ArgumentList '-C','web','run','dev' -RedirectStandardOutput 'logs\web.log' -RedirectStandardError 'logs\web.err' -PassThru -NoNewWindow

try {
    Write-Host "Tailing logs (Ctrl-C to stop)..."
    # Tail both logs in the foreground. Get-Content will block until Ctrl-C.
    Get-Content -Path 'logs\server.log','logs\web.log' -Wait -Tail 0
} finally {
    Write-Host "Stopping server and web processes..."
    try { if ($serverProc -and -not $serverProc.HasExited) { $serverProc.Kill() } } catch {}
    try { if ($webProc -and -not $webProc.HasExited) { $webProc.Kill() } } catch {}
}

Pop-Location
