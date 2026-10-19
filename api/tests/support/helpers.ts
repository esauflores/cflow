import { startCflow } from "@api/app.ts";
import { type Client, openDatabase } from "@api/core/db.ts";
import { type Clock, type Deps, loadConfig } from "@api/core/deps.ts";
import { dateIn } from "@api/core/lib/dates.ts";
import type { CflowPlugin } from "@api/plugins/api.ts";

export const PASSWORD = "correct horse battery";

interface TestClock extends Clock {
  set(iso: string): void;
}

function testClock(iso: string, timeZone = "UTC"): TestClock {
  let current = new Date(iso);
  return {
    now: () => current,
    today: () => dateIn(current, timeZone),
    set: (next) => {
      current = new Date(next);
    },
  };
}

export interface Harness {
  db: Client;
  clock: TestClock;
  deps: Deps;
  host: Awaited<ReturnType<typeof startCflow>>["host"];
  request(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  /** Like `request`, but asserts a 2xx and returns the envelope's `data`. */
  data<T = any>(method: string, path: string, body?: unknown): Promise<T>;
  token: string;
}

/** A fresh in-memory server, bootstrapped and logged in. */
export async function setup(
  options: {
    now?: string;
    bootstrap?: boolean;
    plugins?: readonly (CflowPlugin | readonly [CflowPlugin, unknown])[];
    /** Plugin packages to load, as in CFLOW_PLUGINS. */
    load?: string[];
    /** Whether guest (read-only) sessions are allowed. */
    allowGuest?: boolean;
    /** Whether a proxy's X-Forwarded-For names the client (TRUST_PROXY). */
    trustProxy?: boolean;
    env?: Record<string, string>;
  } = {},
): Promise<Harness> {
  const db = await openDatabase(":memory:");
  const clock = testClock(options.now ?? "2026-03-15T12:00:00Z");
  const config = {
    ...loadConfig({}),
    databasePath: ":memory:",
    plugins: options.load ?? [],
    allowGuest: options.allowGuest ?? false,
    trustProxy: options.trustProxy ?? false,
  };
  const { host, deps, app } = await startCflow({
    db,
    clock,
    config,
    plugins: options.plugins,
    env: options.env ?? {},
  });

  const harness: Harness = {
    db,
    clock,
    deps,
    host,
    token: "",
    async request(method, path, body, headers = {}) {
      const auto: Record<string, string> = {};
      if (harness.token) auto.Authorization = `Bearer ${harness.token}`;
      if (body !== undefined) auto["Content-Type"] = "application/json";
      return app.request(path, {
        method,
        headers: { ...auto, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    async data(method, path, body) {
      const res = await harness.request(method, path, body);
      const text = await res.text();
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
      }
      return text ? JSON.parse(text).data : undefined;
    },
  };

  if (options.bootstrap !== false) {
    const res = await harness.request("POST", "/api/auth/bootstrap", { password: PASSWORD });
    harness.token = ((await res.json()) as { data: { token: string } }).data.token;
  }
  return harness;
}

/** Looks up a default category's id by name and type. */
export async function categoryId(h: Harness, name: string, type: "EXPENSE" | "INCOME"): Promise<string> {
  const all = await h.data<{ id: string; name: string; type: string }[]>("GET", "/api/categories");
  const found = all.find((c) => c.name === name && c.type === type);
  if (!found) throw new Error(`No ${type} category ${name}`);
  return found.id;
}

/** A transaction body; amounts are signed, negative for money out. */
export function txBody(categoryId: string, overrides: Record<string, unknown> = {}) {
  return { title: "Groceries", amount: -10, date: "2026-03-15", categoryId, ...overrides };
}

export async function balanceOf(h: Harness): Promise<number> {
  return (await h.data<{ balance: number }>("GET", "/api/balance")).balance;
}
