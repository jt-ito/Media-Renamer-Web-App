# Improved PowerShell install-and-run
param(
	[string]$Port = '8787'
)

Write-Host "Running improved install-and-run.ps1 (port=$Port)"

function Find-Pnpm {
	if (Get-Command pnpm -ErrorAction SilentlyContinue) { return (Get-Command pnpm).Source }
	if (Get-Command corepack -ErrorAction SilentlyContinue) {
		try { corepack enable; corepack prepare pnpm@latest --activate; return (Get-Command pnpm).Source } catch { }
	}
	# common npm global path
	$npmGlobal = Join-Path $env:APPDATA 'npm\pnpm.cmd'
	if (Test-Path $npmGlobal) { return $npmGlobal }
	return $null
}

$pnpmPath = Find-Pnpm
if (-not $pnpmPath) {
	Write-Host "pnpm not found on PATH"
	if (Get-Command npm -ErrorAction SilentlyContinue) {
		Write-Host "Installing pnpm via npm (may require admin)"
		npm install -g pnpm
		Start-Sleep -Seconds 1
		$pnpmPath = Find-Pnpm
	}
}

if (-not $pnpmPath) {
	Write-Host "pnpm still not available. Attempting to run via Docker if available..."
	if (Get-Command docker -ErrorAction SilentlyContinue) {
		Write-Host "Building Docker image and running container"
		$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
		$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
		docker build -t media-renamer:latest $repoRoot
		docker run --rm -p $Port:8787 media-renamer:latest
		exit 0
	}
	throw "pnpm not found and Docker not available; cannot continue. Install Node.js and pnpm first."
}

# Move to server folder relative to script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDirCandidate = Join-Path $scriptDir '..\server'
if (Test-Path $serverDirCandidate) { $serverDir = Resolve-Path $serverDirCandidate } else { $serverDir = Resolve-Path (Join-Path $scriptDir 'server') }
Set-Location -Path $serverDir

& $pnpmPath install --frozen-lockfile --prod

# start server
node dist/server.js
