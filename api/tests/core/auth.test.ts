import { describe, expect, it } from "vitest";

import { PASSWORD, setup } from "../support/helpers.ts";

describe("auth", () => {
  it("reports and performs first-run setup once", async () => {
    const h = await setup({ bootstrap: false });
    expect(await h.data("GET", "/api/auth/status")).toEqual({ bootstrapped: false, allowGuest: false });

    const short = await h.request("POST", "/api/auth/bootstrap", { password: "short" });
    expect(short.status).toBe(400);

    const created = await h.request("POST", "/api/auth/bootstrap", { password: PASSWORD });
    expect(created.status).toBe(201);
    expect(await h.data("GET", "/api/auth/status")).toEqual({ bootstrapped: true, allowGuest: false });

    const again = await h.request("POST", "/api/auth/bootstrap", { password: PASSWORD });
    expect(again.status).toBe(409);
  });

  it("protects the API and accepts tokens from login", async () => {
    const h = await setup();
    const bootstrapToken = h.token;
    h.token = "";
    expect((await h.request("GET", "/api/transactions")).status).toBe(401);

    const bad = await h.request("POST", "/api/auth/login", { password: "wrong password" });
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { code: string }).code).toBe("INVALID_CREDENTIALS");

    const { token } = await h.data("POST", "/api/auth/login", { password: PASSWORD });
    h.token = token;
    expect((await h.request("GET", "/api/transactions")).status).toBe(200);

    h.token = bootstrapToken;
    expect((await h.request("GET", "/api/transactions")).status).toBe(200);
  });

  it("refuses guest sessions when ALLOW_GUEST is off", async () => {
    const h = await setup();
    expect((await h.request("POST", "/api/auth/guest")).status).toBe(403);
    // An owner session is explicitly not a guest.
    expect(await h.data("POST", "/api/auth/login", { password: PASSWORD })).toMatchObject({ guest: false });
  });

  it("lets a guest read but not write when ALLOW_GUEST is on", async () => {
    const h = await setup({ allowGuest: true });
    const session = await h.data<{ token: string; guest: boolean }>("POST", "/api/auth/guest");
    expect(session.guest).toBe(true);

    h.token = session.token;
    expect((await h.request("GET", "/api/transactions")).status).toBe(200);
    expect((await h.request("POST", "/api/categories", { name: "Pets", type: "EXPENSE" })).status).toBe(403);
    expect(
      (
        await h.request("POST", "/api/auth/change-password", {
          currentPassword: PASSWORD,
          newPassword: "another password",
        })
      ).status,
    ).toBe(403);
  });

  it("rate limits repeated failed logins", async () => {
    const h = await setup();
    h.token = "";
    for (let i = 0; i < 5; i++) {
      expect((await h.request("POST", "/api/auth/login", { password: "nope nope" })).status).toBe(401);
    }
    const blocked = await h.request("POST", "/api/auth/login", { password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();

    h.clock.set("2026-03-15T12:16:00Z");
    expect((await h.request("POST", "/api/auth/login", { password: PASSWORD })).status).toBe(200);
  });

  it("behind a trusted proxy, limits each client by the address the proxy appended", async () => {
    const h = await setup({ trustProxy: true });
    h.token = "";
    const login = (password: string, forwardedFor: string) =>
      h.request("POST", "/api/auth/login", { password }, { "X-Forwarded-For": forwardedFor });
    for (let i = 0; i < 5; i++) expect((await login("nope nope", "203.0.113.9")).status).toBe(401);
    expect((await login(PASSWORD, "203.0.113.9")).status).toBe(429);
    // A forged entry before the proxy's doesn't change who the client is.
    expect((await login(PASSWORD, "198.51.100.1, 203.0.113.9")).status).toBe(429);
    // Another client is unaffected.
    expect((await login(PASSWORD, "198.51.100.7")).status).toBe(200);
  });

  it("limits how many guest sessions one client can open", async () => {
    const h = await setup({ allowGuest: true });
    h.token = "";
    for (let i = 0; i < 10; i++) expect((await h.request("POST", "/api/auth/guest")).status).toBe(200);
    const blocked = await h.request("POST", "/api/auth/guest");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("clears expired sessions when a new one starts", async () => {
    const h = await setup();
    const count = async () => (await h.db.execute("SELECT count(*) AS n FROM sessions")).rows[0]!.n;
    expect(await count()).toBe(1);
    h.clock.set("2026-04-20T12:00:00Z");
    await h.data("POST", "/api/auth/login", { password: PASSWORD });
    expect(await count()).toBe(1);
  });

  it("expires sessions after their lifetime", async () => {
    const h = await setup();
    h.clock.set("2026-04-20T12:00:00Z");
    expect((await h.request("GET", "/api/transactions")).status).toBe(401);
  });

  it("logs out and revokes other sessions on password change", async () => {
    const h = await setup();
    const first = h.token;
    const { token: second } = await h.data("POST", "/api/auth/login", { password: PASSWORD });

    h.token = second;
    const changed = await h.request("POST", "/api/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: "a brand new password",
    });
    expect(changed.status).toBe(200);
    expect((await h.request("GET", "/api/transactions")).status).toBe(200);

    h.token = first;
    expect((await h.request("GET", "/api/transactions")).status).toBe(401);

    h.token = second;
    expect((await h.request("POST", "/api/auth/logout")).status).toBe(204);
    expect((await h.request("GET", "/api/transactions")).status).toBe(401);
  });
});
