import { describe, expect, it } from "vitest";

import { categoryId, setup, txBody } from "../support/helpers.ts";

describe("categories", () => {
  it("starts a new database with the default categories", async () => {
    const h = await setup();
    const all = await h.data<{ name: string; type: string }[]>("GET", "/api/categories");
    expect(all.filter((c) => c.type === "EXPENSE").map((c) => c.name)).toEqual([
      "Bills",
      "Food",
      "Fun",
      "Health",
      "Housing",
      "Other",
      "Shopping",
      "Transport",
    ]);
    expect(all.filter((c) => c.type === "INCOME").map((c) => c.name)).toEqual([
      "Freelance",
      "Investment",
      "Other",
      "Salary",
    ]);
  });

  it("counts how many transactions use each category", async () => {
    const h = await setup();
    const food = await categoryId(h, "Food", "EXPENSE");
    await h.data("POST", "/api/transactions", txBody(food));
    await h.data("POST", "/api/transactions", txBody(food));
    const all = await h.data<{ id: string; usage: number }[]>("GET", "/api/categories");
    expect(all.find((c) => c.id === food)?.usage).toBe(2);
    expect(all.filter((c) => c.id !== food).every((c) => c.usage === 0)).toBe(true);
  });

  it("creates typed categories only", async () => {
    const h = await setup();
    expect((await h.request("POST", "/api/categories", { name: "Pets" })).status).toBe(400);
    expect((await h.request("POST", "/api/categories", { name: "Pets", type: "TRANSFER" })).status).toBe(400);
    const pets = await h.data("POST", "/api/categories", { name: "Pets", type: "EXPENSE" });
    expect(pets).toEqual({
      id: pets.id,
      name: "Pets",
      type: "EXPENSE",
      color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
      usage: 0,
    });
  });

  it("keeps names unique per type, ignoring case", async () => {
    const h = await setup();
    expect((await h.request("POST", "/api/categories", { name: "food", type: "EXPENSE" })).status).toBe(409);
    // The same name is fine for the other type.
    expect((await h.request("POST", "/api/categories", { name: "Food", type: "INCOME" })).status).toBe(201);
  });

  it("renames, but not into a taken name and never Other", async () => {
    const h = await setup();
    const fun = await categoryId(h, "Fun", "EXPENSE");
    const other = await categoryId(h, "Other", "EXPENSE");
    expect(await h.data("PATCH", `/api/categories/${fun}`, { name: "Leisure" })).toMatchObject({ name: "Leisure" });
    expect((await h.request("PATCH", `/api/categories/${fun}`, { name: "FOOD" })).status).toBe(409);
    expect((await h.request("PATCH", `/api/categories/${fun}`, { name: " " })).status).toBe(400);
    expect((await h.request("PATCH", `/api/categories/${other}`, { name: "Misc" })).status).toBe(400);
  });

  it("deletes by moving its transactions to Other", async () => {
    const h = await setup();
    const food = await categoryId(h, "Food", "EXPENSE");
    const other = await categoryId(h, "Other", "EXPENSE");
    const tx = await h.data("POST", "/api/transactions", txBody(food));
    await h.data("POST", "/api/transactions", txBody(food));

    expect(await h.data("DELETE", `/api/categories/${food}`)).toEqual({ moved: 2 });
    expect((await h.data("GET", `/api/transactions/${tx.id}`)).category).toMatchObject({ id: other, name: "Other" });
    const all = await h.data<{ id: string; usage: number }[]>("GET", "/api/categories");
    expect(all.some((c) => c.id === food)).toBe(false);
    expect(all.find((c) => c.id === other)?.usage).toBe(2);
    expect((await h.request("DELETE", `/api/categories/${food}`)).status).toBe(404);
    expect((await h.request("DELETE", `/api/categories/${other}`)).status).toBe(400);
  });
});
