import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { categories } from "./categories.table.ts";

/** `amount` is signed cents: negative is money out. The balance is their sum. */
export const transactions = sqliteTable(
  "transactions",
  {
    id: text().primaryKey(),
    title: text().notNull(),
    amount: integer().notNull(),
    currency: text({ enum: ["USD"] })
      .notNull()
      .default("USD"),
    date: text().notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("transactions_date_idx").on(t.date),
    index("transactions_category_date_idx").on(t.categoryId, t.date),
    check("transactions_amount_check", sql`${t.amount} <> 0`),
    check("transactions_currency_check", sql`${t.currency} IN ('USD')`),
  ],
);
