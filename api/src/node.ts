import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { startCflow } from "@api/app.ts";
import { openDatabase } from "@api/core/db.ts";
import { loadConfig, systemClock } from "@api/core/deps.ts";

// Bun loads .env by itself; this keeps `node dist/server.mjs` working the same. A real environment
// variable still wins.
if (existsSync(".env")) process.loadEnvFile(".env");

const config = loadConfig();
if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });
const db = await openDatabase(config.databasePath);

const { host, app } = await startCflow({
  db,
  clock: systemClock(config.timeZone),
  config,
});
const installed = host.list().filter((p) => p.source !== "inline");
if (installed.length > 0) console.log(`Plugins: ${installed.map((p) => `${p.name} (${p.source})`).join(", ")}`);

// One process, one port, as in development: /api and /health go to the API, everything else is the built
// web app in web/dist (`vp build`), with index.html for client-side routes such as /transactions.
const WEB_DIST = "web/dist";
if (!existsSync(`${WEB_DIST}/index.html`))
  console.warn(`No ${WEB_DIST}/index.html: run \`bun run build\` to serve the web app.`);
const site = new Hono()
  .use("*", serveStatic({ root: WEB_DIST }))
  .get("*", serveStatic({ path: `${WEB_DIST}/index.html` }));
const fetch = (request: Request) => {
  const { pathname } = new URL(request.url);
  const isApi = pathname === "/health" || pathname === "/api" || pathname.startsWith("/api/");
  return isApi ? app.fetch(request) : site.fetch(request);
};

const server = serve({ fetch, port: config.port }, (info) => {
  console.log(`CFlow listening on http://localhost:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await host.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
