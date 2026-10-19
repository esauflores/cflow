import devServer from "@hono/vite-dev-server";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/** Every path except /api: the dev server leaves these to Vite (it only has "skip", no "only"). */
const notApi = /^(?!\/api(\/|\?|$))/;

// Vite keeps .env out of process.env; load it so PORT and the API's settings
// (DATABASE_PATH, CFLOW_PLUGINS, …) apply to `vp dev` too.
if (existsSync(".env")) process.loadEnvFile(".env");

// One config for both apps: `vp dev` / `vp build` serve and bundle web/, and
// `vp test` runs the api and web test projects. Each app keeps its own
// tsconfig.json (Node types vs. DOM and JSX).
export default defineConfig({
  root: path("./web"),
  plugins: [
    react(),
    tailwindcss(),
    // `vp dev` also serves the API: /api goes to the Hono app in api/src/dev.ts, everything else stays with
    // Vite. Left out of the test runs, which start their own app per test.
    ...(process.env.VITEST
      ? []
      : [
          devServer({
            entry: path("./api/src/dev.ts"),
            exclude: [notApi],
            injectClientScript: false,
          }),
        ]),
  ],
  resolve: {
    alias: {
      "@api": path("./api/src"),
      "@web": path("./web/src"),
    },
  },
  server: {
    port: Number(process.env.PORT ?? 5173),
  },
  // `vp pack` bundles the production server into dist/server.mjs (dependencies stay external), so
  // production runs plain JavaScript: `bun dist/server.mjs`.
  pack: {
    entry: { server: path("./api/src/node.ts") },
    tsconfig: path("./api/tsconfig.json"),
    outDir: path("./dist"),
  },
  test: {
    projects: [
      { extends: true, test: { name: "api", root: path("./api"), environment: "node" } },
      {
        extends: true,
        test: {
          name: "web",
          root: path("./web"),
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
    categories: {
      correctness: "error",
    },
    env: {
      builtin: true,
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      { files: ["api/**", "*.ts"], env: { node: true } },
      { files: ["web/**"], env: { browser: true } },
      // Vendored shadcn sources: fire-and-forget animations and Intl format getters.
      {
        files: ["web/src/components/ui/**"],
        rules: {
          "typescript/no-floating-promises": "off",
          "typescript/unbound-method": "off",
        },
      },
    ],
  },
});
