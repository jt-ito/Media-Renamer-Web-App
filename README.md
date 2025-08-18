# Media Renamer

Small web + server app to preview and apply canonical renames for media files (series & movies).

This project contains two packages:
- `server/` — Node + TypeScript Fastify backend that computes previews and performs renames.
- `web/` — React + TypeScript Vite app for interactive scanning and approving plans.

## Table of contents
- Quickstart (dev)
- Production build
- Example GitHub Actions workflow
- Example Dockerfile & docker-compose
- Common troubleshooting
- Useful commands
- Contributing & license

## Quickstart (development)
Run two shells (one for server, one for web):

PowerShell — server:
```powershell
cd server
pnpm install
pnpm run dev
```

PowerShell — web:
```powershell
cd web
pnpm install
pnpm run dev
```

The web UI runs at http://localhost:5173 by default. The server listens on the configured port (see `server/src/settings.ts`).

## Production build
Build both packages locally:

```powershell
cd server
pnpm install
pnpm run build

cd web
pnpm install
pnpm run build
```

After building, the `web/dist` folder contains the static site; `server/dist` contains compiled JS.

## Minimal GitHub Actions workflow (example)
Place this in `.github/workflows/ci.yml` to run a minimal build on push / PR. It installs pnpm (via corepack), enforces frozen lockfiles and builds both packages.

```yaml
name: CI

on:
  push: {}
  pull_request: {}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: corepack enable && corepack prepare pnpm@latest --activate

      - name: Build server
        working-directory: server
        run: |
          pnpm install --frozen-lockfile
          pnpm run build

      - name: Build web
        working-directory: web
        run: |
          pnpm install --frozen-lockfile
          pnpm run build
```

Notes:
- Use `--frozen-lockfile` in CI to ensure `pnpm-lock.yaml` matches `package.json`. If CI fails with `ERR_PNPM_OUTDATED_LOCKFILE`, update the lockfile locally and commit it.

## Example Dockerfile (multi-stage)
This repository includes a Dockerfile that builds both server and web; an example minimal multi-stage Dockerfile looks like:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
WORKDIR /app/server
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install && pnpm run build
WORKDIR /app/web
RUN pnpm install && pnpm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

## Example docker-compose snippet
```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - 3000:3000
    volumes:
      - ./config:/app/config:ro
```

## Common troubleshooting
- pnpm frozen lockfile errors: run `pnpm install` locally in the package (server/web) to update `pnpm-lock.yaml` and commit it.
- Windows CRLF vs LF: Git may warn about CRLF conversion when editing files on Windows; this is usually safe but you can set core.autocrlf appropriately.
- Port conflicts: server defaults may collide with another process — change the server port in `config/settings.json` or via env var.

## Useful commands
- Run server dev: `cd server && pnpm install && pnpm run dev`
- Run web dev: `cd web && pnpm install && pnpm run dev`
- Build both: `pnpm --filter server... install && pnpm --filter server... build` (or run per-package build commands above)

## Contributing
- Open issues for feature requests or bug reports. Include steps to reproduce and relevant logs.

## License
MIT — see `LICENSE`.
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
