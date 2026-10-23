import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Vite+ checks and tests the code: `vp check` formats, lints and type-checks server/, apps/api and apps/web, each with
 * its tsconfig.json (all extend the root's; web swaps Bun's types for DOM and JSX). `vp test` runs the server tests (a
 * production bundle of the page, on Bun), the api tests (no DOM) and the web tests (headless Chromium, through
 * Playwright), each test file on a database of its own, in memory. Serving and bundling the web app is Bun's job, not
 * Vite's (server/, with Tailwind as a Bun plugin, see its bunfig.toml).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@api": path("./apps/api/src"),
      "@web": path("./apps/web/src"),
    },
  },
  test: {
    // CFlow's first run seeds its categories, and its i18n module is on unless CFLOW_PLUGINS says otherwise.
    env: { DATABASE_PATH: ":memory:", CFLOW_PLUGINS: "core,i18n" },
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          root: path("./server"),
        },
      },
      {
        extends: true,
        test: {
          name: "api",
          root: path("./apps/api"),
        },
      },
      {
        extends: true,
        test: {
          name: "web",
          root: path("./apps/web"),
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
  fmt: {
    tabWidth: 2,
    printWidth: 120,
    sortImports: {
      order: "asc",
      newlinesBetween: true,
      internalPattern: ["@api/", "@web/"],
      groups: [["builtin", "external"], "internal", ["parent", "sibling", "index"], "style", "unknown"],
    },
  },
  lint: {
    categories: { correctness: "error" },
    env: { builtin: true },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      { files: ["server/**", "apps/api/**", "*.ts"], env: { node: true } },
      { files: ["apps/web/**"], env: { browser: true } },
      // Vendored shadcn sources: fire-and-forget animations and Intl format getters.
      {
        files: ["apps/web/src/components/ui/**"],
        rules: {
          "typescript/no-floating-promises": "off",
          "typescript/unbound-method": "off",
        },
      },
    ],
  },
});
