import { describe, expect, it } from "vitest";

import * as d from "@api/core/lib/dates.ts";

describe("dates", () => {
  it("clamps month arithmetic to the end of the month", () => {
    expect(d.addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(d.addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(d.addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(d.addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("counts whole months between dates", () => {
    expect(d.monthsBetween("2026-01-31", "2026-02-28")).toBe(0);
    expect(d.monthsBetween("2026-01-15", "2026-03-15")).toBe(2);
    expect(d.monthsBetween("2026-01-15", "2026-03-14")).toBe(1);
  });

  it("computes ISO weeks", () => {
    expect(d.isoWeek("2026-01-01")).toBe(1);
    expect(d.isoWeek("2021-01-03")).toBe(53);
    expect(d.isoWeekStart(2026, 1)).toBe("2025-12-29");
    expect(d.isoWeeksInYear(2020)).toBe(53);
  });

  it("validates calendar dates", () => {
    expect(d.isValidDate("2026-02-29")).toBe(false);
    expect(d.isValidDate("2024-02-29")).toBe(true);
    expect(d.isValidDate("2026-3-1")).toBe(false);
  });

  it("finds the start of a day in a time zone", () => {
    expect(d.startOfDayIn("2026-03-15", "America/Bogota").toISOString()).toBe("2026-03-15T05:00:00.000Z");
    expect(d.dateIn(new Date("2026-03-15T03:00:00Z"), "America/Mexico_City")).toBe("2026-03-14");
  });
});
