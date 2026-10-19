import { type ClassValue, clsx } from "clsx";
import { useSyncExternalStore } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "$1,234.50", or "−$4.50" for a negative amount. */
export function formatMoney(amount: number): string {
  return `${amount < 0 ? "−" : ""}${currency.format(Math.abs(amount))}`;
}

/** A `YYYY-MM-DD` date as "Mar 15, 2026". */
export function formatDate(value: string): string {
  return dateFormat.format(new Date(`${value}T00:00:00Z`));
}

/** Today in the browser's time zone as `YYYY-MM-DD`. */
export function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Colour for "Other" and any category without one. */
const NEUTRAL_COLOR = "#6b7280";

/** Colours offered when editing a category's colour. */
export const CATEGORY_PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
];

/** The colour each category stores, keyed by id. */
export function categoryColors(categories: { id: string; color?: string }[]): (id: string) => string {
  const colors = new Map(categories.map((c) => [c.id, c.color ?? NEUTRAL_COLOR]));
  return (id) => colors.get(id) ?? NEUTRAL_COLOR;
}

/** The day before a `YYYY-MM-DD` date. */
export function dayBefore(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! - 1));
  return date.toISOString().slice(0, 10);
}

/** "Good morning", "Good afternoon" or "Good evening" for the browser's clock. */
export function greeting(hour = new Date().getHours()): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Change from `previous` to `current` in percent, or null when there is nothing to compare with. */
/** True when the user asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

// Theme: "system" follows the OS; with no saved choice the app follows the system. Saved in the browser only
// (localStorage), never the DB. index.html applies it before the first paint.

export type ThemeChoice = "system" | "light" | "dark";

const THEME_KEY = "cflow.theme";
const THEME_EVENT = "cflow:theme";
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)");

function getTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function applyTheme(choice: ThemeChoice) {
  document.documentElement.classList.toggle("dark", choice === "dark" || (choice === "system" && systemDark().matches));
}

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Not remembered when storage is unavailable.
  }
  applyTheme(choice);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribeTheme(onChange: () => void) {
  // An OS switch matters while following the system.
  const media = systemDark();
  const onSystem = () => {
    if (getTheme() === "system") applyTheme("system");
    onChange();
  };
  window.addEventListener(THEME_EVENT, onChange);
  media.addEventListener("change", onSystem);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    media.removeEventListener("change", onSystem);
  };
}

/** The theme choice, and whether the page is dark right now. Shared by the Settings preferences. */
export function useTheme(): { choice: ThemeChoice; dark: boolean } {
  const choice = useSyncExternalStore(subscribeTheme, getTheme);
  const dark = useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"));
  return { choice, dark };
}
