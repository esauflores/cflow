import type { Clock, Config } from "@api/core/config.ts";
import { db } from "@api/core/db.ts";

/** The database, typed as Drizzle exposes it; services accept this or an open transaction. */
export type Db = typeof db;

/** What the modules get: the connection, the clock and the settings. */
export interface Deps {
  db: Db;
  clock: Clock;
  config: Config;
}
