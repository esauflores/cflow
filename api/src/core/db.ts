import { type Client, createClient, type InStatement, type Transaction } from "@libsql/client";

// The database is plain libSQL: the core and every plugin talk to it in SQL
// and create their own tables. Money is stored as integer cents, calendar
// dates as `YYYY-MM-DD` text, instants as epoch milliseconds.

export type { Client } from "@libsql/client";

/** Anything statements can run against: the client or an open transaction. */
export type Executor = Pick<Client | Transaction, "execute">;

/** Opens the SQLite file at `path` (or `:memory:`). */
export async function openDatabase(path: string): Promise<Client> {
  const client = createClient({ url: path === ":memory:" ? path : `file:${path}` });
  await client.execute("PRAGMA foreign_keys = ON");
  return client;
}

/** Runs `fn` in a write transaction, committing on success and rolling back on error. */
export async function inTransaction<T>(client: Client, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await client.transaction("write");
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

/** The rows of a query, typed by the caller (column names as aliased in the SQL). */
export async function all<T>(ex: Executor, statement: InStatement): Promise<T[]> {
  return (await ex.execute(statement)).rows as unknown as T[];
}

/** The first row of a query, if any. */
export async function first<T>(ex: Executor, statement: InStatement): Promise<T | undefined> {
  return (await all<T>(ex, statement))[0];
}
