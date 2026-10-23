# Architecture

The repo is a Bun workspace: `apps/api` (the Hono API), `apps/web` (the React page) and `server/` (Bun.serve, which
puts both on one port). The root holds the tooling, the scripts and the shared TypeScript settings. Imports use
`@api/` (`apps/api/src`) and `@web/` (`apps/web/src`).

```
package.json              workspaces and scripts: dev, build, start, check, test, db:generate
vite.config.ts            format, lint, aliases, api/server/web test projects
tsconfig.json             shared settings and the @api/@web paths
server/
  src/server.ts           Bun.serve: /api to the API, everything else to the web page
  src/page.ts             serves the bundled page from memory, with gzip and cache headers
  build.ts                production bundle into server/dist
apps/api/
  src/
    core/                 config and clock, database (Drizzle), error envelope, OpenAPI router,
                          money and date helpers, rate limit, logger
    modules/
      auth/               the server password, sessions and guest sessions
      ledger/             transactions, categories, balance and the dashboard summary
      i18n/               Spanish messages for the web app
    app.ts                composition root: middleware, public routes, the session-checked ledger
    client.ts             what the web app imports to type its API calls
  drizzle/                migrations, applied at start
  tests/
apps/web/
  index.html
  src/
    main.tsx              query client, routes, auth gate
    lib/                  api.ts (client, types, session), i18n.ts, utils.ts (formatting, theme)
    components/           ui/ (shadcn), Charts, Shell, TransactionDialog, DatePicker, Logo, Money
    pages/                Login, Dashboard, Transactions, Settings
    styles/global.css     Tailwind and the theme tokens
  tests/
```

## One process, one port

In development, `bun run dev` runs `server/src/server.ts` with Bun's hot reload. Bun bundles `apps/web/index.html` as
it is requested, rebundles on change and hot-reloads the page; editing an API file reloads the API. `/api` and
`/api/*` go to `createApp()` from the `api` workspace, everything else is the page, which answers any path with its
`index.html` so client-side routes load. The browser talks to one origin and needs no CORS.

In production, `bun run build` bundles `server/src/server.ts` with everything it imports — the API and the page — into
`server/dist/`. The page becomes hashed JS and CSS files, gzipped, which `server/src/page.ts` reads once at start. The
API's migrations are copied to `server/dist/drizzle/`, where `core/db.ts` finds them from the bundled server and applies
them at start. Run the build from `server/dist` (`bun run start` does).

## Core and modules

`apps/api/src/core` is the kernel: configuration, the database connection, the HTTP error envelope, the OpenAPI
router, the clock, money and date helpers, and rate limiting. `apps/api/src/modules` holds the features:

```
modules/
  auth/     auth.routes.ts, auth.service.ts, auth.schemas.ts, auth.table.ts
  ledger/   ledger.routes.ts, transactions.*, categories.*, *.table.ts
  i18n/     i18n.routes.ts, es.ts
```

`app.ts` mounts `/api/auth` and (when enabled) `/api/plugins/i18n` as public routes. It then puts the ledger routes
behind `requireSession`, which reads the bearer token and rejects guests on any write. `CFLOW_PLUGINS` chooses which
modules run; `core` is required and `i18n` is optional.

## Typed routes

Every route is declared with `createRoute` from `@hono/zod-openapi`: path, params, query, body and responses are Zod
schemas. The router's `defaultHook` turns invalid input into CFlow's `400 { success: false, message, code, errors }`
envelope before the handler runs. The routes are published at `/api/openapi.json`; `apps/api/src/client.ts` exports
`AppType` so the web app can use Hono's typed client without importing the API's code.

The web app currently calls the API through `apps/web/src/lib/api.ts`, which unwraps the `{ success, data }` envelope
and raises a translated `ApiError`. Its types mirror the schemas.

## Data

The database is SQLite from Bun (`bun:sqlite`), in the process, through Drizzle. It runs in WAL mode, with
`foreign_keys = ON`; `core/db.ts` fails at start if a pragma did not take. Each module declares its tables in
`<module>.table.ts`. `bun run db:generate` writes a migration into `apps/api/drizzle/`; the server applies the
migrations not yet applied when it starts, so a fresh database or an older one reaches the current schema.

Amounts are signed integer cents (negative is money out); calendar dates are `YYYY-MM-DD` text; instants are epoch
milliseconds. `APP_TIMEZONE` decides what "today" means for future-date checks.
