import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryClient, getToken, setToken, type Transaction } from "@web/lib/api.ts";
import { today } from "@web/lib/utils.ts";
import { Dashboard } from "@web/pages/Dashboard.tsx";
import { AuthGate } from "@web/pages/Login.tsx";
import { Transactions } from "@web/pages/Transactions.tsx";

import { mockApi } from "./fetch.ts";

const renderWithClient = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

const tacos: Transaction = {
  id: "1",
  title: "Tacos",
  amount: -12.5,
  type: "EXPENSE",
  currency: "USD",
  date: "2026-03-14",
  category: { id: "c1", name: "Food", type: "EXPENSE", color: "#ef4444", usage: 3 },
  createdAt: "2026-03-14T12:00:00Z",
};

const pageOf = (content: Transaction[]) => ({
  content,
  page: { size: 50, number: 0, totalElements: content.length, totalPages: 1 },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setToken(null);
});

describe("auth gate", () => {
  it("asks for a new password on a fresh server and enters the app after setup", async () => {
    const calls = mockApi({
      "GET /auth/status": () => ({ body: { bootstrapped: false, allowGuest: false, plugins: ["core"] } }),
      "POST /auth/bootstrap": () => ({ status: 201, body: { token: "new-token", expiresAt: "2026-05-01T00:00:00Z" } }),
    });
    renderWithClient(
      <AuthGate>
        <p>Inside the app</p>
      </AuthGate>,
    );

    await screen.findByText("Set up CFlow");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "correct horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Create server password" }));

    await screen.findByText("Inside the app");
    expect(getToken()).toBe("new-token");
    expect(calls.find((c) => c.key === "POST /auth/bootstrap")?.body).toEqual({ password: "correct horse" });
  });

  it("shows the API's error for a wrong password", async () => {
    mockApi({
      "GET /auth/status": () => ({ body: { bootstrapped: true, allowGuest: false, plugins: ["core"] } }),
      "POST /auth/login": () => ({ status: 401, body: { code: "INVALID_CREDENTIALS", message: "Invalid password" } }),
    });
    renderWithClient(
      <AuthGate>
        <p>Inside the app</p>
      </AuthGate>,
    );

    await screen.findByText("Welcome back");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Invalid password");
    expect(getToken()).toBeNull();
  });
});

describe("transactions page", () => {
  it("lists transactions with signed amounts", async () => {
    mockApi({
      "GET /transactions": () => ({
        body: pageOf([
          tacos,
          {
            ...tacos,
            id: "2",
            title: "Salary",
            amount: 2000,
            type: "INCOME",
            category: { id: "c2", name: "Salary", type: "INCOME", color: "#10b981", usage: 0 },
          },
        ]),
      }),
    });
    renderWithClient(
      <MemoryRouter>
        <Transactions />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Tacos")).toBeDefined();
    expect(screen.getByText("Food")).toBeDefined();
    expect(screen.getByText("−$12.50")).toBeDefined();
    expect(screen.getByText("+$2,000.00")).toBeDefined();
  });

  it("records an expense as a negative amount, only once a category is chosen", async () => {
    const calls = mockApi({
      "GET /transactions": () => ({ body: pageOf([]) }),
      "GET /categories": () => ({ body: [tacos.category] }),
      "POST /transactions": (body) => ({ status: 201, body: { ...tacos, ...(body as object) } }),
    });
    renderWithClient(
      <MemoryRouter>
        <Transactions />
      </MemoryRouter>,
    );

    await screen.findByText("No transactions yet.");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const amount = (await screen.findByLabelText("Amount")) as HTMLInputElement;
    // No sign, letters or a third decimal: the Expense/Income switch sets the sign.
    for (const rejected of ["-12", "+12", "1e3", "12.345", "abc", "123456789"]) {
      fireEvent.change(amount, { target: { value: rejected } });
      expect(amount.value).toBe("");
    }
    fireEvent.change(amount, { target: { value: "12.5" } });
    expect(amount.value).toBe("12.5");
    fireEvent.change(screen.getByLabelText("What was it for?"), { target: { value: "Tacos" } });
    const form = screen.getByLabelText("What was it for?").closest("form")!;
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Choose a category");
    expect(calls.some((c) => c.key === "POST /transactions")).toBe(false);

    fireEvent.click(await screen.findByRole("radio", { name: "Food" }));
    fireEvent.submit(form);
    await waitFor(() => expect(calls.some((c) => c.key === "POST /transactions")).toBe(true));
    expect(calls.find((c) => c.key === "POST /transactions")?.body).toEqual({
      title: "Tacos",
      amount: -12.5,
      date: today(),
      categoryId: "c1",
    });
  });
});

describe("transaction dialog categories", () => {
  it("shows the most used first, seven plus More… when there are many", async () => {
    const categories = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      name: `Cat ${i}`,
      type: "EXPENSE" as const,
      usage: i, // Cat 9 is the most used.
    }));
    mockApi({
      "GET /transactions": () => ({ body: pageOf([]) }),
      "GET /categories": () => ({ body: categories }),
    });
    renderWithClient(
      <MemoryRouter>
        <Transactions />
      </MemoryRouter>,
    );

    await screen.findByText("No transactions yet.");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("radio", { name: "Cat 9" });
    const names = () =>
      screen
        .getAllByRole("radio")
        .map((r) => r.textContent)
        .filter((t) => t?.startsWith("Cat"));
    expect(names()).toEqual(["Cat 9", "Cat 8", "Cat 7", "Cat 6", "Cat 5", "Cat 4", "Cat 3"]);

    fireEvent.click(screen.getByRole("button", { name: "More…" }));
    expect(names()).toHaveLength(10);
    expect(screen.queryByRole("button", { name: "More…" })).toBeNull();
  });
});

