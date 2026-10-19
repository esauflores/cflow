import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { type Client, type Executor, first, inTransaction } from "@api/core/db.ts";
import type { Deps } from "@api/core/deps.ts";
import { conflict, unauthorized } from "@api/core/http.ts";

const PASSWORD_KEY = "server_password_hash";

/** Who a session belongs to: the owner may change things, a guest may only read. */
export type SessionRole = "owner" | "guest";

export interface Session {
  token: string;
  expiresAt: Date;
  role: SessionRole;
}

/** Creates the tables auth needs; safe to run on every start. */
export async function createAuthTables(client: Client): Promise<void> {
  await client.batch([
    "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    // `id` is the SHA-256 of the bearer token; the token itself is never stored.
    "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'owner')",
  ]);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function storedHash(ex: Executor): Promise<string | undefined> {
  const row = await first<{ value: string }>(ex, {
    sql: "SELECT value FROM app_settings WHERE key = ?",
    args: [PASSWORD_KEY],
  });
  return row?.value;
}

export async function isBootstrapped(db: Client): Promise<boolean> {
  return (await storedHash(db)) !== undefined;
}

async function createSession({ db, clock, config }: Deps, role: SessionRole): Promise<Session> {
  const token = randomBytes(32).toString("base64url");
  const now = clock.now().getTime();
  const expiresAt = new Date(now + config.sessionTtlMs);
  // Expired sessions are useless; clearing them here keeps the table from only ever growing.
  await db.batch(
    [
      { sql: "DELETE FROM sessions WHERE expires_at <= ?", args: [now] },
      {
        sql: "INSERT INTO sessions (id, created_at, expires_at, role) VALUES (?, ?, ?, ?)",
        args: [hashToken(token), now, expiresAt.getTime(), role],
      },
    ],
    "write",
  );
  return { token, expiresAt, role };
}

/** Sets the server password on first run. */
export async function bootstrap(deps: Deps, password: string) {
  const hash = await hashPassword(password);
  await inTransaction(deps.db, async (tx) => {
    if ((await storedHash(tx)) !== undefined) throw conflict("The server has already been set up");
    await tx.execute({ sql: "INSERT INTO app_settings (key, value) VALUES (?, ?)", args: [PASSWORD_KEY, hash] });
  });
  return createSession(deps, "owner");
}

export async function login(deps: Deps, password: string) {
  const hash = await storedHash(deps.db);
  if (!hash) throw conflict("The server has not been set up yet");
  if (!(await verifyPassword(password, hash))) throw unauthorized("Invalid password", "INVALID_CREDENTIALS");
  return createSession(deps, "owner");
}

/** A read-only session; the caller must have checked `config.allowGuest`. */
export function guest(deps: Deps): Promise<Session> {
  return createSession(deps, "guest");
}

export async function logout(db: Client, tokenHash: string): Promise<void> {
  await db.execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [tokenHash] });
}

/** Replaces the password and revokes every session except the caller's. */
export async function changePassword(deps: Deps, tokenHash: string, current: string, next: string): Promise<void> {
  const hash = await storedHash(deps.db);
  if (!hash || !(await verifyPassword(current, hash))) {
    throw unauthorized("Current password is incorrect", "INVALID_CREDENTIALS");
  }
  const nextHash = await hashPassword(next);
  await deps.db.batch(
    [
      { sql: "UPDATE app_settings SET value = ? WHERE key = ?", args: [nextHash, PASSWORD_KEY] },
      { sql: "DELETE FROM sessions WHERE id <> ?", args: [tokenHash] },
    ],
    "write",
  );
}

export async function sessionRole(db: Client, tokenHash: string, now: Date): Promise<SessionRole | null> {
  const row = await first<{ role: SessionRole }>(db, {
    sql: "SELECT role FROM sessions WHERE id = ? AND expires_at > ?",
    args: [tokenHash, now.getTime()],
  });
  return row?.role ?? null;
}

// Password hashing: scrypt with a per-password salt, stored as `scrypt$N$r$p$salt$key`.

const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

function derive(password: string, salt: Buffer, cost: number, blockSize: number, parallelism: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: cost, r: blockSize, p: parallelism }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Hashes a password as `scrypt$N$r$p$salt$key` (base64 salt and key). */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISM);
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("base64"), key.toString("base64")].join("$");
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
