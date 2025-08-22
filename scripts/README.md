Symlink helper scripts

Two helper scripts are provided to create host-side symlinks so the media-renamer container can access your chosen input and output folders without modifying docker-compose env files.

Both scripts support an override for the parent container-visible directory via the environment variable `MR_BASE_DIR`. If not set, they default to `$HOME/containers/media-renamer` (POSIX) or `$env:USERPROFILE\containers\media-renamer` (Windows).

POSIX (Linux/macOS):
  scripts/make-symlinks.sh <input-path> <output-path> [base-dir] [--force]

PowerShell (Windows):
  scripts\make-symlinks.ps1 -InputPath <path> -OutputPath <path> [-Force]

Behavior:
- Creates links at <base-dir>/input and <base-dir>/output pointing to the provided paths.
- Ensure your compose file mounts the parent `<base-dir>` into the container so the links are visible inside the container.

Production guidance:
- Do not hardcode user-specific paths in these scripts. Set `MR_BASE_DIR` in your host environment or pass an explicit `base-dir` when invoking the POSIX script.
- Run these scripts as a host user with permission to manage the target link locations.

Example (Linux):
  MR_BASE_DIR=/home/jt/containers/media-renamer ./scripts/make-symlinks.sh /mnt/sda1/Tor /data/renamed --force

Example (Windows PowerShell):
  $env:MR_BASE_DIR='C:\\Users\\jt\\containers\\media-renamer'; .\scripts\make-symlinks.ps1 -InputPath C:\\path\\to\\in -OutputPath C:\\path\\to\\out -Force
