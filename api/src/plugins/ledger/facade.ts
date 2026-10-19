import { z } from "zod";

import type { Deps } from "@api/core/deps.ts";
import { type PageInput, parseInput, toPageRequest } from "@api/core/http.ts";
import * as categories from "@api/plugins/ledger/categories.ts";
import * as transactions from "@api/plugins/ledger/transactions.ts";

// The ledger as plugins see it. Inputs take the same shape as the REST
// request bodies (decimal amounts) and go through the same validation, so a
// plugin can do exactly what an API client can, no more.

const id = z.uuid();

export function ledgerFacade(deps: Deps) {
  const { db, clock } = deps;
  return {
    balance: () => transactions.balance(db),
    /** The dashboard for `month` (`YYYY-MM`), this month by default. */
    summary: (month?: string) => transactions.summary(db, month ?? clock.today().slice(0, 7)),
    transactions: {
      list: (filter: z.input<typeof transactions.filterSchema> & PageInput = {}) =>
        transactions.listTransactions(
          db,
          parseInput(transactions.filterSchema, filter),
          toPageRequest(filter, transactions.TRANSACTION_SORTS, { sort: "date", direction: "desc" }),
        ),
      get: (transactionId: string) => transactions.getTransaction(db, parseInput(id, transactionId)),
      create: (input: z.input<typeof transactions.transactionSchema>) =>
        transactions.createTransaction(deps, parseInput(transactions.transactionSchema, input)),
      update: (transactionId: string, input: z.input<typeof transactions.transactionSchema>) =>
        transactions.updateTransaction(
          deps,
          parseInput(id, transactionId),
          parseInput(transactions.transactionSchema, input),
        ),
      delete: (transactionId: string) => transactions.deleteTransaction(deps, parseInput(id, transactionId)),
    },
    categories: {
      list: () => categories.listCategories(db),
      create: (input: z.input<typeof categories.categorySchema>) =>
        categories.createCategory(db, parseInput(categories.categorySchema, input)),
      update: (categoryId: string, input: z.input<typeof categories.updateCategorySchema>) =>
        categories.updateCategory(db, parseInput(id, categoryId), parseInput(categories.updateCategorySchema, input)),
      delete: (categoryId: string) => categories.deleteCategory(db, parseInput(id, categoryId)),
    },
  };
}

export type LedgerFacade = ReturnType<typeof ledgerFacade>;
