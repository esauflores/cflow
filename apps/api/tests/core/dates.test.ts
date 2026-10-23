import { describe, expect, it } from "vite-plus/test";

import { dateIn } from "@api/core/dates.ts";

describe("dateIn", () => {
  it("returns the calendar date in a zone", () => {
    const instant = new Date("2026-03-14T23:30:00Z");

    expect(dateIn(instant, "UTC")).toBe("2026-03-14");
    expect(dateIn(instant, "America/Bogota")).toBe("2026-03-14");
    expect(dateIn(instant, "Asia/Tokyo")).toBe("2026-03-15");
  });
});
