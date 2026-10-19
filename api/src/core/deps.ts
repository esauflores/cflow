import type { Hooks } from "@esauflores/plugin-sdk";

import type { Client } from "@api/core/db.ts";
import { dateIn, type LocalDate } from "@api/core/lib/dates.ts";

export interface Config {
  port: number;
  /** SQLite file, relative to the repo root; `:memory:` for a throwaway database. */
  databasePath: string;
  /** IANA zone that defines "today" for dates. */
  timeZone: string;
  sessionTtlMs: number;
  /** Plugin packages or paths to load, from CFLOW_PLUGINS (comma-separated). */
  plugins: string[];
  /** Whether the login screen offers a read-only guest session (ALLOW_GUEST). */
  allowGuest: boolean;
}

const HOUR_MS = 3_600_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const timeZone = env.APP_TIMEZONE ?? "UTC";
  // Throws a RangeError early for an unknown zone.
  new Intl.DateTimeFormat("en", { timeZone });
  return {
    port: Number(env.PORT ?? 5173),
    databasePath: env.DATABASE_PATH || "data/cflow.db",
    timeZone,
    sessionTtlMs: Number(env.SESSION_TTL_DAYS ?? 30) * 24 * HOUR_MS,
    plugins: (env.CFLOW_PLUGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    allowGuest: /^(1|true|yes)$/i.test(env.ALLOW_GUEST ?? ""),
  };
}

/**
 * Lifecycle events raised after a change has been committed. Payloads are
 * typed for plugin authors in `plugins/api.ts`; here they stay opaque so core
 * does not depend on module types.
 */
export type HookName = "transaction.created" | "transaction.updated" | "transaction.deleted";

export type CoreHooks = { [K in HookName]: (payload: unknown) => unknown };

/** The host's hook bus as core and modules see it: they only raise hooks. */
export type CoreHookBus = Pick<Hooks<CoreHooks>, "call">;

export interface Clock {
  now(): Date;
  /** Today's calendar date in the configured time zone. */
  today(): LocalDate;
}

export interface Deps {
  db: Client;
  clock: Clock;
  config: Config;
  hooks: CoreHookBus;
}

export function systemClock(timeZone: string): Clock {
  return {
    now: () => new Date(),
    today: () => dateIn(new Date(), timeZone),
  };
}

export function createDeps(db: Client, clock: Clock, config: Config, hooks: CoreHookBus): Deps {
  return { db, clock, config, hooks };
}
