import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { definePlugin } from "@api/plugins/api.ts";

import { balanceOf, categoryId, setup, txBody } from "../support/helpers.ts";
import notesPlugin from "./fixtures/notes/index.ts";

const NOTES_PATH = join(import.meta.dirname, "fixtures", "notes");

type Note = { kind: string; text: string };
const notesOf = async (h: Awaited<ReturnType<typeof setup>>) =>
  (await (await h.request("GET", "/api/plugins/notes")).json()) as Note[];

/** A plugin package in a temp folder, for loader tests. */
function packageDir(manifest: Record<string, unknown>, source = "export default { name: 'tmp_plugin', setup() {} };") {
  const dir = mkdtempSync(join(tmpdir(), "cflow-plugin-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "tmp", type: "module", cflow: manifest }));
  writeFileSync(join(dir, "index.js"), source);
  return dir;
}

describe("plugins", () => {
  it("loads a plugin package that creates its tables and mounts its routes behind auth", async () => {
    const h = await setup({ load: [NOTES_PATH] });
    expect(h.host.get("notes")).toMatchObject({ state: "started", source: NOTES_PATH });

    const tables = await h.db.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
    expect(tables.rows.map((t) => t.name)).toContain("notes_items");

    expect((await h.request("GET", "/api/plugins/notes")).status).toBe(200);
    h.token = "";
    expect((await h.request("GET", "/api/plugins/notes")).status).toBe(401);
  });

  it("delivers hooks after core changes, and isolates failing handlers", async () => {
    const broken = definePlugin({
      name: "broken",
      setup(ctx) {
        ctx.hooks.on("transaction.created", () => {
          throw new Error("boom");
        });
      },
    });
    const h = await setup({ plugins: [broken, notesPlugin] });
    const food = await categoryId(h, "Food", "EXPENSE");

    const created = await h.request("POST", "/api/transactions", txBody(food, { title: "Tacos", amount: -12 }));
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };
    await h.request("DELETE", `/api/transactions/${data.id}`);

    expect(await notesOf(h)).toEqual([
      { id: 1, kind: "transaction.created", text: "Tacos -12" },
      { id: 2, kind: "transaction.deleted", text: "Tacos" },
    ]);
  });

  it("gives plugins core operations with the REST API's validation", async () => {
    const h = await setup({ plugins: [notesPlugin] });
    const food = await categoryId(h, "Food", "EXPENSE");

    const res = await h.request("POST", "/api/plugins/notes/transaction", txBody(food, { amount: -30 }));
    expect(res.status).toBe(201);
    expect(await balanceOf(h)).toBe(-30);
    // Writes through the ledger service raise hooks like REST writes do.
    expect((await notesOf(h)).map((n) => n.kind)).toEqual(["transaction.created"]);

    const invalid = await h.request("POST", "/api/plugins/notes/transaction", txBody(food, { amount: "1.234" }));
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { code: string }).code).toBe("VALIDATION_ERROR");

    const balance = (await (await h.request("GET", "/api/plugins/notes/balance")).json()) as { balance: number };
    expect(balance.balance).toBe(-30);
  });

  it("passes namespaced settings as validated options", async () => {
    const h = await setup({
      load: [NOTES_PATH],
      env: { CFLOW_PLUGIN_NOTES_GREETING: "hola", CFLOW_PLUGIN_OTHER_SECRET: "nope" },
    });
    expect(await (await h.request("GET", "/api/plugins/notes/options")).json()).toEqual({ GREETING: "hola" });
  });

  it("rejects invalid plugins at startup", async () => {
    const valid = definePlugin({ name: "valid_one", setup() {} });

    await expect(setup({ load: [packageDir({ apiVersion: 99, entry: "./index.js" })] })).rejects.toThrow(
      /plugin API v99/,
    );
    await expect(setup({ plugins: [{ ...valid, name: "Bad-Name" }] })).rejects.toThrow(/Invalid plugin name/);
    await expect(setup({ plugins: [{ ...valid, name: "ledger" }] })).rejects.toThrow(/already registered/);
    await expect(setup({ plugins: [valid, valid] })).rejects.toThrow(/already registered/);
    await expect(setup({ plugins: [{ ...valid, dependsOn: ["missing"] }] })).rejects.toThrow(/missing dependency/);
    await expect(
      setup({ plugins: [definePlugin({ name: "greedy", setup: (ctx) => void ctx.use("ledger") })] }),
    ).rejects.toThrow(/without listing "ledger" in dependsOn/);
  });
});
