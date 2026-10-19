import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@web/components/ui/button.tsx";
import { locale, t } from "@web/lib/i18n.ts";
import { cn } from "@web/lib/utils.ts";

// A single-date calendar that replaces react-day-picker. It keeps the shadcn
// look (the same classes) and react-day-picker's markup and keyboard model:
// a role="grid" table with one focusable day (roving tabindex), arrows by day
// or week, Home/End to the week's ends, PageUp/PageDown by month and with Shift
// by year. Disabled days are skipped when moving.

// Formats in the current language, made when used so they follow a language change.
const caption = {
  format: (date: Date) => new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(date),
};
const dayLabel = {
  format: (date: Date) =>
    new Intl.DateTimeFormat(locale(), { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date),
};
/** "Su" … "Sa" (or "do" … "sá"), Sunday first: Jan 4, 2026 is a Sunday. */
const weekdays = () =>
  Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale(), { weekday: "short" }).format(new Date(2026, 0, 4 + i)).slice(0, 2),
  );

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
/** Same day `months` later, clamped to the month's length (Jan 31 + 1 month = Feb 28). */
function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last));
}
const sameDay = (a: Date | undefined, b: Date | undefined) => !!a && !!b && a.getTime() === b.getTime();
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** The weeks shown for `month`: Sunday-first rows from the week of the 1st to the week of the last day. */
function weeksOf(month: Date): Date[][] {
  const first = startOfMonth(month);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const start = addDays(first, -first.getDay());
  const end = addDays(last, 6 - last.getDay());
  const weeks: Date[][] = [];
  for (let day = start; day <= end; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

function Calendar({
  selected,
  defaultMonth,
  max,
  onSelect,
  className,
}: {
  selected?: Date;
  /** The month shown first. Defaults to the selected date's, else today's. */
  defaultMonth?: Date;
  /** Latest selectable day; later days are disabled. */
  max?: Date;
  onSelect: (date: Date) => void;
  className?: string;
}) {
  const today = startOfDay(new Date());
  const selectedDay = selected && startOfDay(selected);
  const [month, setMonth] = useState(() => startOfMonth(defaultMonth ?? selected ?? today));
  // The day keyboard focus is on, once the grid has been focused; drives the focus ring and the roving tabindex.
  const [focused, setFocused] = useState<Date | null>(null);
  const grid = useRef<HTMLTableElement>(null);

  const isDisabled = (day: Date) => !!max && day > startOfDay(max);
  const weeks = weeksOf(month);
  const inMonth = weeks.flat().filter((day) => sameMonth(day, month));
  // The one day reachable with Tab, as in react-day-picker: focused, else selected, else today, else the first enabled.
  const tabbable =
    [focused, selectedDay, today].find((day) => day && sameMonth(day, month) && !isDisabled(day)) ??
    inMonth.find((day) => !isDisabled(day));

  useEffect(() => {
    if (!focused) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focused.getTime()}"]`)?.focus();
  }, [focused]);

  /** Focuses `target`, or the first enabled day `step` reaches from it, and shows its month. */
  function moveFocus(target: Date, step: (day: Date) => Date) {
    let next = target;
    for (let guard = 0; isDisabled(next) && guard < 366; guard++) next = step(next);
    if (isDisabled(next)) return;
    if (!sameMonth(next, month)) setMonth(startOfMonth(next));
    setFocused(next);
  }

  function onKeyDown(event: KeyboardEvent, day: Date) {
    const moves: Record<string, (d: Date) => Date> = {
      ArrowLeft: (d) => addDays(d, -1),
      ArrowRight: (d) => addDays(d, 1),
      ArrowUp: (d) => addDays(d, -7),
      ArrowDown: (d) => addDays(d, 7),
      Home: (d) => addDays(d, -d.getDay()),
      End: (d) => addDays(d, 6 - d.getDay()),
      PageUp: (d) => addMonths(d, event.shiftKey ? -12 : -1),
      PageDown: (d) => addMonths(d, event.shiftKey ? 12 : 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const target = move(day);
    // Arrows keep going past disabled days; jumps (Home/End, months, years) step back towards where they started.
    const isArrow = event.key.startsWith("Arrow");
    moveFocus(target, isArrow ? move : (d) => addDays(d, target > day ? -1 : 1));
  }

  const navButton = "size-(--cell-size) p-0 select-none aria-disabled:opacity-50";
  const nextDisabled = !!max && startOfMonth(addMonths(month, 1)) > startOfDay(max);

  return (
    <div
      data-slot="calendar"
      className={cn(
        "group/calendar w-fit bg-background p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)] in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent",
        className,
      )}
    >
      <div className="relative flex flex-col gap-4">
        <nav className="absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1">
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }), navButton)}
            aria-label={t("Go to the Previous Month")}
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "ghost" }), navButton)}
            aria-label={t("Go to the Next Month")}
            aria-disabled={nextDisabled || undefined}
            onClick={() => !nextDisabled && setMonth(addMonths(month, 1))}
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </nav>
        <div className="flex w-full flex-col gap-4">
          <div className="flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)">
            <span role="status" aria-live="polite" className="text-sm font-medium select-none">
              {caption.format(month)}
            </span>
          </div>
          <table ref={grid} role="grid" aria-label={caption.format(month)} className="w-full border-collapse">
            <thead aria-hidden>
              <tr className="flex">
                {weekdays().map((weekday) => (
                  <th
                    key={weekday}
                    scope="col"
                    className="flex-1 rounded-(--cell-radius) text-[0.8rem] font-normal text-muted-foreground select-none"
                  >
                    {weekday}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]!.getTime()} className="mt-2 flex w-full">
                  {week.map((day) => {
                    const isSelected = sameDay(day, selectedDay);
                    const isToday = sameDay(day, today);
                    const isOutside = !sameMonth(day, month);
                    const disabled = isDisabled(day);
                    return (
                      <td
                        key={day.getTime()}
                        role="gridcell"
                        aria-selected={isSelected || undefined}
                        data-selected={isSelected || undefined}
                        data-today={isToday || undefined}
                        data-outside={isOutside || undefined}
                        data-disabled={disabled || undefined}
                        data-focused={sameDay(day, focused ?? undefined) || undefined}
                        className={cn(
                          "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none [&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius) [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
                          isToday &&
                            "rounded-(--cell-radius) bg-muted text-foreground data-[selected=true]:rounded-none",
                          isOutside && "text-muted-foreground aria-selected:text-muted-foreground",
                          disabled && "text-muted-foreground opacity-50",
                        )}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          data-day={day.getTime()}
                          data-selected-single={isSelected || undefined}
                          tabIndex={sameDay(day, tabbable) ? 0 : -1}
                          disabled={disabled}
                          aria-label={`${isToday ? `${t("Today")}, ` : ""}${dayLabel.format(day)}${isSelected ? `, ${t("selected")}` : ""}`}
                          onClick={() => onSelect(day)}
                          onFocus={() => setFocused(day)}
                          onBlur={(event) => {
                            // Leaving the grid entirely drops the focus ring; moving between days keeps it.
                            if (!grid.current?.contains(event.relatedTarget as Node | null)) setFocused(null);
                          }}
                          onKeyDown={(event) => onKeyDown(event, day)}
                          className="relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-ring/50 data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-foreground"
                        >
                          {day.getDate()}
                        </Button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export { Calendar };
