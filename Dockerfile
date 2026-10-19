# CFlow: the web app and the API on one port, the database a single SQLite
# file in /data. See README.md, "Docker".

# 1. Build the web app and bundle the server (needs the dev dependencies: Vite+, React, …).
FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# 2. Run: only the server's runtime dependencies, the server bundle, and the built web app.
FROM oven/bun:1.4.3-slim
WORKDIR /app
# The image's own port and database path; compose and `docker run -e` may override them.
ENV PORT=3000 \
    DATABASE_PATH=/data/cflow.db
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production && rm -rf ~/.bun/install/cache
COPY --from=build /app/dist/server.mjs dist/server.mjs
COPY --from=build /app/web/dist web/dist
# The database lives in a volume, owned by the unprivileged `bun` user the server runs as.
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT ?? 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "dist/server.mjs"]
