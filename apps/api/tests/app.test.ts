import { describe, expect, it } from "vite-plus/test";

import { createApp } from "@api/app.ts";

describe("app", () => {
  it("answers the health check, with security headers", async () => {
    const response = await createApp().request("/api/health");

    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("serves an OpenAPI document of the routes", async () => {
    const response = await createApp().request("/api/openapi.json");
    const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };

    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/api/transactions");
    expect(Object.keys(doc.paths)).toContain("/api/auth/login");
  });

  it("answers an unmatched route with CFlow's error envelope", async () => {
    const response = await createApp().request("/api/missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "RESOURCE_NOT_FOUND",
      message: "No route for GET /api/missing",
      path: "/api/missing",
    });
  });

  it("answers 413 for a body over MAX_BODY_BYTES", async () => {
    process.env.MAX_BODY_BYTES = "16";
    const response = await createApp().request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "20" },
      body: JSON.stringify({ password: "too long for this" }),
    });
    delete process.env.MAX_BODY_BYTES;

    expect(response.status).toBe(413);
  });
});
