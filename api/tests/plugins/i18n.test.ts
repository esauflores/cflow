import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { es } from "@api/plugins/i18n/es.ts";

import { setup } from "../support/helpers.ts";

const WEB_SRC = join(import.meta.dirname, "..", "..", "..", "web", "src");
const API_SRC = join(import.meta.dirname, "..", "..", "src");

/** A quoted string, as a regex source: group `q` is the quote, `text` what's inside. */
const QUOTED = String.raw`(?<q>["'\`])(?<text>(?:\\.|(?!\k<q>).)*)\k<q>`;

/** The texts `patterns` find in every .ts/.tsx file under `dir` (skipping `skip`). */
function texts(dir: string, patterns: RegExp[], skip?: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (path === skip) return [];
    if (entry.isDirectory()) return texts(path, patterns, skip);
    if (!/\.tsx?$/.test(entry.name)) return [];
    const source = readFileSync(path, "utf8");
    return patterns.flatMap((pattern) =>
      [...source.matchAll(pattern)].map((m) => m.groups!.text!.replace(/\\(.)/g, "$1")),
    );
  });
}

/** Every literal the web app passes to `t()`, and the messages it makes up itself. */
const webTexts = () =>
  texts(WEB_SRC, [new RegExp(String.raw`\bt\(` + QUOTED, "g"), new RegExp(String.raw`\bmessage: ` + QUOTED, "g")]);

/**
 * Every message the API sends: error helpers' first argument, zod check messages, the envelope's own
 * messages and zod's defaults (http.ts).
 */
const apiTexts = () =>
  texts(
    API_SRC,
    [
      new RegExp(String.raw`\b(?:badRequest|conflict|notFound|unauthorized|forbidden)\(\s*` + QUOTED, "g"),
      new RegExp(String.raw`\bmessage(?::\s*|\()` + QUOTED, "g"),
      new RegExp(String.raw`\.(?:min|max|regex)\([^)]*?,\s*` + QUOTED + String.raw`\)`, "g"),
      new RegExp(String.raw`throwIfLimited\([^;]*?` + QUOTED + String.raw`\)`, "g"),
      new RegExp(String.raw`\breturn ` + QUOTED + ";", "g"),
    ],
    join(API_SRC, "plugins", "i18n"),
  ).filter((text) => /^[A-Z"]/.test(text));

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n plugin", () => {
  it("is listed in the status when enabled", async () => {
    const h = await setup({ enable: ["core", "i18n"] });
    expect((await h.data("GET", "/api/auth/status")).plugins).toEqual(["core", "i18n"]);
  });

  it("serves each language's messages without a session, for the login screen", async () => {
    const h = await setup({ enable: ["core", "i18n"] });
    h.token = "";
    expect(await h.data("GET", "/api/plugins/i18n")).toEqual({ languages: ["en", "es"] });
    expect(await h.data("GET", "/api/plugins/i18n/en")).toEqual({ language: "en", messages: {} });
    const spanish = await h.data("GET", "/api/plugins/i18n/es");
    expect(spanish.messages.Dashboard).toBe("Inicio");
    expect((await h.request("GET", "/api/plugins/i18n/fr")).status).toBe(400);
    // Public routes stay apart: the rest of /api still needs a session.
    expect((await h.request("GET", "/api/transactions")).status).toBe(401);
  });

  it("isn't there unless enabled", async () => {
    const h = await setup();
    expect((await h.request("GET", "/api/plugins/i18n/es")).status).toBe(404);
  });

  it("translates every text in the web app and every message the API sends, keeping placeholders", () => {
    const all = [...new Set([...webTexts(), ...apiTexts()])];
    expect(webTexts().length).toBeGreaterThan(100);
    expect(apiTexts().length).toBeGreaterThan(30);
    expect(all.filter((text) => !(text in es))).toEqual([]);
    expect(all.filter((text) => text in es && placeholders(text).join() !== placeholders(es[text]!).join())).toEqual(
      [],
    );
    // Words the API puts into its messages' placeholders.
    expect(["expense", "income", "renamed", "deleted", "Other"].filter((word) => !(word in es))).toEqual([]);
  });
});
