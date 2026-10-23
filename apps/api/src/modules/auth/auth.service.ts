import { sql } from "drizzle-orm";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import type { Db, Deps } from "@api/core/deps.ts";
import { conflict, unauthorized } from "@api/core/errors.ts";

const PASSWORD_KEY = "server_password_hash";

/** Who a session belongs to: the owner may change things, a guest may only read. */
export type SessionRole = "owner" | "guest";

export interface Session {
  token: string;
  expiresAt: Date;
  role: SessionRole;
}

/** Anything that can read: the database or an open transaction. */
type Reader = Pick<Db, "get">;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function storedHash(ex: Reader): string | undefined {
  const row = ex.get<{ value: string }>(sql`SELECT value FROM app_settings WHERE key = ${PASSWORD_KEY}`);
  return row?.value;
}

export function isBootstrapped(db: Db): boolean {
  return storedHash(db) !== undefined;
}

function createSession({ db, clock, config }: Deps, role: SessionRole): Session {
  const token = randomBytes(32).toString("base64url");
  const now = clock.now().getTime();
  const expiresAt = new Date(now + config.sessionTtlMs);
  // Expired sessions are useless; clearing them here keeps the table from only ever growing.
  db.transaction((tx) => {
    tx.run(sql`DELETE FROM sessions WHERE expires_at <= ${now}`);
    tx.run(
      sql`INSERT INTO sessions (id, created_at, expires_at, role) VALUES (${hashToken(token)}, ${now}, ${expiresAt.getTime()}, ${role})`,
    );
  });
  return { token, expiresAt, role };
}

/** Sets the server password on first run. */
export async function bootstrap(deps: Deps, password: string): Promise<Session> {
  const hash = await hashPassword(password);
  deps.db.transaction((tx) => {
    if (storedHash(tx) !== undefined) throw conflict("The server has already been set up");
    tx.run(sql`INSERT INTO app_settings (key, value) VALUES (${PASSWORD_KEY}, ${hash})`);
  });
  return createSession(deps, "owner");
}

export async function login(deps: Deps, password: string): Promise<Session> {
  const hash = storedHash(deps.db);
  if (!hash) throw conflict("The server has not been set up yet");
  if (!(await verifyPassword(password, hash))) throw unauthorized("Invalid password", { code: "INVALID_CREDENTIALS" });
  return createSession(deps, "owner");
}

/** A read-only session; the caller must have checked `config.demoMode`. */
export function guest(deps: Deps): Session {
  return createSession(deps, "guest");
}

export function logout(db: Db, tokenHash: string): void {
  db.run(sql`DELETE FROM sessions WHERE id = ${tokenHash}`);
}

/** Replaces the password and revokes every session except the caller's. */
export async function changePassword(deps: Deps, tokenHash: string, current: string, next: string): Promise<void> {
  const hash = storedHash(deps.db);
  if (!hash || !(await verifyPassword(current, hash))) {
    throw unauthorized("Current password is incorrect", { code: "INVALID_CREDENTIALS" });
  }
  const nextHash = await hashPassword(next);
  deps.db.transaction((tx) => {
    tx.run(sql`UPDATE app_settings SET value = ${nextHash} WHERE key = ${PASSWORD_KEY}`);
    tx.run(sql`DELETE FROM sessions WHERE id <> ${tokenHash}`);
  });
}

export function sessionRole(db: Db, tokenHash: string, now: Date): SessionRole | null {
  const row = db.get<{ role: SessionRole }>(
    sql`SELECT role FROM sessions WHERE id = ${tokenHash} AND expires_at > ${now.getTime()}`,
  );
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
