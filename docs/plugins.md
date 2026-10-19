# Plugins

Plugins add features without changing the rest of CFlow: their own routes, tables, and reactions to
changes in the ledger. Each one is a folder in `api/src/plugins/`, built into the server, and
`CFLOW_PLUGINS` chooses which ones run:

```sh
CFLOW_PLUGINS=core,receipts          # by name; "core" is required, and the default
CFLOW_PLUGIN_RECEIPTS_API_KEY=…      # settings for "receipts"
```

Startup fails if `core` is missing, a name isn't a plugin, or a name is listed twice.

## Writing one

1. Create `api/src/plugins/<name>/index.ts` exporting the plugin.
2. Add it to the list in `api/src/plugins/index.ts`: `receipts: () => receiptsPlugin`.
3. Enable it: `CFLOW_PLUGINS=core,receipts`.

The plugin follows the [SDK lifecycle](https://github.com/esauflores/plugin-sdk#lifecycle)
(setup → start → stop):

```ts
import { Hono } from "hono";
import { z } from "zod";

import { definePlugin } from "@api/plugins/api.ts";

export const receiptsPlugin = definePlugin({
  name: "receipts", // a-z, 0-9, _; must match its key in plugins/index.ts
  dependsOn: ["core"], // required to use("ledger")
  optionsSchema: z.object({ API_KEY: z.string() }), // checks its CFLOW_PLUGIN_RECEIPTS_* settings
  async setup(ctx) {
    await ctx.use("db").execute("CREATE TABLE IF NOT EXISTS receipts_files (id TEXT PRIMARY KEY, path TEXT NOT NULL)");
    ctx.use("routes").mount(`/plugins/${ctx.name}`, new Hono().get("/", …)); // behind auth
    ctx.hooks.on("transaction.created", (transaction) => {});
  },
  start(ctx) {
    const timer = setInterval(() => {}, 300_000); // periodic work is the plugin's own
    ctx.onDispose(() => clearInterval(timer));
  },
});
```

## Services

| Service  | Purpose                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ledger` | Transactions, balance and categories, with the REST API's validation (list `core` in `dependsOn`)                          |
| `db`     | The `@libsql/client` `Client`: plain SQL, so use any query library (or none) on top. Own tables must be prefixed `<name>_` |
| `routes` | `mount(path, hono)` under `/api`; plugins use `/plugins/<name>`                                                            |
| `clock`  | The app clock: use it instead of `new Date()`                                                                              |

`ctx.options`, `ctx.log`, `ctx.hooks`, `ctx.signal` and `ctx.onDispose` come from the SDK.

## Rules

- **Imports**: a plugin imports only `@api/plugins/api.ts` (the contract) and other plugins' `index.ts`;
  `api/tests/architecture.test.ts` checks the second part.
- **Settings**: `CFLOW_PLUGIN_<NAME>_<KEY>` becomes `ctx.options.<KEY>`.
- **Tables**: a plugin creates and evolves its own tables, prefixed `<name>_`, however it likes (e.g.
  `CREATE TABLE IF NOT EXISTS` in `setup`). They may reference core tables by foreign key. Write core
  data through the `ledger` service, so it is validated and raises hooks.
- **Hooks** (`transaction.created`, `.updated`, `.deleted`) fire after the change is committed, whether
  it came from the API or another plugin. A failing handler is logged and skipped; it cannot undo or
  block the change. Hooks are awaited, so do slow work outside the handler.
- **Startup checks**: an invalid name, a missing dependency, invalid options or a failing
  `setup`/`start` stops the server.
