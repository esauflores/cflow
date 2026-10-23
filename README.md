# CFlow

A self-hosted, single-user personal finance app: one account, its transactions and categories, and a dashboard of where
the money went. It started as a TypeScript port of the [BFlow Financial Engine](https://github.com/DiazzzDev/BFlow-Financial-Engine)
(Spring Boot).

Demo: https://cflow-demo.esauflores.com

| Dashboard                                          | New transaction                                          |
| -------------------------------------------------- | -------------------------------------------------------- |
| ![Dashboard](docs/screenshots/dashboard.png)       | ![New transaction](docs/screenshots/new-transaction.png) |
| **Transactions**                                   | **Settings**                                             |
| ![Transactions](docs/screenshots/transactions.png) | ![Settings](docs/screenshots/settings.png)               |

## Stack

CFlow is built on the `bun-fullstack-base` template: one Bun process, a Hono API and a React page, typed end to end.

| Part    | What                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Server  | [Bun](https://bun.com) 1.4: `Bun.serve` runs the API and serves the web app, which Bun bundles        |
| API     | [Hono](https://hono.dev) with [Zod OpenAPI](https://hono.dev/examples/zod-openapi), by feature module |
| DB      | SQLite, the copy inside Bun (`bun:sqlite`), in the process, through Drizzle                           |
| Web     | React 19, React Router, TanStack Query, Tailwind CSS 4, shadcn/ui, Motion and anime.js                |
| Tooling | [Vite+](https://viteplus.dev) (`vp`): format, lint, type-check, and tests (web in headless Chromium)  |

## Run it

With Docker:

```sh
docker compose up -d          # http://localhost:8080
```

The database lives in the `cflow-data` volume at `/data/cflow.db`. To back it up, copy the whole folder: the database
runs in WAL mode, so recent writes can sit in `cflow.db-wal`.

```sh
docker compose stop && docker compose cp cflow:/data ./cflow-backup && docker compose start
```

For development ([mise](https://mise.jdx.dev) installs Bun):

```sh
cp .env.example .env
mise install
bun install
bunx playwright install chromium   # once, for the web tests
bun run dev                        # http://localhost:3000 (PORT in .env)
```

| Script                | What it does                                                                            |
| --------------------- | --------------------------------------------------------------------------------------- |
| `bun run dev`         | Serve with hot reload: the page on web changes, the API on api changes                  |
| `bun run build`       | Bundle the server, the API and the page, minified, into `server/dist/`                  |
| `bun run start`       | Serve that build in production mode (run `build` first)                                 |
| `bun run check`       | Format check, lint and type-check everything (`check:fix` fixes what it can)            |
| `bun run test`        | API, web (headless Chromium) and production build tests (`test:watch` reruns on change) |
| `bun run db:generate` | Write a migration for the tables changed since the last one (the server applies it)     |

Run every script from the root. `.env` lives at the root too; `dev` and `start` load it. A variable already set in your
shell wins over `.env`. `dev` runs from `server/`, so `DATABASE_PATH=../data/cflow.db` is `data/cflow.db` at the repo
root; `start` runs from `server/dist/`, so the same value points at `server/data/cflow.db`. The Docker image sets an
absolute path.

## Configuration

Environment variables, read from `.env` in development and from `compose.yaml` in Docker:

| Variable           | Default          | Meaning                                                                     |
| ------------------ | ---------------- | --------------------------------------------------------------------------- |
| `PORT`             | `3000`           | Port for the web app and the API together (the Docker image uses `3000`)    |
| `DATABASE_PATH`    | `/data/cflow.db` | SQLite file (dev: `../data/cflow.db`; Docker: `/data/cflow.db`)             |
| `APP_TIMEZONE`     | `UTC`            | Zone that defines "today" for transaction dates                             |
| `SESSION_TTL_DAYS` | `30`             | How long a login lasts                                                      |
| `DEMO_MODE`        | `false`          | Serve `/demo` and the read-only "Enter as guest" session at login           |
| `TRUST_PROXY`      | `false`          | Set behind a reverse proxy, so login limits apply per client, not per proxy |
| `RATE_LIMIT`       | `300`            | Requests a minute per client at the API's edge; `0` turns it off            |
| `MAX_BODY_BYTES`   | `1048576`        | Largest request body the API reads                                          |
| `CFLOW_PLUGINS`    | `core`           | Modules to enable, comma-separated; `core` is required, `i18n` adds Spanish |

## How it fits together

```
                        ┌─ /api, /api/*     →  apps/api   createApp(): Hono, base path /api
browser ── :3000 ── server
                        └─ everything else  →  apps/web   index.html, bundled by Bun; React Router picks the page
```

- **One origin.** The page and the API share a port, so no CORS, no proxy, and nothing to configure between them.
- **Bun bundles the web app.** There's no Vite dev server. In dev, Bun bundles the page as it's requested, rebundles on
  change and hot-reloads it (React Fast Refresh). For production, `bun run build` bundles the server with everything it
  imports, the API and the page included, into `server/dist/`: the page becomes hashed JS and CSS files, gzipped, that
  the built server loads into memory at start, so a broken import fails the build, not a request. Tailwind runs as Bun's
  bundler plugin.
- **Typed end to end.** A route declares its input and its responses with Zod. Invalid input answers `400` with CFlow's
  error envelope before the handler runs. The routes appear in `/api/openapi.json`. The web app's client keeps CFlow's
  `{ success, data }` envelope and turns errors into an `ApiError` whose message can go straight on the screen.
- **One error shape.** Every failure is `{ success: false, message, code, timestamp, path }`, plus `errors` for
  validation failures. `message` is English; when it holds values it also carries `template` and `params`, which the
  i18n module translates.
- **One database.** Drizzle declares each module's tables in `<module>.table.ts`; migrations in `apps/api/drizzle/` are
  applied when the server starts. Amounts are signed integer cents; dates are `YYYY-MM-DD`.

## Layout

```
server/           Bun.serve (/api to the API, the rest to the web app), build.ts
apps/
├── api/          the Hono API: core/ (database, errors, OpenAPI router, money, dates), modules/, drizzle/
└── web/          the React app: lib/api.ts (the client), pages/, components/
data/             the SQLite file in development
docs/             architecture, modules, the API, port notes
```

## Docs

- [Architecture](docs/architecture.md): the workspaces, the server, the kernel and its modules
- [Modules](docs/plugins.md): adding features without changing CFlow
- [API](docs/api.md): authentication, the response format and the routes
- [Port notes](docs/port-notes.md): what changed from the Java version, and what isn't ported
- [Animations](apps/web/ANIMATIONS.md): how the web app animates, and the rules that keep it smooth

CI runs check, test and build on every push to `main` and every pull request.
