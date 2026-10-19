import { basename } from "node:path";

const NAME_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

/** Plugin names namespace routes, tables and settings, so they must be plain identifiers. */
export function checkPluginName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid plugin name "${name}": use 2-32 lowercase letters, digits or "_", starting with a letter`);
  }
}

/**
 * Settings for a plugin listed in CFLOW_PLUGINS, from `CFLOW_PLUGIN_<NAME>_<KEY>`
 * keyed by `<KEY>`. `<NAME>` comes from the specifier's last segment without a
 * `cflow-plugin-` prefix: `@acme/cflow-plugin-notes` and `./plugins/notes` are both NOTES.
 */
export function pluginOptions(specifier: string, env: NodeJS.ProcessEnv): Record<string, string> {
  const name = basename(specifier)
    .replace(/^cflow-plugin-/, "")
    .replace(/[^a-z0-9]/gi, "_")
    .toUpperCase();
  const prefix = `CFLOW_PLUGIN_${name}_`;
  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[0].startsWith(prefix) && entry[1] !== undefined)
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
}
