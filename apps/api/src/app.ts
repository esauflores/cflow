import { sql } from "drizzle-orm";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import { loadConfig, systemClock } from "@api/core/config.ts";
import { db } from "@api/core/db.ts";
import { onError, onNotFound } from "@api/core/errors.ts";
import { requestLogger } from "@api/core/logger.ts";
import { createRouter } from "@api/core/openapi.ts";
import { rateLimit } from "@api/core/rate-limit.ts";
import { authRoutes, blockGuestWrites, requireSession } from "@api/modules/auth/auth.routes.ts";
import { i18nRoutes } from "@api/modules/i18n/i18n.routes.ts";
import { seedDefaultCategories } from "@api/modules/ledger/categories.service.ts";
import { ledgerRoutes } from "@api/modules/ledger/ledger.routes.ts";

/**
 * The API, everything under /api. It's on the web app's origin (server.ts puts both on one port), so no CORS. Each
 * request is logged once answered (`GET /api/transactions 200 3ms`), except /api/health, which also reads the database
 * (a SELECT 1) and answers 500 when it can't. Each client gets RATE_LIMIT requests a minute (300 by default, 0 for no
 * limit), /health aside. A request body over MAX_BODY_BYTES answers 413. Authentication is a single server password:
 * /api/auth is public (setup, login, guest), everything else needs a session, and guests may only read.
 */
export function createApp() {
  const config = loadConfig();
  const clock = systemClock(config.timeZone);
  const deps = { db, clock, config };
  seedDefaultCategories(db);

  const app = createRouter().basePath("/api");

  app.notFound(onNotFound);
  app.onError(onError);
  app.use(requestLogger({ skip: ["/api/health"] }));
  app.use(secureHeaders());
  if (config.rateLimit > 0) {
    app.use(
      rateLimit({
        limit: config.rateLimit,
        windowMs: 60_000,
        skip: (c) => c.req.path === "/api/health",
        message: {
          success: false,
          message: "Too many requests, please try again later",
          code: "TOO_MANY_REQUESTS",
        },
      }),
    );
  }
  app.use(
    bodyLimit({
      maxSize: config.maxBodyBytes,
      onError: () => {
        throw new HTTPException(413, { message: `The request body is over ${config.maxBodyBytes} bytes` });
      },
    }),
  );
  app.doc31("/openapi.json", { openapi: "3.1.0", info: { title: "CFlow API", version: "0.1.0" } });

  app.get("/health", (c) => {
    db.get(sql`SELECT 1`);
    return c.json({ ok: true });
  });
  app.route("/auth", authRoutes(deps));
  if (config.plugins.includes("i18n")) app.route("/plugins/i18n", i18nRoutes());

  // Reads are open to guests; every write in the ledger needs the owner session. The middleware is registered on the
  // paths the ledger owns, not "*", so an unknown route still answers 404 instead of 401.
  for (const path of ["/balance", "/summary", "/transactions", "/transactions/*", "/categories", "/categories/*"]) {
    app.use(path, requireSession(deps));
    app.use(path, blockGuestWrites);
  }
  app.route("/", ledgerRoutes(deps));

  return app;
}

/** The API's routes and their types, for the web app's typed client (`hc<AppType>`, through client.ts). */
export type AppType = ReturnType<typeof createApp>;

/** server.ts prints the proxy mode at start, from the setting the middleware reads. */
export function trustProxy(): boolean {
  return loadConfig().trustProxy;
}
