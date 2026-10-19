import { describe, expect, it } from "vitest";

import { loadConfig } from "@api/core/deps.ts";

describe("config", () => {
  it("reads defaults and switches", () => {
    const config = loadConfig({ ALLOW_GUEST: "yes", TRUST_PROXY: "1" });
    expect(config).toMatchObject({ port: 5173, allowGuest: true, trustProxy: true });
    expect(loadConfig({}).trustProxy).toBe(false);
  });

  it("refuses numbers that aren't positive whole numbers", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ SESSION_TTL_DAYS: "0" })).toThrow(/SESSION_TTL_DAYS/);
    expect(loadConfig({ PORT: "8080", SESSION_TTL_DAYS: "7" })).toMatchObject({
      port: 8080,
      sessionTtlMs: 7 * 86_400_000,
    });
  });
});
