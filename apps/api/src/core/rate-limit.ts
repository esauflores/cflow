import type { Context } from "hono";
import { rateLimiter, type Store } from "hono-rate-limiter";

/** The Bun server, which server.ts passes as the API's env. */
interface BunServerEnv {
  requestIP?: (req: Request) => { address: string } | null;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  skip?: (c: Context) => boolean;
  store?: Store;
  message?: string | Record<string, unknown>;
}

/**
 * The client's IP. Behind a proxy (`TRUST_PROXY=true`), the last `X-Forwarded-For` address, the one the proxy added;
 * otherwise the connection's. "unknown" without either, as in tests.
 */
export function clientIp(c: Context, trustProxy = false): string {
  const forwarded = trustProxy && c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (forwarded) return forwarded;
  const server = c.env as BunServerEnv | undefined;
  return server?.requestIP?.(c.req.raw)?.address ?? "unknown";
}

/**
 * A rate limit per client IP: past it, `429` with `Retry-After`. Each call keeps its own counts, in memory; with
 * several instances, pass a shared `store` (hono-rate-limiter's `RedisStore`).
 */
export function rateLimit({ limit, windowMs, skip, store, message }: RateLimitOptions) {
  return rateLimiter({
    limit,
    windowMs,
    skip,
    store,
    keyGenerator: (c) => clientIp(c, process.env.TRUST_PROXY === "true"),
    message: message ?? { error: "Too many requests, please try again later" },
  });
}
