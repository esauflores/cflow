import { describe, expect, it } from "vite-plus/test";

import { createApp } from "@api/app.ts";

describe("i18n", () => {
  it("serves the languages and the Spanish messages without a session", async () => {
    const app = createApp();

    const languages = (await (await app.request("/api/plugins/i18n")).json()) as {
      data: { languages: string[] };
    };
    expect(languages.data.languages).toEqual(["en", "es"]);

    const messages = (await (await app.request("/api/plugins/i18n/es")).json()) as {
      data: { language: string; messages: Record<string, string> };
    };
    expect(messages.data.language).toBe("es");
    expect(messages.data.messages.Dashboard).toBe("Inicio");
    expect(messages.data.messages["Log out"]).toBe("Cerrar sesión");
  });

  it("answers 400 for a language it doesn't have", async () => {
    const app = createApp();

    const response = await app.request("/api/plugins/i18n/fr");
    expect(response.status).toBe(400);
    expect((await response.json()) as { code: string }).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
