import { Hono } from "hono";

import type { Deps } from "@api/core/deps.ts";
import { defineCorePlugin } from "@api/core/kernel.ts";
import {
  CATEGORIES_INDEXES,
  CATEGORIES_TABLE,
  categoryRoutes,
  createDefaultCategories,
} from "@api/plugins/core/categories.ts";
import { ledgerFacade, type LedgerFacade } from "@api/plugins/core/facade.ts";
import { TRANSACTIONS_INDEXES, TRANSACTIONS_TABLE, transactionRoutes } from "@api/plugins/core/transactions.ts";

// The core plugin: the account's transactions and categories, provided to other plugins as the
// `ledger` service. Always enabled. This file is its public surface.

export type { LedgerFacade } from "@api/plugins/core/facade.ts";
export type { TransactionView } from "@api/plugins/core/transactions.ts";

export function corePlugin(deps: Deps) {
  return defineCorePlugin<{ ledger: LedgerFacade }>()({
    name: "core",
    async setup(ctx) {
      // Like any plugin, it creates its own tables; a new database also gets the default categories.
      await deps.db.batch(
        [CATEGORIES_TABLE, TRANSACTIONS_TABLE, ...CATEGORIES_INDEXES, ...TRANSACTIONS_INDEXES],
        "write",
      );
      await createDefaultCategories(deps.db);
      ctx
        .use("routes")
        .mount("/", new Hono().route("/", transactionRoutes(deps)).route("/categories", categoryRoutes(deps)));
      ctx.provide("ledger", ledgerFacade(deps));
    },
  });
}
