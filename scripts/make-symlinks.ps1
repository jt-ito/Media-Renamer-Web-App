param(
  [string]$InputPath = '',
  [string]$OutputPath = '',
  [switch]$Force
)

# make-symlinks.ps1 — create symlinks on Windows host
if (-not $InputPath -and -not $OutputPath) { Write-Host "Usage: .\make-symlinks.ps1 -InputPath <path> -OutputPath <path> [-Force]"; exit 2 }

if ($env:MR_BASE_DIR) { $base = $env:MR_BASE_DIR } else { $base = Join-Path $env:USERPROFILE 'containers\media-renamer' }
if (-not (Test-Path $base)) { New-Item -ItemType Directory -Path $base -Force | Out-Null }

if ($InputPath) {
  $link = Join-Path $base 'input'
  if (Test-Path $link -PathType Any) {
    if ($Force) { Remove-Item $link -Recurse -Force } else { Write-Host "Link $link exists; use -Force to replace" }
  }
  New-Item -ItemType SymbolicLink -Path $link -Target $InputPath | Out-Null
  Write-Host "Created symlink: $link -> $InputPath"
}

if ($OutputPath) {
  $link = Join-Path $base 'output'
  if (Test-Path $link -PathType Any) {
    if ($Force) { Remove-Item $link -Recurse -Force } else { Write-Host "Link $link exists; use -Force to replace" }
  }
  New-Item -ItemType SymbolicLink -Path $link -Target $OutputPath | Out-Null
  Write-Host "Created symlink: $link -> $OutputPath"
}
