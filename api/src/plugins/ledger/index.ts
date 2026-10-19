import { Hono } from "hono";

import type { Deps } from "@api/core/deps.ts";
import { defineCorePlugin } from "@api/core/kernel.ts";
import {
  CATEGORIES_INDEXES,
  CATEGORIES_TABLE,
  categoryRoutes,
  migrateCategoryColors,
  seedCategories,
} from "@api/plugins/ledger/categories.ts";
import { ledgerFacade, type LedgerFacade } from "@api/plugins/ledger/facade.ts";
import { TRANSACTIONS_INDEXES, TRANSACTIONS_TABLE, transactionRoutes } from "@api/plugins/ledger/transactions.ts";

// The ledger, the core plugin: the account's transactions and categories.
// This file is its public surface.

export type { LedgerFacade } from "@api/plugins/ledger/facade.ts";
export type { TransactionView } from "@api/plugins/ledger/transactions.ts";

export function ledgerPlugin(deps: Deps) {
  return defineCorePlugin<{ ledger: LedgerFacade }>()({
    name: "ledger",
    async setup(ctx) {
      // Like any plugin, the ledger creates its own tables.
      await deps.db.batch(
        [CATEGORIES_TABLE, TRANSACTIONS_TABLE, ...CATEGORIES_INDEXES, ...TRANSACTIONS_INDEXES],
        "write",
      );
      await migrateCategoryColors(deps.db);
      ctx
        .use("routes")
        .mount("/", new Hono().route("/", transactionRoutes(deps)).route("/categories", categoryRoutes(deps)));
      ctx.provide("ledger", ledgerFacade(deps));
    },
    async start() {
      await seedCategories(deps.db);
    },
  });
}
