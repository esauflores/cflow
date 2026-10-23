import { createApp, trustProxy } from "api";
import index from "web/index.html";

import { pageRoutes } from "./page.ts";

/**
 * One process: the API (the "api" package) and the web app (the "web" package) on one port, in development and in
 * production. The scripts load the repo root's .env.
 *
 * /api and everything under it goes to the API ("/api/*" alone doesn't match "/api"), everything else to the web
 * app, which answers any other path with its index.html, so client-side routes load too.
 * - `bun run dev`: Bun bundles the page (TSX, and CSS through Tailwind, see bunfig.toml), rebundles on change and
 *   hot-reloads it (React Fast Refresh); --hot reloads the API. It listens on 127.0.0.1 only, so the dev server (hot
 *   reload, browser console) isn't reachable from the network.
 * - `bun run build`, then `bun run start`: build.ts bundles this file, the API and the page into dist/ ahead of time,
 *   with NODE_ENV inlined as production; the page's files are read once at start and served from memory (page.ts).
 */

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid PORT, got "${process.env.PORT}"`);

const app = createApp();

const server = Bun.serve({
  port,
  hostname: process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
  routes: {
    "/api": app.fetch,
    "/api/*": app.fetch,
    ...(await pageRoutes(index)),
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

/**
 * Docker's stop (SIGTERM) and Ctrl-C (SIGINT): stop taking connections, let requests in flight finish, then exit.
 * A request that never finishes can't hold the container past the grace period (Docker's own is 10 s).
 * Registered once, as `bun --hot` reruns this file on every change but keeps the process.
 */
const SHUTDOWN_GRACE_MS = 5_000;
const shutdown = () => {
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  return server.stop().then(() => process.exit(0));
};

const processState = globalThis as { started?: boolean };
if (!processState.started) {
  processState.started = true;
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log(`Listening on ${server.url.href}`);
  const per = trustProxy() ? "the X-Forwarded-For header (TRUST_PROXY=true)" : "the connection's address";
  console.log(`Client IP: ${per}`);
}
