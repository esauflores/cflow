import { vi } from "vite-plus/test";

type Handler = (body: unknown) => { status?: number; body?: unknown };

/**
 * Replaces fetch with canned API responses keyed by "METHOD /path" (path
 * without /api and without the query string). Returns the calls made.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace(/^\/api/, "").split("?")[0];
      const key = `${init.method ?? "GET"} ${path}`;
      // The client only ever sends JSON strings.
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ key, url, body, headers: (init.headers ?? {}) as Record<string, string> });
      const handler = routes[key];
      if (!handler) return new Response(JSON.stringify({ message: `No mock for ${key}` }), { status: 500 });
      const { status = 200, body: data } = handler(body);
      if (status === 204) return new Response(null, { status });
      const envelope = status < 400 ? { success: true, data } : { success: false, ...(data as object) };
      return new Response(JSON.stringify(envelope), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}
