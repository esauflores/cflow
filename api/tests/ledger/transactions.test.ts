import { describe, expect, it } from "vitest";

import { balanceOf, categoryId, setup, txBody } from "../support/helpers.ts";

describe("transactions", () => {
  it("records signed amounts and keeps the balance as their sum", async () => {
    const h = await setup();
    const food = await categoryId(h, "Food", "EXPENSE");
    const salary = await categoryId(h, "Salary", "INCOME");
    const otherIncome = await categoryId(h, "Other", "INCOME");
    expect(await balanceOf(h)).toBe(0);

    const opening = await h.data(
      "POST",
      "/api/transactions",
      txBody(otherIncome, { title: "Starting balance", amount: 100 }),
    );
    expect(opening).toMatchObject({
      amount: 100,
      type: "INCOME",
      category: { name: "Other", type: "INCOME" },
      currency: "USD",
    });

    const spent = await h.data("POST", "/api/transactions", txBody(food, { amount: "-30.50" }));
    expect(spent).toMatchObject({ amount: -30.5, type: "EXPENSE", category: { name: "Food" } });
    await h.data("POST", "/api/transactions", txBody(salary, { title: "Pay", amount: 1000 }));
    expect(await balanceOf(h)).toBe(1069.5);

    const edited = await h.data("PUT", `/api/transactions/${spent.id}`, txBody(food, { amount: -45 }));
    expect(edited.amount).toBe(-45);
    expect(await balanceOf(h)).toBe(1055);

    expect((await h.request("DELETE", `/api/transactions/${spent.id}`)).status).toBe(204);
    expect(await balanceOf(h)).toBe(1100);
    expect((await h.request("GET", `/api/transactions/${spent.id}`)).status).toBe(404);
  });

  it("allows a negative balance", async () => {
    const h = await setup();
    await h.data("POST", "/api/transactions", txBody(await categoryId(h, "Food", "EXPENSE"), { amount: -20 }));
    expect(await balanceOf(h)).toBe(-20);
  });

  it("checks amounts, category direction, future dates and missing references", async () => {
    const h = await setup();
    const salary = await categoryId(h, "Salary", "INCOME");
    const food = await categoryId(h, "Food", "EXPENSE");
    const post = (body: unknown) => h.request("POST", "/api/transactions", body);

    expect((await post(txBody(food, { amount: 0 }))).status).toBe(400);
    expect((await post(txBody(food, { amount: "-1.234" }))).status).toBe(400);
    // At most eight digits before the point.
    expect((await post(txBody(food, { amount: -100_000_000 }))).status).toBe(400);
    expect((await post(txBody(food, { amount: "-99999999.99" }))).status).toBe(201);
    expect((await post(txBody(salary, { amount: -10 }))).status).toBe(400);
    expect((await post(txBody(food, { amount: 10 }))).status).toBe(400);
    expect((await post(txBody(food, { date: "2026-03-16" }))).status).toBe(400);
    expect((await post(txBody(food, { currency: "EUR" }))).status).toBe(400);
    expect((await post(txBody("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    // Every transaction needs a category.
    expect((await post({ ...txBody(food), categoryId: null })).status).toBe(400);
    expect((await post({ ...txBody(food), categoryId: undefined })).status).toBe(400);
  });

  it("lists, filters, searches and pages", async () => {
    const h = await setup();
    const food = await categoryId(h, "Food", "EXPENSE");
    const shopping = await categoryId(h, "Shopping", "EXPENSE");
    const salary = await categoryId(h, "Salary", "INCOME");
    const add = (body: unknown) => h.data("POST", "/api/transactions", body);
    await add(txBody(food, { title: "Tacos", amount: -30, date: "2026-03-02" }));
    await add(txBody(shopping, { title: "Bus", amount: -10, date: "2026-03-10" }));
    await add(txBody(food, { title: "Old", amount: -50, date: "2026-02-10" }));
    await add(txBody(salary, { title: "Pay", amount: 200, date: "2026-03-05" }));

    const titles = (page: { content: { title: string }[] }) => page.content.map((t) => t.title);
    expect(titles(await h.data("GET", "/api/transactions?sort=date,asc"))).toEqual(["Old", "Tacos", "Pay", "Bus"]);
    expect(titles(await h.data("GET", "/api/transactions?type=INCOME"))).toEqual(["Pay"]);
    expect(titles(await h.data("GET", `/api/transactions?categoryId=${food}&sort=date,asc`))).toEqual(["Old", "Tacos"]);
    expect(titles(await h.data("GET", "/api/transactions?query=TAC"))).toEqual(["Tacos"]);
    // Search also matches the category name and, for numbers, the amount (sign and "$" ignored).
    const search = async (q: string) =>
      titles(await h.data("GET", `/api/transactions?sort=date,asc&query=${encodeURIComponent(q)}`));
    expect(await search("food")).toEqual(["Old", "Tacos"]);
    expect(await search("SHOP")).toEqual(["Bus"]);
    expect(await search("$30")).toEqual(["Tacos"]);
    expect(await search("-50.00")).toEqual(["Old"]);
    expect(await search("200.")).toEqual(["Pay"]);
    expect(await search("nothing like this")).toEqual([]);

    const paged = await h.data("GET", "/api/transactions?size=2&page=1&sort=amount,desc");
    expect(paged.page).toEqual({ size: 2, number: 1, totalElements: 4, totalPages: 2 });
    expect(paged.content.map((t: { amount: number }) => t.amount)).toEqual([-30, -50]);
  });

  it("searches for % and _ literally, not as wildcards", async () => {
    const h = await setup();
    const shopping = await categoryId(h, "Shopping", "EXPENSE");
    await h.data("POST", "/api/transactions", txBody(shopping, { title: "50% off" }));
    await h.data("POST", "/api/transactions", txBody(shopping, { title: "500 apples" }));
    const search = async (q: string) =>
      (await h.data("GET", `/api/transactions?query=${encodeURIComponent(q)}`)).content.map(
        (t: { title: string }) => t.title,
      );
    expect(await search("50%")).toEqual(["50% off"]);
    expect(await search("_")).toEqual([]);
  });

  it("summarises a month: closing balance, totals, its year and spending by category", async () => {
    const h = await setup();
    const salary = await categoryId(h, "Salary", "INCOME");
    const food = await categoryId(h, "Food", "EXPENSE");
    const bills = await categoryId(h, "Bills", "EXPENSE");
    const add = (amount: number, date: string, category = amount > 0 ? salary : food) =>
      h.data("POST", "/api/transactions", txBody(category, { amount, date }));
    await add(1000, "2026-03-01");
    await add(-30, "2026-03-02");
    await add(-20.5, "2026-03-10", bills);
    await add(-49.5, "2026-03-11", bills);
    await add(500, "2026-02-01");
    await add(-100, "2026-02-15");
    await add(-5, "2025-12-31");

    // Defaults to the clock's month, March 2026.
    const march = await h.data("GET", "/api/summary");
    expect(march).toMatchObject({
      month: "2026-03",
      balance: 1295,
      current: { month: "2026-03", income: 1000, spending: 100 },
      previous: { month: "2026-02", income: 500, spending: 100 },
      categories: [
        { id: bills, name: "Bills", amount: 70, share: 70 },
        { id: food, name: "Food", amount: 30, share: 30 },
      ],
    });
    expect(march.months).toHaveLength(12);
    expect(march.months[0]).toEqual({ month: "2026-01", income: 0, spending: 0 });
    expect(march.months[2]).toEqual({ month: "2026-03", income: 1000, spending: 100 });

    // A past month: the balance as it closed, and the previous month across the year boundary.
    const january = await h.data("GET", "/api/summary?month=2026-01");
    expect(january).toMatchObject({
      balance: -5,
      current: { month: "2026-01", income: 0, spending: 0 },
      previous: { month: "2025-12", income: 0, spending: 5 },
      categories: [],
    });
    expect((await h.data("GET", "/api/summary?month=2025-12")).months[11]).toEqual({
      month: "2025-12",
      income: 0,
      spending: 5,
    });
    expect((await h.request("GET", "/api/summary?month=2026-13")).status).toBe(400);
  });
});
