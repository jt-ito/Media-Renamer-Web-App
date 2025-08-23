# Collect logs across the repository into a timestamped folder and zip it.
# Usage: run this from the repo root with PowerShell. It will skip node_modules, .git, dist, release.

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $repoRoot) { $repoRoot = Get-Location }
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $repoRoot "logs-collection-$timestamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Write-Host "Collecting logs to: $outDir"

# Exclude common heavy folders
$excludeRegex = '\\node_modules\\|\\.git\\|\\\bdist\\b|\\brelease\\b|\\blogs-collection-'  

# Find candidate files by extension
$files = Get-ChildItem -Path $repoRoot -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '\.(log|err|out|txt)$' -and ($_.FullName -notmatch $excludeRegex) }

# Also include named dev logs at repo root if present
$named = @('server-dev.log','web-dev.log','server-dev.err','web-dev.err')
foreach ($n in $named) {
  $p = Join-Path $repoRoot $n
  if (Test-Path $p) {
    $files = $files + (Get-Item -LiteralPath $p)
  }
}

$files = $files | Sort-Object FullName -Unique

if (-not $files -or $files.Count -eq 0) {
  Write-Host "No log files found."
} else {
  foreach ($f in $files) {
    try {
      $rel = $f.FullName.Substring($repoRoot.Length).TrimStart('\','/')
      $dest = Join-Path $outDir $rel
      $destDir = Split-Path $dest -Parent
      if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
      Copy-Item -Path $f.FullName -Destination $dest -Force
    } catch {
      Write-Warning "Failed to copy $($f.FullName): $_"
    }
  }

  $zip = "$outDir.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  try {
    Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zip -Force
    Write-Host "Compressed logs to: $zip"
  } catch {
    Write-Warning "Compression failed: $_"
  }

  Write-Host "Summary of collected files:"
  Get-ChildItem -Path $outDir -Recurse | Select-Object @{n='Path';e={$_.FullName.Substring($repoRoot.Length).TrimStart('\','/')}}, @{n='Size';e={$_.Length}} | Format-Table -AutoSize

  # show a small preview of the largest server log files
  $preview = Get-ChildItem -Path $outDir -Recurse | Sort-Object Length -Descending | Select-Object -First 5
  foreach ($p in $preview) {
    Write-Host "--- Preview: $($p.FullName) (size: $($p.Length)) ---"
    try {
      Get-Content -Path $p.FullName -TotalCount 200 | ForEach-Object { Write-Host $_ }
    } catch {
      Write-Warning "Could not preview $($p.FullName): $_"
    }
  }
}

Write-Host "Done."
