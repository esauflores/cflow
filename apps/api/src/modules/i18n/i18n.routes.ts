import { createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

import { createRouter, envelope } from "@api/core/openapi.ts";
import { es } from "@api/modules/i18n/es.ts";

// Languages for the web app. The app's text is English; this module serves the other languages' messages (English
// text → translation). Which language to use is each browser's choice, so the routes are public: the login screen
// needs them before there is a session, and nothing in them is private.

const LANGUAGES = ["en", "es"] as const;

const MESSAGES: Record<(typeof LANGUAGES)[number], Record<string, string>> = { en: {}, es };

const LanguagesSchema = z.object({ languages: z.array(z.enum(LANGUAGES)) }).openapi("Languages");

const MessagesSchema = z
  .object({
    language: z.enum(LANGUAGES),
    messages: z.record(z.string(), z.string()),
  })
  .openapi("LanguageMessages");

const LanguagesRoute = createRoute({
  method: "get",
  path: "/",
  summary: "The languages this server offers",
  responses: {
    200: { content: { "application/json": { schema: envelope(LanguagesSchema) } }, description: "The languages" },
  },
});

const MessagesRoute = createRoute({
  method: "get",
  path: "/{language}",
  summary: "One language's messages, keyed by the English text",
  request: {
    params: z.object({
      language: z.enum(LANGUAGES).openapi({ param: { name: "language", in: "path" } }),
    }),
  },
  responses: {
    200: { content: { "application/json": { schema: envelope(MessagesSchema) } }, description: "The messages" },
    400: { content: { "application/json": { schema: z.object({}) } }, description: "Unknown language" },
  },
});

export function i18nRoutes() {
  return createRouter()
    .openapi(LanguagesRoute, (c) => c.json({ success: true as const, data: { languages: [...LANGUAGES] } }, 200))
    .openapi(MessagesRoute, (c) => {
      const { language } = c.req.valid("param");
      return c.json({ success: true as const, data: { language, messages: MESSAGES[language] } }, 200);
    });
}