describe("dashboard", () => {
  it("shows the month's numbers, where it went and recent activity", async () => {
    const month = (m: string, income: number, spending: number) => ({ month: m, income, spending });
    const calls = mockApi({
      "GET /summary": () => ({
        body: {
          month: "2026-03",
          balance: 5364,
          current: month("2026-03", 1000, 250.5),
          previous: month("2026-02", 800, 500),
          months: Array.from({ length: 12 }, (_, i) => month(`2026-${String(i + 1).padStart(2, "0")}`, 0, 0)),
          categories: [
            { id: "c1", name: "Food", amount: 200.5, share: 80 },
            { id: "c3", name: "Bills", amount: 50, share: 20 },
          ],
        },
      }),
      "GET /transactions": () => ({ body: pageOf([tacos]) }),
    });
    renderWithClient(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Tacos")).toBeDefined();
    // The totals count up with anime.js before settling.
    await waitFor(() => expect(screen.getByText("Balance").parentElement?.textContent).toContain("$5,364.00"));
    expect(screen.getByText("+25%")).toBeDefined(); // income vs last month
    expect(screen.getByText("-49.9%")).toBeDefined(); // spending vs last month
    expect(screen.getByText("Net this month").parentElement?.textContent).toContain("75% of income saved");
    expect(screen.getByText("Where it went").closest("[data-slot=card]")?.textContent).toContain("Food$200.5080%");
    expect(screen.getByText(/is your biggest category/).textContent).toContain("49.9% less than February");
    expect(calls.find((c) => c.key === "GET /summary")?.url).toMatch(/^\/api\/summary\?month=\d{4}-\d{2}$/);
  });

  it("folds everything past the top five into Other", async () => {
    const month = (m: string, income: number, spending: number) => ({ month: m, income, spending });
    const names = ["Housing", "Food", "Bills", "Health", "Fun", "Transport", "Shopping", "Other"];
    mockApi({
      "GET /summary": () => ({
        body: {
          month: "2026-03",
          balance: 0,
          current: month("2026-03", 0, 360),
          previous: month("2026-02", 0, 0),
          months: Array.from({ length: 12 }, (_, i) => month(`2026-${String(i + 1).padStart(2, "0")}`, 0, 0)),
          // 100, 80, 60, 50, 40, then 15 + 10 + 5 to fold.
          categories: names.map((name, i) => ({
            id: `c${i}`,
            name,
            amount: [100, 80, 60, 50, 40, 15, 10, 5][i],
            share: 0,
          })),
        },
      }),
      "GET /transactions": () => ({ body: pageOf([]) }),
    });
    renderWithClient(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    const card = (await screen.findByText("Where it went")).closest("[data-slot=card]")!;
    await waitFor(() => expect(card.querySelectorAll("li")).toHaveLength(6));
    const rows = [...card.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows.map((r) => r?.split("$")[0])).toEqual(["Housing", "Food", "Bills", "Health", "Fun", "Other"]);
    expect(rows[5]).toContain("$30.00");
  });

  it("tops up to five rows with unspent categories, and always shows Other", async () => {
    const month = (m: string, income: number, spending: number) => ({ month: m, income, spending });
    const expense = ["Bills", "Food", "Fun", "Health", "Housing", "Other", "Transport"].map((name, i) => ({
      id: `e${i}`,
      name,
      type: "EXPENSE" as const,
      usage: 0,
    }));
    mockApi({
      "GET /summary": () => ({
        body: {
          month: "2026-03",
          balance: 0,
          current: month("2026-03", 0, 300),
          previous: month("2026-02", 0, 0),
          months: Array.from({ length: 12 }, (_, i) => month(`2026-${String(i + 1).padStart(2, "0")}`, 0, 0)),
          categories: [
            { id: "e4", name: "Housing", amount: 200, share: 66.7 },
            { id: "e1", name: "Food", amount: 100, share: 33.3 },
          ],
        },
      }),
      "GET /categories": () => ({ body: expense }),
      "GET /transactions": () => ({ body: pageOf([]) }),
    });
    renderWithClient(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    const card = (await screen.findByText("Where it went")).closest("[data-slot=card]")!;
    await waitFor(() => expect(card.querySelectorAll("li")).toHaveLength(6));
    const rows = [...card.querySelectorAll("li")].map((li) => li.textContent ?? "");
    // Spent first, then unspent ones alphabetically at $0, then Other (nothing to fold: $0).
    expect(rows.map((r) => r.split("$")[0])).toEqual(["Housing", "Food", "Bills", "Fun", "Health", "Other"]);
    expect(rows[2]).toContain("$0.000%");
    expect(rows[5]).toContain("$0.000%");
  });
});
