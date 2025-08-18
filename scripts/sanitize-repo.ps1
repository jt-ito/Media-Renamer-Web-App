# Sanitize runtime logs and local settings before publishing
# This script clears runtime logs and resets runtime settings to avoid leaking local paths or API keys.

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

$files = @(
    "$repoRoot\preview-result.json",
    "$repoRoot\server-dev.log",
    "$repoRoot\web-dev.log",
    "$repoRoot\config\settings.json",
    "$repoRoot\config\approved.json"
)

foreach ($f in $files) {
    if (Test-Path $f) {
        Write-Host "Sanitizing $f"
        try {
            if ($f -like "*.log") {
                "SANITIZED: log truncated on $(Get-Date)" | Out-File -FilePath $f -Encoding utf8 -Force
            } else {
                "{}" | Out-File -FilePath $f -Encoding utf8 -Force
            }
        } catch {
            # Use explicit variable delimiters and subexpression to avoid PowerShell parsing issues when paths contain ':'
            Write-Host "Failed to sanitize ${f}: $($_)"
        }
    }
}

Write-Host "Sanitization complete. Review files before publishing."
