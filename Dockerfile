# Two stages: the first installs everything and runs the production build (server/build.ts), the second keeps only
# server/dist, which holds the server, the API and the page already bundled (and compressed) and the migrations, so
# it needs no node_modules: the database is SQLite from Bun itself, with no addon to build for a platform. That's why
# the second stage can be Alpine (musl), about 110 MB smaller than the Debian slim one; the build stage stays on
# Debian, where the dependencies and the bundler's plugins are installed for, and its dist is plain JavaScript.
FROM oven/bun:1.4.3-slim AS build

WORKDIR /app

# Dependencies first, so a code change doesn't reinstall them. --omit=peer skips peer dependencies, the big one being
# the npm copy of Bun that bun-plugin-tailwind asks for, which this image already is.
COPY package.json bun.lock bunfig.toml ./
COPY server/package.json server/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --omit=peer

COPY . .
RUN bun run build

FROM oven/bun:1.4.3-alpine

# The built server finds the page's files from its working directory, so it runs from the build's output. Settings
# come from docker run's -e or --env-file, not from a .env in the image.
WORKDIR /app
COPY --from=build /app/server/dist ./

# The database lives in /data (core/db.ts's default), a volume, so it outlives the container: mount one there
# (-v cflow-data:/data).
RUN mkdir /data && chown bun:bun /data
VOLUME /data

# The image runs behind a reverse proxy (see the README), so the API's rate limit counts the client IP the proxy adds
# to X-Forwarded-For, not the proxy's. Override with -e TRUST_PROXY=false when nothing is in front.
ENV TRUST_PROXY=true

USER bun
EXPOSE 3000

# Docker marks the container unhealthy when /api/health stops answering (Compose and Swarm can then restart it), on
# the port the server listens on, through Bun's fetch, as slim has no wget or curl. The health check isn't rate-limited.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health'); process.exit(r.ok ? 0 : 1)"

CMD ["bun", "server/src/server.js"]
