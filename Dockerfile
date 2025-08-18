# Multi-stage Dockerfile for media-renamer
# Builds web (Vite) and server (TypeScript) and produces a lightweight runtime image

# -- Build web assets
FROM node:20-alpine AS web-builder
WORKDIR /app/web
ENV NODE_ENV=production
# Enable corepack/pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm run build

# -- Build server
FROM node:20-alpine AS server-builder
WORKDIR /app/server
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY server/ ./
RUN pnpm run build

# -- Final runtime image
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV STATIC_ROOT=/app/web/dist
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy server runtime (compiled) and production deps
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/node_modules ./node_modules
COPY --from=server-builder /app/server/package.json ./package.json

# Copy built web assets
COPY --from=web-builder /app/web/dist ./web/dist

# Optional env example
COPY .env.example ./

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8787/health || exit 1

CMD ["node", "dist/server.js"]
