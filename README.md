# Media Renamer

Small web + server app to preview and apply canonical renames for media files (series & movies).

## Goals
- Provide an authoritative server preview and a React dashboard to scan and approve renames.
- Lightweight and friendly for large libraries: default behavior avoids eager work on huge scans.

## Prerequisites
- Node.js (LTS), pnpm (recommended) or npm.

## Quickstart (development)
Open two shells.

Server (in a shell from repository root):
```powershell
cd server
pnpm install
pnpm run dev
```

Web (in a shell from repository root):
```powershell
cd web
pnpm install
pnpm run dev
```

Visit the web UI at http://localhost:5173 and the server runs on the configured port.

## Build (production)
```powershell
cd server
pnpm install
pnpm run build

cd web
pnpm install
pnpm run build
```

## Configuration
- Use environment variables or GitHub secrets for any API keys (e.g., TVDB key). Do not commit secrets.

## Contributing
- Please open an issue for larger changes. Follow the code style and run the build locally before opening PRs.

## License
MIT — see `LICENSE`.
