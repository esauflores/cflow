import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { z } from "zod";

import type { Db } from "@api/core/deps.ts";
import { badRequest, conflict, notFound } from "@api/core/errors.ts";
import type { Cents } from "@api/core/money.ts";
import {
  type CategoryType,
  CategoryInputSchema,
  CategoryUpdateSchema,
} from "@api/modules/ledger/categories.schemas.ts";

export { CATEGORY_TYPES, type CategoryType } from "@api/modules/ledger/categories.schemas.ts";

/** Each type's fallback: it takes the transactions of deleted categories, so it can't be renamed or deleted. */
export const FALLBACK_CATEGORY = "Other";

/** Colour for "Other" and any category whose colour is unknown. */
const NEUTRAL_COLOR = "#6b7280";

/** Colours offered by the client and handed to new categories, in order. */
const CATEGORY_PALETTE = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
];

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  color: string;
}

const COLUMNS = "id, name, type, color";

function categoryView(c: Category & { usage?: number }) {
  return { id: c.id, name: c.name, type: c.type, color: c.color, usage: c.usage ?? 0 };
}

/** The category type an amount belongs to: money out is an expense, money in an income. */
export const typeOf = (amount: Cents): CategoryType => (amount < 0 ? "EXPENSE" : "INCOME");

/** Loads a category and checks it matches the amount's direction. */
export function requireCategoryFor(db: Db, id: string, amount: Cents): Category {
  const category = db.get<Category>(sql`SELECT ${sql.raw(COLUMNS)} FROM categories WHERE id = ${id}`);
  if (!category) throw notFound("Category not found");
  const type = typeOf(amount);
  if (category.type !== type) {
    throw badRequest('This needs an {type} category, but "{name}" is an {actual} category', {
      params: { type: type.toLowerCase(), name: category.name, actual: category.type.toLowerCase() },
    });
  }
  return category;
}

/** Every category with `usage`, how many transactions use it, so clients can put the common ones first. */
export function listCategories(db: Db) {
  const rows = db.all<Category & { usage: number }>(
    sql`SELECT c.id, c.name, c.type, c.color, count(t.id) AS usage
     FROM categories c LEFT JOIN transactions t ON t.category_id = c.id
     GROUP BY c.id ORDER BY c.type, c.name`,
  );
  return rows.map(categoryView);
}

function requireCategory(db: Db, id: string): Category {
  const category = db.get<Category>(sql`SELECT ${sql.raw(COLUMNS)} FROM categories WHERE id = ${id}`);
  if (!category) throw notFound("Category not found");
  return category;
}

function requireNotFallback(category: Category, action: "renamed" | "deleted") {
  if (category.name === FALLBACK_CATEGORY) {
    throw badRequest(`"{name}" can't be {action}: it takes the transactions of deleted categories`, {
      params: { name: FALLBACK_CATEGORY, action },
    });
  }
}

function requireUniqueName(db: Db, name: string, type: CategoryType, exceptId = "") {
  const taken = db.get(
    sql`SELECT 1 FROM categories WHERE type = ${type} AND lower(name) = lower(${name}) AND id <> ${exceptId}`,
  );
  if (taken) {
    throw conflict('There is already an {type} category named "{name}"', {
      params: { type: type.toLowerCase(), name },
    });
  }
}

/** The first palette colour that type isn't using yet, so new categories stay distinct. */
function nextColor(db: Db, type: CategoryType): string {
  const rows = db.all<{ color: string }>(sql`SELECT color FROM categories WHERE type = ${type}`);
  const used = new Set(rows.map((row) => row.color));
  return CATEGORY_PALETTE.find((color) => !used.has(color)) ?? NEUTRAL_COLOR;
}

export function createCategory(db: Db, input: z.output<typeof CategoryInputSchema>) {
  requireUniqueName(db, input.name, input.type);
  const row = db.get<Category>(
    sql`INSERT INTO categories (id, name, type, color) VALUES (${randomUUID()}, ${input.name}, ${input.type}, ${
      input.color ?? nextColor(db, input.type)
    }) RETURNING ${sql.raw(COLUMNS)}`,
  );
  return categoryView(row!);
}

export function updateCategory(db: Db, id: string, input: z.output<typeof CategoryUpdateSchema>) {
  const category = requireCategory(db, id);
  if (input.name !== undefined && input.name !== category.name) {
    requireNotFallback(category, "renamed");
    requireUniqueName(db, input.name, category.type, id);
  }
  const next = { ...category, name: input.name ?? category.name, color: input.color ?? category.color };
  db.run(sql`UPDATE categories SET name = ${next.name}, color = ${next.color} WHERE id = ${id}`);
  return categoryView(next);
}

/** Deletes a category, moving its transactions to that type's "Other". */
export function deleteCategory(db: Db, id: string): { moved: number } {
  const category = requireCategory(db, id);
  requireNotFallback(category, "deleted");
  const fallback = db.get<{ id: string }>(
    sql`SELECT id FROM categories WHERE type = ${category.type} AND name = ${FALLBACK_CATEGORY}`,
  );
  if (!fallback)
    throw conflict('No "{name}" {type} category to move transactions to', {
      params: { name: FALLBACK_CATEGORY, type: category.type.toLowerCase() },
    });
  return db.transaction((tx) => {
    const moved = tx.run(sql`UPDATE transactions SET category_id = ${fallback.id} WHERE category_id = ${id}`);
    tx.run(sql`DELETE FROM categories WHERE id = ${id}`);
    return { moved: moved.changes };
  });
}

/** The categories every new database starts with; users rename, recolour or delete them like any other. */
const DEFAULT_CATEGORIES: { name: string; type: CategoryType; color: string }[] = [
  { name: "Food", type: "EXPENSE", color: "#ef4444" },
  { name: "Housing", type: "EXPENSE", color: "#3b82f6" },
  { name: "Bills", type: "EXPENSE", color: "#f59e0b" },
  { name: "Transport", type: "EXPENSE", color: "#06b6d4" },
  { name: "Shopping", type: "EXPENSE", color: "#ec4899" },
  { name: "Health", type: "EXPENSE", color: "#10b981" },
  { name: "Fun", type: "EXPENSE", color: "#8b5cf6" },
  { name: FALLBACK_CATEGORY, type: "EXPENSE", color: NEUTRAL_COLOR },
  { name: "Salary", type: "INCOME", color: "#10b981" },
  { name: "Freelance", type: "INCOME", color: "#3b82f6" },
  { name: "Investment", type: "INCOME", color: "#8b5cf6" },
  { name: FALLBACK_CATEGORY, type: "INCOME", color: NEUTRAL_COLOR },
];

/** Adds the default categories to a database that has none yet: a new one. */
export function seedDefaultCategories(db: Db): void {
  if (db.get(sql`SELECT 1 FROM categories LIMIT 1`)) return;
  db.transaction((tx) => {
    for (const c of DEFAULT_CATEGORIES) {
      tx.run(
        sql`INSERT INTO categories (id, name, type, color) VALUES (${randomUUID()}, ${c.name}, ${c.type}, ${c.color})`,
      );
    }
  });
}
