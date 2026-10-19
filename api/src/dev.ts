import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { startCflow } from "@api/app.ts";
import { type Client, openDatabase } from "@api/core/db.ts";
import { loadConfig, systemClock } from "@api/core/deps.ts";

// The API inside `vp dev`: @hono/vite-dev-server loads this module and sends it
// every /api request, so the web app and the API share one process and port.
// Production starts the API with node.ts instead. vite.config.ts has already
// loaded .env into process.env.

type Running = { stop: () => Promise<void>; db: Client };
const store = globalThis as typeof globalThis & { __cflowDev?: Running };

// Vite runs this module again when an API file changes: shut the previous
// plugin host and database connection down first, so they don't pile up.
if (store.__cflowDev) {
  await store.__cflowDev.stop();
  store.__cflowDev.db.close();
}

const config = loadConfig();
if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });
const db = await openDatabase(config.databasePath);
const { host, app } = await startCflow({ db, clock: systemClock(config.timeZone), config });
store.__cflowDev = { stop: () => host.stop(), db };

export default app;
