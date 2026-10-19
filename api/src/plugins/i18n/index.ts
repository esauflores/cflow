import { Hono } from "hono";
import { z } from "zod";

import { definePlugin, ok, validate } from "@api/plugins/api.ts";
import { es } from "@api/plugins/i18n/es.ts";

// Languages for the web app. The app's text is English; this plugin serves the other languages'
// messages (English text → translation). Which language to use is each browser's choice, so the
// routes are public: the login screen needs them before there is a session, and nothing in them is
// private.

const LANGUAGES = ["en", "es"] as const;

const MESSAGES: Record<(typeof LANGUAGES)[number], Record<string, string>> = { en: {}, es };

export const i18nPlugin = definePlugin({
  name: "i18n",
  setup(ctx) {
    ctx.use("routes").mount(
      `/plugins/${ctx.name}`,
      new Hono()
        .get("/", (c) => ok(c, { languages: LANGUAGES }))
        .get("/:language", validate("param", z.object({ language: z.enum(LANGUAGES) })), (c) => {
          const { language } = c.req.valid("param");
          return ok(c, { language, messages: MESSAGES[language] });
        }),
      { public: true },
    );
  },
});
