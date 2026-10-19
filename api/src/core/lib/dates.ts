import { z } from "zod";

/**
 * Calendar dates are `YYYY-MM-DD` strings, compared lexically and
 * manipulated through UTC so no local offset can shift a day.
 */
export type LocalDate = string;

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const localDate = z.string().refine(isValidDate, { message: "Invalid date, expected YYYY-MM-DD" });

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

function year(date: LocalDate): number {
  return parts(date)[0];
}

function lengthOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(date: LocalDate, days: number): LocalDate {
  return format(new Date(parse(date).getTime() + days * DAY_MS));
}

/** Adds months, clamping to the last valid day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  return of(ty, tm, Math.min(d, lengthOfMonth(ty, tm)));
}

export function addYears(date: LocalDate, years: number): LocalDate {
  return addMonths(date, years * 12);
}

function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);
}

/** Whole months between two dates, truncated toward zero. */
export function monthsBetween(from: LocalDate, to: LocalDate): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  let months = (ty - fy) * 12 + (tm - fm);
  if (months > 0 && td < fd) months -= 1;
  if (months < 0 && td > fd) months += 1;
  return months;
}

/** ISO day of week: Monday = 1 … Sunday = 7. */
function isoDayOfWeek(date: LocalDate): number {
  return parse(date).getUTCDay() || 7;
}

/** ISO-8601 week number within its week-based year. */
export function isoWeek(date: LocalDate): number {
  const thursday = addDays(date, 4 - isoDayOfWeek(date));
  return Math.floor(daysBetween(of(year(thursday), 1, 1), thursday) / 7) + 1;
}

/** Number of ISO weeks in a week-based year (52 or 53). */
export function isoWeeksInYear(y: number): number {
  return isoWeek(of(y, 12, 28));
}

/** Monday of ISO week `week` of week-based year `y`. */
export function isoWeekStart(y: number, week: number): LocalDate {
  const jan4 = of(y, 1, 4);
  return addDays(jan4, (week - 1) * 7 - (isoDayOfWeek(jan4) - 1));
}

/** The calendar date of `instant` in `timeZone`. */
export function dateIn(instant: Date, timeZone: string): LocalDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant,
  );
}

/** The instant at which `date` begins in `timeZone`. */
export function startOfDayIn(date: LocalDate, timeZone: string): Date {
  const guess = parse(date).getTime();
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

function offsetMs(instant: Date, timeZone: string): number {
  const fields = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(instant)
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
