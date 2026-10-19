const NAME_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

/** The plugin that is always enabled. */
const CORE_PLUGIN = "core";

/**
 * The plugins CFLOW_PLUGINS turns on, `core` first. Fails on a missing `core`, a name that isn't
 * one of `available`, or a name listed twice: each is an installation error.
 */
export function enabledPlugins(names: readonly string[], available: readonly string[]): string[] {
  const unknown = names.filter((name) => !available.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown plugin ${unknown.map((n) => `"${n}"`).join(", ")} in CFLOW_PLUGINS; available: ${available.join(", ")}`,
    );
  }
  const repeated = names.filter((name, i) => names.indexOf(name) !== i);
  if (repeated.length > 0) throw new Error(`CFLOW_PLUGINS lists "${repeated[0]}" more than once`);
  if (!names.includes(CORE_PLUGIN)) throw new Error(`CFLOW_PLUGINS must include "${CORE_PLUGIN}"`);
  return [CORE_PLUGIN, ...names.filter((name) => name !== CORE_PLUGIN)];
}

/** Plugin names namespace routes, tables and settings, so they must be plain identifiers. */
export function checkPluginName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid plugin name "${name}": use 2-32 lowercase letters, digits or "_", starting with a letter`);
  }
}

/** A plugin's settings: `CFLOW_PLUGIN_<NAME>_<KEY>` variables, keyed by `<KEY>`. */
export function pluginOptions(name: string, env: NodeJS.ProcessEnv): Record<string, string> {
  const prefix = `CFLOW_PLUGIN_${name.toUpperCase()}_`;
  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => entry[0].startsWith(prefix) && entry[1] !== undefined)
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
}
