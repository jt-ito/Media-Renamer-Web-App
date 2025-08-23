Symlink helper scripts

Two helper scripts are provided to create host-side symlinks so the media-renamer container can access your chosen input and output folders without modifying docker-compose env files.

Both scripts support an override for the parent container-visible directory via the environment variable `MR_BASE_DIR`. If not set, they default to `$HOME/containers/media-renamer` (POSIX) or `$env:USERPROFILE\containers\media-renamer` (Windows).

POSIX (Linux/macOS):
  scripts/make-symlinks.sh <input-path> <output-path> [base-dir] [--force]

PowerShell (Windows):
  scripts\make-symlinks.ps1 -InputPath <path> -OutputPath <path> [-Force]

Symlink helpers have been removed from this repository per project policy and at the user's request.
If you need host-side assistance for making host directories available to the container, create explicit bind mounts in your Docker Compose and ensure the container has appropriate permissions.
- Ensure your compose file mounts the parent `<base-dir>` into the container so the links are visible inside the container.
