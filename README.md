# CFlow

A self-hosted, single-user personal finance app: one account, its transactions and categories, and a
dashboard of where the money went. It started as a TypeScript port of the
[BFlow Financial Engine](https://github.com/DiazzzDev/BFlow-Financial-Engine) (Spring Boot).

Demo: https://cflow-demo.esauflores.com

| Dashboard                                          | New transaction                                          |
| -------------------------------------------------- | -------------------------------------------------------- |
| ![Dashboard](docs/screenshots/dashboard.png)       | ![New transaction](docs/screenshots/new-transaction.png) |
| **Transactions**                                   | **Settings**                                             |
| ![Transactions](docs/screenshots/transactions.png) | ![Settings](docs/screenshots/settings.png)               |

## Run it

With Docker:

```sh
docker compose up -d          # http://localhost:8080
```

The database lives in the `cflow-data` volume at `/data`. To back it up, copy the whole folder: the
database runs in WAL mode, so recent writes can sit in `cflow.db-wal`.

```sh
docker compose stop && docker compose cp cflow:/data ./cflow-backup && docker compose start
```

For development ([mise](https://mise.jdx.dev) installs Bun):

```sh
cp .env.example .env
mise install
bun install
mise run dev                  # web app and API together on http://localhost:5173
```

## Configuration

Environment variables, read from `.env` in development and from `compose.yaml` in Docker:

| Variable           | Default         | Meaning                                                                           |
| ------------------ | --------------- | --------------------------------------------------------------------------------- |
| `PORT`             | `5173`          | Port for the web app and the API together (the Docker image uses `8080`)          |
| `DATABASE_PATH`    | `data/cflow.db` | SQLite file (the Docker image uses `/data/cflow.db`)                              |
| `APP_TIMEZONE`     | `UTC`           | Zone that defines "today" for transaction dates                                   |
| `SESSION_TTL_DAYS` | `30`            | How long a login lasts                                                            |
| `ALLOW_GUEST`      | `false`         | Offer a read-only "Enter as guest" session on the login screen                    |
| `TRUST_PROXY`      | `false`         | Set behind a reverse proxy, so login limits apply per client, not per proxy       |
| `CFLOW_PLUGINS`    | (none)          | Plugin packages or paths to load, comma-separated; see [plugins](docs/plugins.md) |

## Development

| Command          | Does                                                       |
| ---------------- | ---------------------------------------------------------- |
| `mise run dev`   | Web app and API in one process, reloading on changes       |
| `mise run check` | Format, lint and type-check (`check-fix` fixes formatting) |
| `mise run knip`  | Unused files, exports and dependencies                     |
| `mise run test`  | API tests, and web tests in headless Chromium              |
| `mise run build` | Web app into `web/dist`, server into `dist/server.mjs`     |
| `mise run start` | Build, then serve both on one port as in production        |

CI runs check, knip, test and build on every push to `main` and every pull request.

## Stack

Bun · Hono · libSQL (SQLite, plain SQL, no ORM) · zod · React 19 with react-router, TanStack Query,
Tailwind, shadcn/ui, Motion and anime.js · Vite+ for the dev server, build, formatting, linting and
tests.

## Docs

- [Architecture](docs/architecture.md): the folder layout, the kernel and its plugins, and the rules
  that keep them apart
- [Plugins](docs/plugins.md): adding features without changing CFlow
- [API](docs/api.md): authentication, the response format and the routes
- [Port notes](docs/port-notes.md): what changed from the Java version, and what isn't ported
- [Animations](web/ANIMATIONS.md): how the web app animates, and the rules that keep it smooth
