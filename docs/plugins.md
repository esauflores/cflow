# Modules

CFlow is a kernel plus feature modules. Each module is a folder in `apps/api/src/modules/`, built into the server, and
`CFLOW_PLUGINS` chooses which ones run:

```sh
CFLOW_PLUGINS=core,i18n           # by name; "core" is required, and the default
```

Startup fails if `core` is missing, a name isn't a module, or a name is listed twice.

| Module | What it adds                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------- |
| `core` | Transactions, balance, categories and the dashboard summary; always on                               |
| `i18n` | Spanish: the app follows the browser's language, and Settings → Preferences can pick one (see below) |

## Adding a module

1. Create `apps/api/src/modules/<name>/` with its tables (`<name>.table.ts`), schemas, service and routes.
2. Mount its router in `apps/api/src/app.ts`: public routes before the session middleware, protected routes after it.
3. Add its name to `AVAILABLE_PLUGINS` in `apps/api/src/core/config.ts` and to the `CFLOW_PLUGINS` check.
4. Run `bun run db:generate` if it has tables.
5. Enable it with `CFLOW_PLUGINS=core,<name>`.

A module owns its tables. Keep its routes under a prefix (`/plugins/<name>` for a plugin-style add-on) and read core
data through the ledger services so validation and the response shapes stay consistent. The ledger services
(`transactions.service.ts`, `categories.service.ts`) are the place to add a reaction to a ledger change, called from
the transaction write functions.

The web app learns which modules are on from `GET /api/auth/status`, whose `plugins` array lists them, and can show an
option only when its module is enabled.

## i18n

The web app is written in English and passes its text through `t()` (`apps/web/src/lib/i18n.ts`). The i18n module
serves the translations, English text → translation (`apps/api/src/modules/i18n/es.ts`):

```
GET /api/plugins/i18n        → { languages: ["en", "es"] }
GET /api/plugins/i18n/es     → { language: "es", messages: { "Dashboard": "Inicio", … } }
```

Both routes are public: the login screen needs them before there is a session. Which language to use is each
browser's choice: `localStorage` remembers the pick from Settings, and the browser's own language decides until then.
The current language and its messages are cached in the browser too, so a reload doesn't flash English.

When adding UI text, write it in English inside `t("…")`, add the Spanish entry to `es.ts`, and keep `{name}`
placeholders as they are. API messages use the same mechanism: `errors.ts` sends `template` and `params`, and the web
client translates and fills them. Values inside messages (a category's name, `expense`) are translated too.
