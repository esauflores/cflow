import type { MiddlewareHandler } from "hono";

/**
 * Logs each request once it's answered, one line: `GET /api/transactions 200 3ms`. Paths in `skip` aren't logged
 * (/api/health, which uptime checks call every few seconds).
 */
export function requestLogger({ skip = [] }: { skip?: string[] } = {}): MiddlewareHandler {
  return async (c, next) => {
    if (skip.includes(c.req.path)) return next();
    const start = performance.now();
    await next();
    console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - start)}ms`);
  };
}
