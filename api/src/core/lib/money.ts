import { z } from "zod";

/** Integer minor units (cents). All money math happens on these. */
export type Cents = number;

const MONEY_PATTERN = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

/** Parses a non-negative decimal with at most 12 integer and 2 fraction digits. */
export function parseMoney(input: string | number): Cents | null {
  const text = typeof input === "number" ? String(input) : input.trim();
  const match = MONEY_PATTERN.exec(text);
  if (!match) return null;
  const [, whole = "0", fraction = ""] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Converts cents to the decimal number sent over the API. */
export function toAmount(cents: Cents): number {
  return cents / 100;
}

/**
 * Zod schema for an incoming amount. Accepts a JSON number or a decimal
 * string and yields cents. `min`/`max` are in cents and bound the absolute
 * value; with `signed`, a leading minus sign is allowed (money going out).
 */
export function money(options: { min?: Cents; max?: Cents; signed?: boolean } = {}) {
  const { min = 0, max = 99_999_999_999_999, signed = false } = options;
  return z.union([z.number(), z.string()]).transform((value, ctx) => {
    const text = String(value).trim();
    const negative = signed && text.startsWith("-");
    const cents = parseMoney(negative ? text.slice(1) : text);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Invalid monetary format (up to 12 digits and 2 decimals)" });
      return z.NEVER;
    }
    if (cents < min) {
      ctx.addIssue({ code: "custom", message: `Amount must be at least ${toAmount(min)}` });
      return z.NEVER;
    }
    if (cents > max) {
      ctx.addIssue({ code: "custom", message: `Amount must not exceed ${toAmount(max)}` });
      return z.NEVER;
    }
    return negative ? -cents : cents;
  });
}

type Rounding = "HALF_UP" | "HALF_EVEN";

/** Integer division of `num / den` (den > 0) rounded to the nearest integer. */
export function divRound(num: bigint, den: bigint, mode: Rounding): bigint {
  const negative = num < 0n;
  const abs = negative ? -num : num;
  let quotient = abs / den;
  const twiceRemainder = (abs % den) * 2n;
  if (twiceRemainder > den || (twiceRemainder === den && (mode === "HALF_UP" || quotient % 2n === 1n))) {
    quotient += 1n;
  }
  return negative ? -quotient : quotient;
}

/** `part / total` as a percentage with one decimal, or 0 when total is 0. */
export function percentageOf(part: number, total: number): number {
  if (total === 0) return 0;
  return roundedPercentage(BigInt(part), BigInt(total));
}

/**
 * Relative change from `previous` to `current` as a percentage with one
 * decimal. Growth from zero counts as 100%.
 */
export function percentageChange(previous: number, current: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return roundedPercentage(BigInt(current - previous), BigInt(Math.abs(previous)));
}

// Ratio rounded to 4 places, then scaled to a percentage with 1 place —
// the same two-step rounding the original service applied.
function roundedPercentage(num: bigint, den: bigint): number {
  const ratio = divRound(num * 10_000n, den, "HALF_EVEN");
  return Number(divRound(ratio, 10n, "HALF_EVEN")) / 10;
}
