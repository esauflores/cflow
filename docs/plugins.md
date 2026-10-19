# Plugins

Plugins add features without changing CFlow: their own routes, tables, and reactions to changes in the
ledger. They are trusted code that runs inside the server, so install only plugins you trust.

```sh
CFLOW_PLUGINS=@someone/cflow-plugin-receipts,./plugins/my-import   # packages or paths
CFLOW_PLUGIN_RECEIPTS_API_KEY=…                                    # settings for "receipts"
```

## Writing one

A plugin is a package whose `package.json` declares the CFlow major version it targets and its entry
(JavaScript, or TypeScript, which Bun runs directly):

```json
{
  "name": "cflow-plugin-receipts",
  "type": "module",
  "cflow": { "apiVersion": 0, "entry": "./dist/index.js" }
}
```

The entry's default export is the plugin
([SDK lifecycle](https://github.com/esauflores/plugin-sdk#lifecycle): setup → start → stop):

```ts
import type { CflowPlugin } from "…/api/src/plugins/api.ts"; // types only; not published as a package yet

const plugin: CflowPlugin<{ API_KEY: string }> = {
  name: "receipts", // a-z, 0-9, _; namespaces routes, tables and settings
  dependsOn: ["ledger"], // required to use("ledger")
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
};
export default plugin;
```

## Services

| Service  | Purpose                                                                                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ledger` | Transactions, balance and categories, with the REST API's validation (list it in `dependsOn`)                              |
| `db`     | The `@libsql/client` `Client`: plain SQL, so use any query library (or none) on top. Own tables must be prefixed `<name>_` |
| `routes` | `mount(path, hono)` under `/api`; plugins use `/plugins/<name>`                                                            |
| `clock`  | The app clock: use it instead of `new Date()`                                                                              |

`ctx.options`, `ctx.log`, `ctx.hooks`, `ctx.signal` and `ctx.onDispose` come from the SDK.

## Rules

- **Settings**: `CFLOW_PLUGIN_<NAME>_<KEY>` becomes `ctx.options.<KEY>`, where `<NAME>` is the
  specifier's last segment without `cflow-plugin-`.
- **Tables**: a plugin creates and evolves its own tables, prefixed `<name>_`, however it likes (e.g.
  `CREATE TABLE IF NOT EXISTS` in `setup`). They may reference core tables by foreign key. Write core
  data through the `ledger` service, so it is validated and raises hooks.
- **Hooks** (`transaction.created`, `.updated`, `.deleted`) fire after the change is committed, whether
  it came from the API or another plugin. A failing handler is logged and skipped; it cannot undo or
  block the change. Hooks are awaited, so do slow work outside the handler.
- **Startup checks**: an invalid or duplicate name (built-in names included), a different
  `apiVersion`, invalid options, a missing dependency or a failing `setup`/`start` stops the server.
- **Stability**: `api/src/plugins/api.ts` and the `ledger` facade are the contract. Anything else in
  the API is internal.
