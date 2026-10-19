import { Hono } from "hono";
import { z } from "zod";

import type { CflowPlugin } from "@api/plugins/api.ts";

// A small plugin used by the tests; it exercises every part of the contract.
// It only imports CFlow's types and talks to the database in plain SQL, as a
// plugin in api/src/plugins would.

const optionsSchema = z.object({ GREETING: z.string().default("hello") });

const plugin: CflowPlugin<z.output<typeof optionsSchema>, z.input<typeof optionsSchema>> = {
  name: "notes",
  version: "1.0.0",
  dependsOn: ["core"],
  optionsSchema,
  async setup(ctx) {
    const db = ctx.use("db");
    const ledger = ctx.use("ledger");
    await db.execute(
      "CREATE TABLE IF NOT EXISTS notes_items (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, text TEXT NOT NULL)",
    );
    const note = (kind: string, text: string) =>
      db.execute({ sql: "INSERT INTO notes_items (kind, text) VALUES (?, ?)", args: [kind, text] });

    ctx.use("routes").mount(
      `/plugins/${ctx.name}`,
      new Hono()
        .get("/", async (c) => c.json((await db.execute("SELECT id, kind, text FROM notes_items ORDER BY id")).rows))
        .get("/options", (c) => c.json(ctx.options))
        .get("/balance", async (c) => c.json(await ledger.balance()))
        .post("/transaction", async (c) => c.json(await ledger.transactions.create(await c.req.json()), 201)),
    );

    ctx.hooks.on("transaction.created", (t) => note("transaction.created", `${t.title} ${t.amount}`));
    ctx.hooks.on("transaction.deleted", (t) => note("transaction.deleted", t.title));
  },
};

export default plugin;
