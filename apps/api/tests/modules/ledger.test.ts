import { describe, expect, it } from "vite-plus/test";

import { call, ownerSession, today } from "../support/helpers.ts";

interface Category {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  color: string;
  usage: number;
}

interface Transaction {
  id: string;
  title: string;
  amount: number;
  type: string;
  date: string;
  category: Category;
}

const categoriesOf = async (app: Awaited<ReturnType<typeof ownerSession>>["app"], token: string) =>
  ((await call(app, token, "GET", "/api/categories")).body as { data: Category[] }).data;

describe("ledger", () => {
  it("starts with the default categories", async () => {
    const { app, token } = await ownerSession();
    const categories = await categoriesOf(app, token);

    expect(categories.filter((c) => c.type === "EXPENSE").map((c) => c.name)).toContain("Food");
    expect(categories.filter((c) => c.type === "INCOME").map((c) => c.name)).toContain("Salary");
    expect(categories.filter((c) => c.name === "Other")).toHaveLength(2);
  });

  it("records a transaction, then lists, balances and summarises it", async () => {
    const { app, token } = await ownerSession();
    const categories = await categoriesOf(app, token);
    const food = categories.find((c) => c.name === "Food" && c.type === "EXPENSE")!;

    const created = await call(app, token, "POST", "/api/transactions", {
      title: "Groceries",
      amount: -12.5,
      date: today(),
      categoryId: food.id,
    });
    expect(created.status).toBe(201);
    const transaction = (created.body as { data: Transaction }).data;
    expect(transaction).toMatchObject({ title: "Groceries", amount: -12.5, type: "EXPENSE" });
    expect(transaction.category.name).toBe("Food");

    const list = await call(app, token, "GET", "/api/transactions?query=grocer");
    const page = (list.body as { data: { content: Transaction[]; page: { totalElements: number } } }).data;
    expect(page.content.map((t) => t.title)).toContain("Groceries");
    expect(page.page.totalElements).toBeGreaterThan(0);

    const byAmount = await call(app, token, "GET", "/api/transactions?query=12.5");
    expect((byAmount.body as { data: { content: Transaction[] } }).data.content[0]!.id).toBe(transaction.id);

    expect(((await call(app, token, "GET", "/api/balance")).body as { data: { balance: number } }).data.balance).toBe(
      -12.5,
    );

    const month = today().slice(0, 7);
    const summary = (await call(app, token, "GET", `/api/summary?month=${month}`)).body as {
      data: { current: { spending: number }; categories: { name: string; amount: number }[] };
    };
    expect(summary.data.current.spending).toBe(12.5);
    expect(summary.data.categories[0]).toMatchObject({ name: "Food", amount: 12.5 });
  });

  it("rejects a future date, a wrong-direction category and an empty title", async () => {
    const { app, token } = await ownerSession();
    const categories = await categoriesOf(app, token);
    const salary = categories.find((c) => c.name === "Salary")!;
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    const badDate = await call(app, token, "POST", "/api/transactions", {
      title: "Tomorrow",
      amount: 10,
      date: future,
      categoryId: salary.id,
    });
    expect(badDate.status).toBe(400);
    expect((badDate.body as { message: string }).message).toBe("Transaction date cannot be in the future");

    const badCategory = await call(app, token, "POST", "/api/transactions", {
      title: "Coffee",
      amount: -3,
      date: today(),
      categoryId: salary.id,
    });
    expect(badCategory.status).toBe(400);
    expect((badCategory.body as { code: string }).code).toBe("BAD_REQUEST");

    const emptyTitle = await call(app, token, "POST", "/api/transactions", {
      title: " ",
      amount: -3,
      date: today(),
      categoryId: categories.find((c) => c.name === "Food")!.id,
    });
    expect(emptyTitle.status).toBe(400);
    expect((emptyTitle.body as { code: string; errors: unknown[] }).code).toBe("VALIDATION_ERROR");
    expect((emptyTitle.body as { errors: unknown[] }).errors.length).toBeGreaterThan(0);
  });

  it("renames a category, conflicts on a duplicate, and moves transactions when deleting", async () => {
    const { app, token } = await ownerSession();
    const categories = await categoriesOf(app, token);
    const fun = categories.find((c) => c.name === "Fun" && c.type === "EXPENSE")!;

    const renamed = await call(app, token, "PATCH", `/api/categories/${fun.id}`, { name: "Leisure" });
    expect(renamed.status).toBe(200);

    const duplicate = await call(app, token, "PATCH", `/api/categories/${fun.id}`, { name: "Food" });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as { code: string }).code).toBe("CONFLICT");

    const created = await call(app, token, "POST", "/api/transactions", {
      title: "Cinema",
      amount: -8,
      date: today(),
      categoryId: fun.id,
    });
    const transactionId = (created.body as { data: Transaction }).data.id;

    const deleted = await call(app, token, "DELETE", `/api/categories/${fun.id}`);
    expect(deleted.status).toBe(200);
    expect((deleted.body as { data: { moved: number } }).data.moved).toBe(1);

    const moved = (await call(app, token, "GET", `/api/transactions/${transactionId}`)).body as {
      data: Transaction;
    };
    expect(moved.data.category.name).toBe("Other");
  });

  it("refuses to rename or delete the fallback category", async () => {
    const { app, token } = await ownerSession();
    const other = (await categoriesOf(app, token)).find((c) => c.name === "Other" && c.type === "EXPENSE")!;

    expect((await call(app, token, "PATCH", `/api/categories/${other.id}`, { name: "Misc" })).status).toBe(400);
    expect((await call(app, token, "DELETE", `/api/categories/${other.id}`)).status).toBe(400);
  });
});
