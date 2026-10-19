import { PluginHost } from "@esauflores/plugin-sdk";
import { Hono } from "hono";

import { authRoutes, blockGuestWrites, requireSession, type AuthEnv } from "@api/core/auth/routes.ts";
import { createAuthTables } from "@api/core/auth/service.ts";
import type { Client } from "@api/core/db.ts";
import { type Clock, type Config, type CoreHookBus, createDeps, type Deps } from "@api/core/deps.ts";
import { onError, onNotFound } from "@api/core/http.ts";
import { Routes } from "@api/core/kernel.ts";
import type { CflowHooks, CflowServices } from "@api/plugins/api.ts";
import { PLUGINS, type PluginFactory } from "@api/plugins/index.ts";
import { checkPluginName, enabledPlugins, pluginOptions } from "@api/plugins/loader.ts";

import pkg from "../../package.json" with { type: "json" };

const CFLOW_VERSION = pkg.version;

export interface CflowOptions {
  db: Client;
  clock: Clock;
  config: Config;
  /** Plugins to offer besides the ones in `plugins/`, by name; tests add their fixtures this way. */
  extraPlugins?: Record<string, PluginFactory>;
  /** Read for each enabled plugin's `CFLOW_PLUGIN_<NAME>_<KEY>` settings. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Composition root: a plugin host with the plugins CFLOW_PLUGINS enables (`core` first), set up
 * and started. Any plugin failure stops startup: a misconfigured plugin is an installation error.
 */
export async function startCflow(options: CflowOptions) {
  const { db, clock, config } = options;
  const host = new PluginHost<CflowHooks, CflowServices>({
    app: { name: "cflow", version: CFLOW_VERSION },
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

  const extra = Object.keys(options.extraPlugins ?? {}).filter((name) => name in PLUGINS);
  if (extra.length > 0) throw new Error(`Plugin "${extra[0]}" is already registered`);
  const available: Record<string, PluginFactory> = { ...PLUGINS, ...options.extraPlugins };
  const env = options.env ?? process.env;
  for (const name of enabledPlugins(config.plugins, Object.keys(available))) {
    const plugin = available[name]!(deps);
    checkPluginName(plugin.name);
    if (plugin.name !== name) throw new Error(`Plugin listed as "${name}" is named "${plugin.name}"`);
    host.register(plugin, pluginOptions(name, env));
  }

  await host.start();
  return { host, deps, app: createApp(deps, routes) };
}

/**
 * Mounts the kernel's auth routes, then every route plugins registered under /api: public ones as they are,
 * the rest behind the session check.
 */
function createApp(deps: Deps, routes: Routes) {
  const app = new Hono();
  app.onError(onError);
  app.notFound(onNotFound);

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/api/auth", authRoutes(deps));
  for (const mount of routes.mounts) if (mount.public) app.route(`/api${mount.path}`, mount.app);

  const api = new Hono<AuthEnv>();
  api.use("*", requireSession(deps));
  // Reads are open to guests; every write under /api needs the owner session.
  api.use("*", blockGuestWrites);
  for (const mount of routes.mounts) if (!mount.public) api.route(mount.path, mount.app);
  app.route("/api", api);

  return app;
}
