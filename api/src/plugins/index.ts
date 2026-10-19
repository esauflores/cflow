import type { Deps } from "@api/core/deps.ts";
import type { CflowPlugin } from "@api/plugins/api.ts";
import { corePlugin } from "@api/plugins/core/index.ts";

/** Builds a plugin; only `core` uses the app's dependencies, the rest work through `ctx`. */
export type PluginFactory = (deps: Deps) => CflowPlugin;

/**
 * Every plugin in this folder, by name. To add one, create `plugins/<name>/` and list it here;
 * CFLOW_PLUGINS then turns it on.
 */
export const PLUGINS: Record<string, PluginFactory> = {
  core: (deps) => corePlugin(deps) as CflowPlugin,
};
