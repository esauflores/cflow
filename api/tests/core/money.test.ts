import { describe, expect, it } from "vitest";

import { parseMoney } from "@api/core/lib/money.ts";

describe("money", () => {
  it("parses decimals exactly into cents", () => {
    expect(parseMoney("0.1")).toBe(10);
    expect(parseMoney(0.29)).toBe(29);
    expect(parseMoney(19.99)).toBe(1999);
    expect(parseMoney("1000000000.00")).toBe(100_000_000_000);
  });

  it("rejects malformed amounts", () => {
    for (const bad of ["1.234", "-1", "abc", "", "1e3", "1234567890123"]) expect(parseMoney(bad)).toBeNull();
  });
});
