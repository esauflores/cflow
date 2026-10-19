import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, getToken, setToken } from "@web/lib/api.ts";
import { formatMoney } from "@web/lib/utils.ts";

import { mockApi } from "./fetch.ts";

describe("api client", () => {
  beforeEach(() => setToken("secret"));
  afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
  });

  it("sends the session token and unwraps the envelope", async () => {
    const calls = mockApi({ "GET /transactions": () => ({ body: { content: [], page: { totalElements: 0 } } }) });
    const page = await api.transactions.list({ query: "food", page: 2 });
    expect(page.content).toEqual([]);
    expect(calls[0]?.url).toBe("/api/transactions?size=20&query=food&page=2");
    expect(calls[0]?.headers.Authorization).toBe("Bearer secret");
  });

  it("raises ApiError with the code and field errors", async () => {
    mockApi({
      "POST /transactions": () => ({
        status: 400,
        body: {
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          errors: [{ field: "title", message: "Too short" }],
        },
      }),
    });
    const error = await api.transactions
      .create({ title: "", amount: -1, date: "2026-01-01", categoryId: "c1" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Too short",
      fieldErrors: [{ field: "title", message: "Too short" }],
    });
  });

  it("drops the session when the API rejects the token", async () => {
    mockApi({ "GET /balance": () => ({ status: 401, body: { code: "UNAUTHORIZED", message: "Session expired" } }) });
    await expect(api.balance()).rejects.toThrow("Session expired");
    expect(getToken()).toBeNull();
  });

  it("returns nothing for 204 responses", async () => {
    mockApi({ "DELETE /transactions/abc": () => ({ status: 204 }) });
    await expect(api.transactions.delete("abc")).resolves.toBeUndefined();
  });
});

describe("formatMoney", () => {
  it("formats dollars with a minus sign for money out", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(-4.5)).toBe("−$4.50");
  });
});
