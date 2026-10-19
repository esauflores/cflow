import { describe, expect, it } from "vitest";

import { divRound, parseMoney, percentageChange, percentageOf } from "@api/core/lib/money.ts";

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

  it("rounds half up and half to even", () => {
    expect(divRound(5n, 2n, "HALF_UP")).toBe(3n);
    expect(divRound(5n, 2n, "HALF_EVEN")).toBe(2n);
    expect(divRound(7n, 2n, "HALF_EVEN")).toBe(4n);
    expect(divRound(-5n, 2n, "HALF_UP")).toBe(-3n);
  });

  it("computes percentage changes like the original service", () => {
    expect(percentageChange(0, 0)).toBe(0);
    expect(percentageChange(0, 50)).toBe(100);
    expect(percentageChange(200, 300)).toBe(50);
    expect(percentageChange(300, 200)).toBe(-33.3);
    expect(percentageOf(1, 3)).toBe(33.3);
  });
});
