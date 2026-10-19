import { describe, expect, it } from "vitest";

import * as d from "@api/core/lib/dates.ts";

describe("dates", () => {
  it("clamps month arithmetic to the end of the month", () => {
    expect(d.addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(d.addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(d.addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("validates calendar dates", () => {
    expect(d.isValidDate("2026-02-29")).toBe(false);
    expect(d.isValidDate("2024-02-29")).toBe(true);
    expect(d.isValidDate("2026-3-1")).toBe(false);
  });

  it("finds the calendar date in a time zone", () => {
    expect(d.dateIn(new Date("2026-03-15T03:00:00Z"), "America/Mexico_City")).toBe("2026-03-14");
  });
});
