import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { type Client, type Executor, all, first } from "@api/core/db.ts";
import type { Deps } from "@api/core/deps.ts";
import { badRequest, conflict, notFound, ok, validate } from "@api/core/http.ts";
import type { Cents } from "@api/core/lib/money.ts";

export const CATEGORY_TYPES = ["INCOME", "EXPENSE"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const CATEGORIES_TABLE = `CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
  color TEXT NOT NULL
)`;

/** One name per type, ignoring case. */
export const CATEGORIES_INDEXES = [
  "CREATE UNIQUE INDEX IF NOT EXISTS categories_type_name_idx ON categories (type, lower(name))",
];

/** Each type's fallback: it takes the transactions of deleted categories, so it can't be renamed or deleted. */
const FALLBACK_CATEGORY = "Other";

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
export async function requireCategoryFor(ex: Executor, id: string, amount: Cents): Promise<Category> {
  const category = await first<Category>(ex, { sql: `SELECT ${COLUMNS} FROM categories WHERE id = ?`, args: [id] });
  if (!category) throw notFound("Category not found");
  const type = typeOf(amount);
  if (category.type !== type) {
    throw badRequest(
      `An ${type === "EXPENSE" ? "outflow" : "inflow"} needs an ${type} category, but "${category.name}" is ${category.type}`,
    );
  }
  return category;
}

/** Every category with `usage`, how many transactions use it, so clients can put the common ones first. */
export async function listCategories(ex: Executor) {
  const rows = await all<Category & { usage: number }>(
    ex,
    `SELECT c.id, c.name, c.type, c.color, count(t.id) AS usage
     FROM categories c LEFT JOIN transactions t ON t.category_id = c.id
     GROUP BY c.id ORDER BY c.type, c.name`,
  );
  return rows.map(categoryView);
}

const categoryName = z.string().trim().min(1, "Enter a name").max(50);

/** A six-digit hex colour, e.g. "#3b82f6". */
const categoryColor = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a hex colour like #3b82f6");

export const categorySchema = z.object({
  name: categoryName,
  type: z.enum(CATEGORY_TYPES),
  color: categoryColor.optional(),
});

export const updateCategorySchema = z
  .object({ name: categoryName.optional(), color: categoryColor.optional() })
  .refine((input) => input.name !== undefined || input.color !== undefined, { message: "Nothing to update" });

async function requireCategory(ex: Executor, id: string): Promise<Category> {
  const category = await first<Category>(ex, { sql: `SELECT ${COLUMNS} FROM categories WHERE id = ?`, args: [id] });
  if (!category) throw notFound("Category not found");
  return category;
}

function requireNotFallback(category: Category, action: string) {
  if (category.name === FALLBACK_CATEGORY) {
    throw badRequest(`"${FALLBACK_CATEGORY}" can't be ${action}: it takes the transactions of deleted categories`);
  }
}

async function requireUniqueName(ex: Executor, name: string, type: CategoryType, exceptId = "") {
  const taken = await first(ex, {
    sql: "SELECT 1 FROM categories WHERE type = ? AND lower(name) = lower(?) AND id <> ?",
    args: [type, name, exceptId],
  });
  if (taken) throw conflict(`There is already an ${type.toLowerCase()} category named "${name}"`);
}

/** The first palette colour that type isn't using yet, so new categories stay distinct. */
async function nextColor(ex: Executor, type: CategoryType): Promise<string> {
  const rows = await all<{ color: string }>(ex, { sql: "SELECT color FROM categories WHERE type = ?", args: [type] });
  const used = new Set(rows.map((row) => row.color));
  return CATEGORY_PALETTE.find((color) => !used.has(color)) ?? NEUTRAL_COLOR;
}

export async function createCategory(ex: Executor, input: z.output<typeof categorySchema>) {
  await requireUniqueName(ex, input.name, input.type);
  const row = await first<Category>(ex, {
    sql: `INSERT INTO categories (id, name, type, color) VALUES (?, ?, ?, ?) RETURNING ${COLUMNS}`,
    args: [randomUUID(), input.name, input.type, input.color ?? (await nextColor(ex, input.type))],
  });
  return categoryView(row!);
}

export async function updateCategory(ex: Executor, id: string, input: z.output<typeof updateCategorySchema>) {
  const category = await requireCategory(ex, id);
  if (input.name !== undefined && input.name !== category.name) {
    requireNotFallback(category, "renamed");
    await requireUniqueName(ex, input.name, category.type, id);
  }
  const next = { ...category, name: input.name ?? category.name, color: input.color ?? category.color };
  await ex.execute({
    sql: "UPDATE categories SET name = ?, color = ? WHERE id = ?",
    args: [next.name, next.color, id],
  });
  return categoryView(next);
}

/** Deletes a category, moving its transactions to that type's "Other". */
export async function deleteCategory(client: Client, id: string): Promise<{ moved: number }> {
  const category = await requireCategory(client, id);
  requireNotFallback(category, "deleted");
  const fallback = await first<{ id: string }>(client, {
    sql: "SELECT id FROM categories WHERE type = ? AND name = ?",
    args: [category.type, FALLBACK_CATEGORY],
  });
  if (!fallback)
    throw conflict(`No "${FALLBACK_CATEGORY}" ${category.type.toLowerCase()} category to move transactions to`);
  const [moved] = await client.batch(
    [
      { sql: "UPDATE transactions SET category_id = ? WHERE category_id = ?", args: [fallback.id, id] },
      { sql: "DELETE FROM categories WHERE id = ?", args: [id] },
    ],
    "write",
  );
  return { moved: moved!.rowsAffected };
}

const SYSTEM_CATEGORIES: { name: string; type: CategoryType; color: string }[] = [
  { name: "Food", type: "EXPENSE", color: "#ef4444" },
  { name: "Housing", type: "EXPENSE", color: "#3b82f6" },
  { name: "Bills", type: "EXPENSE", color: "#f59e0b" },
  { name: "Transport", type: "EXPENSE", color: "#06b6d4" },
  { name: "Shopping", type: "EXPENSE", color: "#ec4899" },
  { name: "Health", type: "EXPENSE", color: "#10b981" },
  { name: "Fun", type: "EXPENSE", color: "#8b5cf6" },
  { name: "Other", type: "EXPENSE", color: NEUTRAL_COLOR },
  { name: "Salary", type: "INCOME", color: "#10b981" },
  { name: "Freelance", type: "INCOME", color: "#3b82f6" },
  { name: "Investment", type: "INCOME", color: "#8b5cf6" },
  { name: "Other", type: "INCOME", color: NEUTRAL_COLOR },
];

/** Inserts the built-in categories into a fresh database. */
export async function seedCategories(client: Client): Promise<void> {
  if (await first(client, "SELECT 1 FROM categories LIMIT 1")) return;
  await client.batch(
    SYSTEM_CATEGORIES.map((c) => ({
      sql: "INSERT INTO categories (id, name, type, color) VALUES (?, ?, ?, ?)",
      args: [randomUUID(), c.name, c.type, c.color],
    })),
    "write",
  );
}

/** Adds `color` to databases created before categories stored one, backfilling the built-ins. */
export async function migrateCategoryColors(client: Client): Promise<void> {
  const columns = await all<{ name: string }>(client, "PRAGMA table_info(categories)");
  if (columns.some((column) => column.name === "color")) return;
  await client.execute(`ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '${NEUTRAL_COLOR}'`);
  for (const category of SYSTEM_CATEGORIES) {
    await client.execute({
      sql: "UPDATE categories SET color = ? WHERE type = ? AND name = ?",
      args: [category.color, category.type, category.name],
    });
  }
}

const idParam = z.object({ id: z.uuid() });

export function categoryRoutes({ db }: Deps) {
  return new Hono()
    .get("/", async (c) => ok(c, "Categories retrieved", await listCategories(db)))
    .post("/", validate("json", categorySchema), async (c) =>
      ok(c, "Category created", await createCategory(db, c.req.valid("json")), 201),
    )
    .patch("/:id", validate("param", idParam), validate("json", updateCategorySchema), async (c) =>
      ok(c, "Category updated", await updateCategory(db, c.req.valid("param").id, c.req.valid("json"))),
    )
    .delete("/:id", validate("param", idParam), async (c) =>
      ok(c, "Category deleted", await deleteCategory(db, c.req.valid("param").id)),
    );
}
