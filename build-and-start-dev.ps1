param(
	[string]$Port = "8787"
)

# Ensure PORT env var
$env:PORT = $Port
$env:STATIC_ROOT = (Resolve-Path .\web\dist).Path  # adjust path if needed

# Helper: kill any process listening on the configured port (Windows)
Write-Host "Checking for processes listening on port $env:PORT..."
try {
	$portInt = [int]$env:PORT
	$listeners = Get-NetTCPConnection -LocalPort $portInt -ErrorAction SilentlyContinue
	if ($listeners) {
		$pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
		foreach ($pid in $pids) {
			try {
				Write-Host "Stopping process $pid that is using port $env:PORT"
				Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
			} catch { Write-Host ('Failed to stop process {0}: {1}' -f $pid, $_) }
		}
		Start-Sleep -Milliseconds 300
	} else {
		Write-Host "No listeners found on port $env:PORT"
	}
} catch {
	Write-Host ('Could not query listeners (Get-NetTCPConnection may require admin): {0}' -f $_)
}

# Build the web client
function Find-Pnpm {
	if (Get-Command pnpm -ErrorAction SilentlyContinue) { return (Get-Command pnpm).Source }
	if (Get-Command corepack -ErrorAction SilentlyContinue) {
		try { corepack enable; corepack prepare pnpm@latest --activate; return (Get-Command pnpm).Source } catch { }
	}
	$npmGlobal = Join-Path $env:APPDATA 'npm\pnpm.cmd'
	if (Test-Path $npmGlobal) { return $npmGlobal }
	throw "pnpm not found. Install pnpm or enable corepack."
}

$pnpm = Find-Pnpm

# Build the web client
& $pnpm -C web run build

# Build the server
& $pnpm -C server run build

# Start the server (live-reload using nodemon)
& $pnpm -C server run dev:reload