# Architecture

The repo is one package: a single `package.json`, `node_modules` and `vite.config.ts` at the root.
`api/` and `web/` are source folders, each with its own `tsconfig.json` (server types vs. DOM and
JSX). Imports use `@api/` (`api/src`) and `@web/` (`web/src`).

```
package.json              dependencies and scripts: check, knip, test, dev, build, start
vite.config.ts            format and lint rules, aliases, dev server, build, api and web test projects
api/
  src/
    core/                 the kernel: config and clock (deps.ts), database (db.ts), HTTP envelope and
                          errors (http.ts), route registry (kernel.ts), auth/, money and date helpers
    plugins/              the plugin contract (api.ts), name and settings checks (loader.ts), and
                          ledger/, the core plugin
    app.ts                composition root: plugin host, plugins, Hono app
    node.ts               production entry: database, server, graceful shutdown
    dev.ts                development entry, loaded by the dev server
  tests/                  core/, ledger/, plugins/ (fixtures/notes exercises the whole plugin
                          contract), support/ (in-memory database, test clock, logged-in client),
                          architecture.test.ts
web/
  src/
    main.tsx              query client, routes, auth gate
    lib/                  api.ts (client, types, session), utils.ts (formatting, theme)
    components/           ui/ (shadcn), Charts.tsx (plain SVG and Motion), Shell, TransactionDialog,
                          DatePicker, Logo, Money
    pages/                Login, Dashboard, Transactions, Settings
  tests/                  API client, auth gate, transactions page
```

## One process, one port

In development, `mise run dev` runs Vite with `@hono/vite-dev-server`: `/api` goes to the Hono app in
`api/src/dev.ts` and Vite serves the rest, so the browser talks to one origin and needs no CORS.
Editing an API file reloads the API.

In production, `bun run build` builds the web app into `web/dist/` and bundles the server from
`api/src/node.ts` into `dist/server.mjs`, with dependencies left external. `bun dist/server.mjs` then
serves `/api` and `/health` from the API and everything else from `web/dist`, falling back to
`index.html` for client-side routes.

## Kernel and plugins

CFlow is a small kernel plus plugins, on
[`@esauflores/plugin-sdk`](https://github.com/esauflores/plugin-sdk). The kernel owns config, the
database connection, the HTTP envelope and authentication: `app.ts` mounts `/api/auth` and puts every
plugin route behind the session check.

Everything else is a plugin. The ledger is the core plugin, registered before any other: in `setup` it
creates its tables (a new database gets the default categories), mounts its routes, and provides its
facade as the `ledger` service. Installed plugins go through the same host (see
[plugins](plugins.md)).

The ledger is four files: `index.ts` (the plugin and its public exports), `facade.ts` (the `ledger`
service), and `categories.ts` and `transactions.ts`, each holding its queries and routes. Writes go
through `createTransaction`, `updateTransaction` and `deleteTransaction`, which raise a hook after the
commit.

`api/tests/architecture.test.ts` enforces the layering:

1. `core/` never imports from `plugins/`.
2. Plugins (one folder each under `plugins/`) import each other only through `index.ts`.
3. The plugin dependency graph has no cycles.

## Data

There is one account. A transaction's `amount` is signed (negative is money out), its category must
match that direction, and the balance is the sum of every transaction, so it is never stored and may
go negative. Money is stored as integer cents and dates as `YYYY-MM-DD` text.

There are no migrations: on start, auth and every plugin create their tables with
`CREATE TABLE IF NOT EXISTS`. Each table is defined once, as the `CREATE TABLE` statement in the file
that queries it (e.g. `TRANSACTIONS_TABLE` in `ledger/transactions.ts`). The database runs in WAL mode,
so reads don't wait behind a write.
