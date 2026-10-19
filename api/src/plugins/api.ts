import { definePluginFor, type Plugin } from "@esauflores/plugin-sdk";

import type { HookName } from "@api/core/deps.ts";
import type { KernelServices } from "@api/core/kernel.ts";
import type { LedgerFacade, TransactionView } from "@api/plugins/core/index.ts";

/**
 * The plugin contract, on top of `@esauflores/plugin-sdk`. Everything a plugin
 * may rely on is exported from this file; anything else in the API is internal.
 */

/** What each hook delivers. Hooks fire after the change is committed. */
interface HookPayloads {
  "transaction.created": TransactionView;
  "transaction.updated": TransactionView;
  /** The transaction as it was before deletion. */
  "transaction.deleted": TransactionView;
}

// Indexing HookPayloads by every core hook name stops compiling if a hook
// is added in core without a payload type here.
export type CflowHooks = { [K in HookName]: (payload: HookPayloads[K]) => unknown };

/**
 * `db`, `clock` and `routes` come from the host and need no `dependsOn`.
 * `ledger` is the service of the `core` plugin: list "core" in `dependsOn` to `use`
 * it. Read any table through `db`, but write core data through `ledger` so it
 * is validated and raises hooks. By contract a plugin mounts its
 * routes under `/plugins/<name>` and only touches tables prefixed `<name>_`;
 * core data goes through the module services.
 */
export interface CflowServices extends KernelServices {
  ledger: LedgerFacade;
}

/** The response envelope and request validation, so plugin routes answer like core ones. */
export { ok, validate } from "@api/core/http.ts";

export type CflowPlugin<Options = any, Input = Options> = Plugin<Options, CflowHooks, CflowServices, Input>;

/** @public For plugin packages: `definePlugin({ name, setup, … })`. */
export const definePlugin = definePluginFor<CflowHooks, CflowServices>();
