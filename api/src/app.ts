import { PluginHost } from "@esauflores/plugin-sdk";
import { Hono } from "hono";

import { authRoutes, blockGuestWrites, requireSession, type AuthEnv } from "@api/core/auth/routes.ts";
import { createAuthTables } from "@api/core/auth/service.ts";
import type { Client } from "@api/core/db.ts";
import { type Clock, type Config, type CoreHookBus, createDeps, type Deps } from "@api/core/deps.ts";
import { onError, onNotFound } from "@api/core/http.ts";
import { Routes } from "@api/core/kernel.ts";
import type { CflowHooks, CflowPlugin, CflowServices } from "@api/plugins/api.ts";
import { ledgerPlugin } from "@api/plugins/ledger/index.ts";
import { checkPluginName, pluginOptions } from "@api/plugins/loader.ts";

import pkg from "../../package.json" with { type: "json" };

const CFLOW_VERSION = pkg.version;
/** Plugins declare the CFlow major version they target. */
const PLUGIN_API_VERSION = Number(pkg.version.split(".")[0]);

/** The core plugins, always registered before any other. */
function corePlugins(deps: Deps): CflowPlugin[] {
  return [ledgerPlugin(deps)] as CflowPlugin[];
}

export interface CflowOptions {
  db: Client;
  clock: Clock;
  config: Config;
  /** Plugin objects to add after the built-in modules, optionally with options (default `{}`). */
  plugins?: readonly (CflowPlugin | readonly [CflowPlugin, unknown])[];
  /** Read for `CFLOW_PLUGIN_<NAME>_<KEY>` settings of the packages in `config.plugins`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Composition root: a plugin host with the built-in modules, extra plugins and
 * the packages listed in CFLOW_PLUGINS, set up and started. Any plugin failure
 * stops startup: a misconfigured plugin is an installation error.
 */
export async function startCflow(options: CflowOptions) {
  const { db, clock, config } = options;
  const host = new PluginHost<CflowHooks, CflowServices>({
    // `name` is the plugin manifest key (`"cflow"` in plugin package.json), so it
    // stays `cflow`: the plugin contract, not the product name.
    app: { name: "cflow", version: CFLOW_VERSION },
    apiVersion: PLUGIN_API_VERSION,
    failure: "strict",
    hookErrors: "log",
  });
  await createAuthTables(db);
  const routes = new Routes();
  // Core raises hooks with opaque payloads; plugins see them typed (plugins/api.ts).
  const deps = createDeps(db, clock, config, host.hooks as unknown as CoreHookBus);

  host.provide("db", db);
  host.provide("clock", clock);
  host.provide("routes", routes);

  for (const plugin of corePlugins(deps)) host.register(plugin);
  for (const entry of options.plugins ?? []) {
    const [plugin, pluginOpts] = Array.isArray(entry) ? entry : [entry, {}];
    checkPluginName(plugin.name);
    host.register(plugin, pluginOpts);
  }
  const env = options.env ?? process.env;
  await host.load(config.plugins.map((spec) => [spec, pluginOptions(spec, env)] as const));
  for (const plugin of host.list()) if (plugin.source !== "inline") checkPluginName(plugin.name);

  await host.start();
  return { host, deps, app: createApp(deps, routes) };
}

/** Mounts the kernel's auth routes, then every route plugins registered under /api, behind the session check. */
function createApp(deps: Deps, routes: Routes) {
  const app = new Hono();
  app.onError(onError);
  app.notFound(onNotFound);

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/api/auth", authRoutes(deps));

  const api = new Hono<AuthEnv>();
  api.use("*", requireSession(deps));
  // Reads are open to guests; every write under /api needs the owner session.
  api.use("*", blockGuestWrites);
  for (const mount of routes.mounts) api.route(mount.path, mount.app);
  app.route("/api", api);

  return app;
}
