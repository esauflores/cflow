import { describe, expect, it } from "vite-plus/test";

import { createApp } from "@api/app.ts";

import { call, ownerSession, PASSWORD } from "../support/helpers.ts";

describe("auth", () => {
  it("reports that a fresh server is not bootstrapped, then logs in", async () => {
    const app = createApp();
    const status = (await (await app.request("/api/auth/status")).json()) as {
      data: { bootstrapped: boolean; plugins: string[] };
    };
    expect(status.data.bootstrapped).toBe(false);
    expect(status.data.plugins).toContain("core");

    const bootstrap = await app.request("/api/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(bootstrap.status).toBe(201);

    const again = await app.request("/api/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(again.status).toBe(409);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const body = (await login.json()) as { data: { token: string; guest: boolean } };
    expect(login.status).toBe(200);
    expect(body.data.guest).toBe(false);
    expect(body.data.token).toEqual(expect.any(String));
  });

  it("rejects a wrong password and unauthenticated ledger calls", async () => {
    const { app } = await ownerSession();

    const wrong = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "not the password" }),
    });
    expect(wrong.status).toBe(401);

    const response = await app.request("/api/transactions");
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code: string; success: false; path: string };
    expect(body).toMatchObject({ success: false, code: "UNAUTHORIZED", path: "/api/transactions" });
  });

  it("lets a guest read but not write when DEMO_MODE is on", async () => {
    process.env.DEMO_MODE = "true";
    const { app } = await ownerSession();
    const guest = await app.request("/api/auth/guest", { method: "POST" });
    const body = (await guest.json()) as { data: { token: string; guest: boolean } };
    expect(guest.status).toBe(200);
    expect(body.data.guest).toBe(true);

    expect((await call(app, body.data.token, "GET", "/api/transactions")).status).toBe(200);
    expect((await call(app, body.data.token, "POST", "/api/transactions", {})).status).toBe(403);
    delete process.env.DEMO_MODE;
  });

  it("changes the password, ending the other sessions", async () => {
    const { app, token } = await ownerSession();
    const second = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    const other = ((await second.json()) as { data: { token: string } }).data.token;

    const changed = await call(app, token, "POST", "/api/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: "a brand new password",
    });
    expect(changed.status).toBe(200);
    expect((await call(app, other, "GET", "/api/transactions")).status).toBe(401);
    expect((await call(app, token, "GET", "/api/transactions")).status).toBe(200);
  });
});
