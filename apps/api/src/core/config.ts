import { dateIn, type LocalDate } from "@api/core/dates.ts";

/** The modules CFlow can turn on; `core` is always required. */
export const AVAILABLE_PLUGINS = ["core", "i18n"] as const;

export interface Config {
  port: number;
  /** SQLite file, relative to where the server runs; `:memory:` for a throwaway database. */
  databasePath: string;
  /** IANA zone that defines "today" for dates. */
  timeZone: string;
  sessionTtlMs: number;
  /** Modules to enable, by name, from CFLOW_PLUGINS (comma-separated; `core` when unset or empty). */
  plugins: string[];
  /** Whether the login screen offers a read-only guest session (ALLOW_GUEST). */
  allowGuest: boolean;
  /**
   * Whether a reverse proxy sits in front (TRUST_PROXY): the client's address is then the last `X-Forwarded-For`
   * entry, which the proxy appended, rather than the proxy's own address.
   */
  trustProxy: boolean;
  /** Requests a minute per client at the API's edge, RATE_LIMIT (0 turns the limit off). */
  rateLimit: number;
  /** Largest request body read, in bytes, MAX_BODY_BYTES. */
  maxBodyBytes: number;
}

const HOUR_MS = 3_600_000;

const isTrue = (value: string | undefined) => /^(1|true|yes)$/i.test(value ?? "");

/** A whole number from the environment, failing startup on anything else. */
function wholeNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole number, got "${raw}"`);
  return Number(raw);
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = wholeNumber(env, name, fallback);
  if (value <= 0) throw new Error(`${name} must be a positive whole number, got "${env[name]}"`);
  return value;
}

function pluginList(raw: string | undefined): string[] {
  const names = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const enabled = names.length > 0 ? names : ["core"];
  const unknown = enabled.filter((name) => !AVAILABLE_PLUGINS.includes(name as (typeof AVAILABLE_PLUGINS)[number]));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown module ${unknown.map((n) => `"${n}"`).join(", ")} in CFLOW_PLUGINS; available: ${AVAILABLE_PLUGINS.join(", ")}`,
    );
  }
  const repeated = enabled.filter((name, i) => enabled.indexOf(name) !== i);
  if (repeated.length > 0) throw new Error(`CFLOW_PLUGINS lists "${repeated[0]}" more than once`);
  if (!enabled.includes("core")) throw new Error('CFLOW_PLUGINS must include "core"');
  return ["core", ...enabled.filter((name) => name !== "core")];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const timeZone = env.APP_TIMEZONE || "UTC";
  // Throws a RangeError early for an unknown zone.
  new Intl.DateTimeFormat("en", { timeZone });
  return {
    port: positiveInt(env, "PORT", 3000),
    databasePath: env.DATABASE_PATH || "/data/cflow.db",
    timeZone,
    sessionTtlMs: positiveInt(env, "SESSION_TTL_DAYS", 30) * 24 * HOUR_MS,
    plugins: pluginList(env.CFLOW_PLUGINS),
    allowGuest: isTrue(env.ALLOW_GUEST),
    trustProxy: isTrue(env.TRUST_PROXY),
    rateLimit: wholeNumber(env, "RATE_LIMIT", 300),
    maxBodyBytes: positiveInt(env, "MAX_BODY_BYTES", 1024 * 1024),
  };
}

export interface Clock {
  now(): Date;
  /** Today's calendar date in the configured time zone. */
  today(): LocalDate;
}

export function systemClock(timeZone: string): Clock {
  return {
    now: () => new Date(),
    today: () => dateIn(new Date(), timeZone),
  };
}
