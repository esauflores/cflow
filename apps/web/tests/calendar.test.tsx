import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Calendar } from "@web/components/ui/calendar.tsx";

const day = (label: string) => screen.getByRole("button", { name: new RegExp(label) });

describe("calendar", () => {
  afterEach(cleanup);

  it("shows the selected month with outside days, and disables days after max", () => {
    render(<Calendar selected={new Date(2026, 9, 15)} max={new Date(2026, 9, 18)} onSelect={() => {}} />);

    expect(screen.getByRole("status").textContent).toBe("October 2026");
    // Sunday Sep 27 to Saturday Oct 31: five weeks.
    expect(screen.getAllByRole("row")).toHaveLength(5); // the weekday header row is aria-hidden
    expect(day("Sunday, September 27, 2026")).toBeDefined();
    expect(day("Thursday, October 15, 2026, selected")).toHaveProperty("tabIndex", 0);
    expect(day("Sunday, October 18, 2026")).toHaveProperty("disabled", false);
    expect(day("Monday, October 19, 2026")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Go to the Next Month" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("moves focus like react-day-picker and selects on click", () => {
    const onSelect = vi.fn();
    render(<Calendar selected={new Date(2026, 9, 15)} max={new Date(2026, 9, 18)} onSelect={onSelect} />);

    const start = day("October 15, 2026");
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(document.activeElement).toBe(day("October 16, 2026"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    // Oct 23 is after max: the move continues to the next enabled day in that direction, so it stays put.
    expect(document.activeElement).toBe(day("October 16, 2026"));
    fireEvent.keyDown(document.activeElement!, { key: "PageUp" });
    expect(screen.getByRole("status").textContent).toBe("September 2026");
    expect(document.activeElement).toBe(day("Wednesday, September 16, 2026"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(day("Sunday, September 13, 2026"));

    fireEvent.click(document.activeElement!);
    expect(onSelect).toHaveBeenCalledWith(new Date(2026, 8, 13));
  });
});
