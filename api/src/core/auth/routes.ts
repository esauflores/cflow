import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import * as auth from "@api/core/auth/service.ts";
import type { Deps } from "@api/core/deps.ts";
import { AppError, conflict, forbidden, ok, unauthorized, validate } from "@api/core/http.ts";

export type AuthEnv = { Variables: { sessionId: string; role: auth.SessionRole } };

const password = z.string().min(8, "Password must be at least 8 characters").max(256);
const LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60_000;

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match?.[1];
}

/** Rejects requests without a live session token. */
export function requireSession({ db, clock }: Deps): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token) throw unauthorized("Authentication required");
    const sessionId = auth.hashToken(token);
    const role = await auth.sessionRole(db, sessionId, clock.now());
    if (!role) throw unauthorized("Session expired or invalid");
    c.set("sessionId", sessionId);
    c.set("role", role);
    await next();
  };
}

/** Blocks writes from a guest session: guests may look, not touch. */
export const blockGuestWrites: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.req.method !== "GET" && c.get("role") !== "owner") throw forbidden("Guests have read-only access");
  await next();
};

function clientKey(c: Parameters<MiddlewareHandler>[0]): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Fixed-window attempt counter, kept in memory (single-instance server). */
class AttemptLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(max: number, windowMs: number) {
    this.#max = max;
    this.#windowMs = windowMs;
  }

  /** Milliseconds until `key` may try again, or 0 if it is not blocked. */
  retryAfter(key: string, now: number): number {
    const entry = this.#attempts.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.count >= this.#max ? entry.resetAt - now : 0;
  }

  fail(key: string, now: number): void {
    const entry = this.#attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      this.#attempts.set(key, { count: 1, resetAt: now + this.#windowMs });
    } else {
      entry.count += 1;
    }
  }

  reset(key: string): void {
    this.#attempts.delete(key);
  }
}

export function authRoutes(deps: Deps) {
  const limiter = new AttemptLimiter(LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
  const session = requireSession(deps);
  const sessionBody = (s: auth.Session) => ({ token: s.token, expiresAt: s.expiresAt, guest: s.role === "guest" });

  return new Hono<AuthEnv>()
    .get("/status", async (c) =>
      ok(c, "Server status retrieved", {
        bootstrapped: await auth.isBootstrapped(deps.db),
        allowGuest: deps.config.allowGuest,
      }),
    )
    .post("/bootstrap", validate("json", z.object({ password })), async (c) => {
      const created = await auth.bootstrap(deps, c.req.valid("json").password);
      return ok(c, "Server set up", sessionBody(created), 201);
    })
    .post("/login", validate("json", z.object({ password: z.string().min(1).max(256) })), async (c) => {
      const key = clientKey(c);
      const now = deps.clock.now().getTime();
      const wait = limiter.retryAfter(key, now);
      if (wait > 0) {
        c.header("Retry-After", String(Math.ceil(wait / 1000)));
        throw new AppError(429, "TOO_MANY_REQUESTS", "Too many failed login attempts, try again later");
      }
      try {
        const created = await auth.login(deps, c.req.valid("json").password);
        limiter.reset(key);
        return ok(c, "Logged in", sessionBody(created));
      } catch (err) {
        if (err instanceof AppError && err.code === "INVALID_CREDENTIALS") limiter.fail(key, now);
        throw err;
      }
    })
    .post("/guest", async (c) => {
      if (!deps.config.allowGuest) throw forbidden("Guest access is disabled");
      if (!(await auth.isBootstrapped(deps.db))) throw conflict("The server has not been set up yet");
      return ok(c, "Entered as guest", sessionBody(await auth.guest(deps)));
    })
    .post("/logout", session, async (c) => {
      await auth.logout(deps.db, c.get("sessionId"));
      return c.body(null, 204);
    })
    .post(
      "/change-password",
      session,
      blockGuestWrites,
      validate("json", z.object({ currentPassword: z.string().min(1).max(256), newPassword: password })),
      async (c) => {
        const { currentPassword, newPassword } = c.req.valid("json");
        await auth.changePassword(deps, c.get("sessionId"), currentPassword, newPassword);
        return ok(c, "Password changed", null);
      },
    );
}
