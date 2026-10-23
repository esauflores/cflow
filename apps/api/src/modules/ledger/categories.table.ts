import { sql } from "drizzle-orm";
import { check, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const CATEGORY_TYPES = ["INCOME", "EXPENSE"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const categories = sqliteTable(
  "categories",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    type: text({ enum: CATEGORY_TYPES }).notNull(),
    color: text().notNull(),
  },
  (t) => [
    uniqueIndex("categories_type_name_idx").on(t.type, sql`lower(${t.name})`),
    check("categories_type_check", sql`${t.type} IN ('INCOME', 'EXPENSE')`),
  ],
);
