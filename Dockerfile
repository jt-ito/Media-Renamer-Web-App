# Multi-stage Dockerfile for media-renamer
# Uses Debian-slim image to improve compatibility with native modules and build tools.

# -- Base image with build tools available
FROM node:20-bullseye-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl build-essential python3 make g++ git && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

# Enable corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate
 
# Allow building directly from upstream repo when no local context is provided
ARG REPO_URL=https://github.com/jt-ito/Media-Renamer-Web-App.git
ARG REPO_REF=HEAD
# Clone repository into image so subsequent stages can copy sources even when
# the build context doesn't contain the project files (useful for CI or for
# running 'docker compose' without checking out the repo locally).
RUN git clone --depth 1 --branch ${REPO_REF} ${REPO_URL} /src || true

# -- Build web assets
FROM base AS web-builder
WORKDIR /app/web
/* Copy web sources from cloned repo inside base (supports builds without host repo) */
COPY --from=base /src/web/package.json ./
COPY --from=base /src/web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prefer-frozen-lockfile=false || pnpm install
COPY --from=base /src/web/ ./
RUN pnpm run build

# -- Build server
FROM base AS server-builder
WORKDIR /app/server
/* Copy server sources from cloned repo inside base (supports builds without host repo) */
COPY --from=base /src/server/package.json ./
COPY --from=base /src/server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prefer-frozen-lockfile=false || pnpm install
COPY --from=base /src/server/ ./
RUN pnpm run build

# -- Final runtime image (slim)
FROM node:20-bullseye-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV STATIC_ROOT=/app/web/dist
RUN corepack enable && corepack prepare pnpm@latest --activate || true

# Copy server runtime (compiled) and production deps
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/node_modules ./node_modules
COPY --from=server-builder /app/server/package.json ./package.json

# Copy built web assets
COPY --from=web-builder /app/web/dist ./web/dist


EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:8787/health || exit 1

CMD ["node", "dist/server.js"]
