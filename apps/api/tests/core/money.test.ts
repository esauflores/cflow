import { describe, expect, it } from "vite-plus/test";

import { isValidDate } from "@api/core/dates.ts";
import { money, parseMoney, toAmount } from "@api/core/money.ts";

describe("money", () => {
  it("parses decimals into cents", () => {
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("0.05")).toBe(5);
    expect(parseMoney(3)).toBe(300);
    expect(parseMoney("1.234")).toBeNull();
    expect(parseMoney("-1")).toBeNull();
  });

  it("accepts signed amounts as numbers or strings", () => {
    const schema = money({ min: 1, max: 9_999_999_999, signed: true });

    expect(schema.parse(-12.5)).toBe(-1250);
    expect(schema.parse("-12.5")).toBe(-1250);
    expect(schema.parse("12.50")).toBe(1250);
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse("abc").success).toBe(false);
    expect(toAmount(-1250)).toBe(-12.5);
  });
});

describe("dates", () => {
  it("accepts only real calendar dates", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("14/03/2026")).toBe(false);
  });
});
