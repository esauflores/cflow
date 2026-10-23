import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { api, createQueryClient } from "@web/lib/api.ts";
import { chooseLanguage, locale, setLanguage, t } from "@web/lib/i18n.ts";
import { formatDate, formatMoney } from "@web/lib/utils.ts";
import { AuthGate } from "@web/pages/Login.tsx";

import { mockApi } from "./fetch.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  setLanguage("en");
});

describe("i18n", () => {
  it("reads as written in English, and translates with placeholders once messages arrive", () => {
    expect(t("of {amount} income", { amount: "$5" })).toBe("of $5 income");
    setLanguage("es", { "of {amount} income": "de {amount} de ingresos" });
    expect(t("of {amount} income", { amount: "$5" })).toBe("de $5 de ingresos");
    expect(t("Not translated")).toBe("Not translated");
    expect(document.documentElement.lang).toBe("es");
  });

  it("shows the API's messages in the language, values included, and its own when the server is unreachable", async () => {
    setLanguage("es", {
      'There is already an {type} category named "{name}"': 'Ya existe una categoría de {type} llamada "{name}"',
      expense: "gasto",
      Food: "Comida",
      "Couldn't reach the server": "No se pudo conectar con el servidor",
    });
    mockApi({
      "POST /categories": () => ({
        status: 409,
        body: {
          code: "CONFLICT",
          message: 'There is already an expense category named "Food"',
          template: 'There is already an {type} category named "{name}"',
          params: { type: "expense", name: "Food" },
        },
      }),
    });
    await expect(api.categories.create({ name: "food", type: "EXPENSE" })).rejects.toThrow(
      'Ya existe una categoría de gasto llamada "Comida"',
    );

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(api.balance()).rejects.toThrow("No se pudo conectar con el servidor");
  });

  it("formats dates and dollars for the language", () => {
    expect(formatDate("2026-10-18")).toBe("Oct 18, 2026");
    setLanguage("es", {});
    expect(locale()).toBe("es-US");
    expect(formatDate("2026-10-18")).toBe("18 oct 2026");
    expect(formatMoney(-1234.5)).toBe("−$1,234.50");
  });

  it("speaks the picked language from the login screen on, and English when the plugin is off", async () => {
    chooseLanguage("es");
    let plugins = ["core", "i18n"];
    mockApi({
      "GET /auth/status": () => ({ body: { bootstrapped: true, allowGuest: false, plugins } }),
      "GET /plugins/i18n/es": () => ({ body: { language: "es", messages: { "Welcome back": "Hola de nuevo" } } }),
    });
    const view = () => (
      <QueryClientProvider client={createQueryClient()}>
        <AuthGate>
          <p>Inside the app</p>
        </AuthGate>
      </QueryClientProvider>
    );
    render(view());
    await waitFor(() => expect(t("Welcome back")).toBe("Hola de nuevo"));
    cleanup();

    plugins = ["core"];
    render(view());
    await waitFor(() => expect(t("Welcome back")).toBe("Welcome back"));
  });

  it("follows the browser's language until one is picked", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["es-MX", "en"]);
    mockApi({
      "GET /auth/status": () => ({ body: { bootstrapped: true, allowGuest: false, plugins: ["core", "i18n"] } }),
      "GET /plugins/i18n/es": () => ({ body: { language: "es", messages: { "Welcome back": "Hola de nuevo" } } }),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <AuthGate>
          <p>Inside the app</p>
        </AuthGate>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(t("Welcome back")).toBe("Hola de nuevo"));
  });
});
