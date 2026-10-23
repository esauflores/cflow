import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The database file, DATABASE_PATH or /data/cflow.db, the Docker image's volume (`:memory:` for one that lives with
 * the process, as the tests use).
 */
const path = process.env.DATABASE_PATH || "/data/cflow.db";

/**
 * The migrations drizzle-kit generates from the tables (`bun run db:generate`), two folders up: from this file,
 * apps/api/drizzle/; built, from dist/server/src/server.js, dist/drizzle/, where build.ts copies them.
 */
const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

/**
 * The database: SQLite, the copy inside Bun (bun:sqlite, no addon to install or load), in the process, with Drizzle's
 * typed queries, which are synchronous: a query blocks the process for its length, there's no round trip to wait on.
 * Each module declares its tables in `<module>.table.ts`. The migrations not yet applied run once, the first time
 * this file is imported, so the server starts on the current tables.
 * - journal_mode = WAL journals next to the file (cflow.db-wal): readers don't wait for the writer.
 * - synchronous = NORMAL syncs the disk at checkpoints, not on every commit: about 40 times the writes a second of
 *   FULL, and faster than OFF, which risks the file. A crash of the process loses nothing; a power cut can lose the
 *   last commits, never the file.
 * - foreign_keys = ON makes a column's `.references()` hold: a row can't point at one that doesn't exist (off by
 *   default).
 */
export const db = drizzle(path);

db.run(sql`PRAGMA journal_mode = WAL`);
db.run(sql`PRAGMA synchronous = NORMAL`);
db.run(sql`PRAGMA foreign_keys = ON`);

/**
 * Fail at start if a pragma didn't take, rather than run with the wrong setting. A filesystem without WAL support
 * (NFS, some bind mounts) silently keeps the old journal_mode, which would only show up as slow writes, and
 * foreign_keys off would let rows reference ones that don't exist.
 */
const expected: Record<string, readonly unknown[]> = {
  journal_mode: ["wal", "memory"],
  synchronous: [1], // NORMAL
  foreign_keys: [1],
};

for (const [name, allowed] of Object.entries(expected)) {
  const value = db.get<Record<string, unknown>>(sql.raw(`PRAGMA ${name}`))?.[name];
  if (!allowed.includes(value)) {
    throw new Error(`PRAGMA ${name} is ${JSON.stringify(value)} on ${path}, expected ${allowed.join(" or ")}`);
  }
}

migrate(db, { migrationsFolder });
