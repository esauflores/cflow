import { createRoute } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";

import type { Deps } from "@api/core/deps.ts";
import { AppError, forbidden, unauthorized } from "@api/core/errors.ts";
import { createRouter, envelope, errorResponse } from "@api/core/openapi.ts";
import { clientIp } from "@api/core/rate-limit.ts";
import {
  ChangePasswordBodySchema,
  NewPasswordSchema,
  PasswordBodySchema,
  SessionSchema,
  SetupBodySchema,
  StatusSchema,
} from "@api/modules/auth/auth.schemas.ts";
import * as auth from "@api/modules/auth/auth.service.ts";

export type AuthEnv = { Variables: { sessionId: string; role: auth.SessionRole } };

const LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60_000;
/** Guest sessions one client may open per window: each is a stored row. */
const GUEST_SESSIONS = 10;
const GUEST_WINDOW_MS = 15 * 60_000;

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
    const role = auth.sessionRole(db, sessionId, clock.now());
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

/** Answers 429 with `Retry-After` while `waitMs` is above zero. */
function throwIfLimited(c: Context, waitMs: number, text: string): void {
  if (waitMs <= 0) return;
  c.header("Retry-After", String(Math.ceil(waitMs / 1000)));
  throw new AppError(429, "TOO_MANY_REQUESTS", text);
}

const sessionBody = (s: auth.Session) => ({
  token: s.token,
  expiresAt: s.expiresAt.toISOString(),
  guest: s.role === "guest",
});

const json = (schema: Parameters<typeof envelope>[0], description: string) => ({
  content: { "application/json": { schema } },
  description,
});

export function authRoutes(deps: Deps) {
  const limiter = new AttemptLimiter(LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
  const guestLimiter = new AttemptLimiter(GUEST_SESSIONS, GUEST_WINDOW_MS);
  const session = requireSession(deps);

  const status = createRoute({
    method: "get",
    path: "/status",
    summary: "Whether the server is set up, and which modules are on",
    responses: {
      200: json(envelope(StatusSchema), "The server's state"),
    },
  });

  const bootstrap = createRoute({
    method: "post",
    path: "/bootstrap",
    summary: "Set the server password, once",
    request: { body: { content: { "application/json": { schema: SetupBodySchema } }, required: true } },
    responses: {
      201: json(envelope(SessionSchema), "The first owner session"),
      400: errorResponse,
      409: errorResponse,
    },
  });

  const login = createRoute({
    method: "post",
    path: "/login",
    summary: "Log in with the server password",
    request: { body: { content: { "application/json": { schema: PasswordBodySchema } }, required: true } },
    responses: {
      200: json(envelope(SessionSchema), "An owner session"),
      400: errorResponse,
      401: errorResponse,
      409: errorResponse,
      429: errorResponse,
    },
  });

  const guestRoute = createRoute({
    method: "post",
    path: "/guest",
    summary: "Enter with a read-only guest session, when DEMO_MODE is on",
    responses: {
      200: json(envelope(SessionSchema), "A guest session"),
      403: errorResponse,
      409: errorResponse,
      429: errorResponse,
    },
  });

  const logout = createRoute({
    method: "post",
    path: "/logout",
    summary: "End this session",
    responses: { 204: { description: "The session ended" } },
  });

  const changePassword = createRoute({
    method: "post",
    path: "/change-password",
    summary: "Replace the password and end every other session",
    request: {
      body: { content: { "application/json": { schema: ChangePasswordBodySchema } }, required: true },
    },
    responses: {
      200: json(envelope(NewPasswordSchema.nullable()), "The password changed"),
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
    },
  });

  function privateRoutes(deps: Deps, session: MiddlewareHandler<AuthEnv>) {
    const router = createRouter<AuthEnv>();
    router.use("*", session);
    router.openapi(logout, (c) => {
      auth.logout(deps.db, c.get("sessionId"));
      return c.body(null, 204);
    });
    router.use("*", blockGuestWrites);
    router.openapi(changePassword, async (c) => {
      const { currentPassword, newPassword } = c.req.valid("json");
      await auth.changePassword(deps, c.get("sessionId"), currentPassword, newPassword);
      return c.json({ success: true as const, data: null }, 200);
    });
    return router;
  }

  return createRouter()
    .openapi(status, (c) =>
      c.json(
        {
          success: true as const,
          data: {
            bootstrapped: auth.isBootstrapped(deps.db),
            demoMode: deps.config.demoMode,
            // Enabled modules, so the web app can offer what they add (e.g. a language choice).
            plugins: deps.config.plugins,
          },
        },
        200,
      ),
    )
    .openapi(bootstrap, async (c) => {
      const created = await auth.bootstrap(deps, c.req.valid("json").password);
      return c.json({ success: true as const, data: sessionBody(created) }, 201);
    })
    .openapi(login, async (c) => {
      const key = clientIp(c, deps.config.trustProxy);
      const now = deps.clock.now().getTime();
      throwIfLimited(c, limiter.retryAfter(key, now), "Too many failed login attempts, try again later");
      try {
        const created = await auth.login(deps, c.req.valid("json").password);
        limiter.reset(key);
        return c.json({ success: true as const, data: sessionBody(created) }, 200);
      } catch (err) {
        if (err instanceof AppError && err.code === "INVALID_CREDENTIALS") limiter.fail(key, now);
        throw err;
      }
    })
    .openapi(guestRoute, (c) => {
      if (!deps.config.demoMode) throw forbidden("Demo mode is disabled");
      if (!auth.isBootstrapped(deps.db)) throw new AppError(409, "CONFLICT", "The server has not been set up yet");
      const key = clientIp(c, deps.config.trustProxy);
      const now = deps.clock.now().getTime();
      throwIfLimited(c, guestLimiter.retryAfter(key, now), "Too many guest sessions, try again later");
      guestLimiter.fail(key, now);
      return c.json({ success: true as const, data: sessionBody(auth.guest(deps)) }, 200);
    })
    .route("/", privateRoutes(deps, session));
}
