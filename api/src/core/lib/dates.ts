import { z } from "zod";

/**
 * Calendar dates are `YYYY-MM-DD` strings, compared lexically and
 * manipulated through UTC so no local offset can shift a day.
 */
export type LocalDate = string;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const localDate = z.string().refine(isValidDate, { message: "Invalid date, expected YYYY-MM-DD" });

/** @internal Exported for tests. */
export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  return format(parse(value)) === value;
}

function parse(date: LocalDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(date: Date): LocalDate {
  return date.toISOString().slice(0, 10);
}

function parts(date: LocalDate): [number, number, number] {
  const [y = 0, m = 0, d = 0] = date.split("-").map(Number);
  return [y, m, d];
}

function of(year: number, month: number, day: number): LocalDate {
  return format(new Date(Date.UTC(year, month - 1, day)));
}

function lengthOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds months, clamping to the last valid day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return of(ty, tm, Math.min(d, lengthOfMonth(ty, tm)));
}

/** The calendar date of `instant` in `timeZone`. */
export function dateIn(instant: Date, timeZone: string): LocalDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant,
  );
}
