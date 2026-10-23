import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createQueryClient, getToken, setToken } from "@web/lib/api.ts";
import { AuthGate } from "@web/pages/Login.tsx";

import { mockApi } from "./fetch.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setToken(null);
  history.replaceState({}, "", "/");
});

describe("/demo", () => {
  it("enters with a guest session without showing the login form", async () => {
    history.replaceState({}, "", "/demo");
    const calls = mockApi({
      "GET /auth/status": () => ({
        body: { bootstrapped: true, demoMode: true, plugins: ["core"] },
      }),
      "POST /auth/guest": () => ({
        body: { token: "guest-token", expiresAt: "2026-11-22T09:30:00.000Z", guest: true },
      }),
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <AuthGate>
          <p>demo app</p>
        </AuthGate>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("demo app")).toBeDefined();
    expect(getToken()).toBe("guest-token");
    expect(calls.some((c) => c.key === "POST /auth/guest")).toBe(true);
  });

  it("says the demo is unavailable when the server doesn't allow guests", async () => {
    history.replaceState({}, "", "/demo");
    const calls = mockApi({
      "GET /auth/status": () => ({
        body: { bootstrapped: true, demoMode: false, plugins: ["core"] },
      }),
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <AuthGate>
          <p>demo app</p>
        </AuthGate>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("The demo is not available on this server.")).toBeDefined();
    expect(calls.some((c) => c.key === "POST /auth/guest")).toBe(false);
  });
});
