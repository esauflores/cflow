import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { type Executor, all, first, inTransaction } from "@api/core/db.ts";
import type { Clock, Deps } from "@api/core/deps.ts";
import { badRequest, notFound, ok, pageOf, pageRequest, type PageRequest, validate } from "@api/core/http.ts";
import { addMonths, localDate } from "@api/core/lib/dates.ts";
import { type Cents, money, toAmount } from "@api/core/lib/money.ts";
import { CATEGORY_TYPES, type CategoryType, requireCategoryFor, typeOf } from "@api/plugins/core/categories.ts";

// The one account's transactions. Writes go through `createTransaction`,
// `updateTransaction` and `deleteTransaction`, which raise a hook after the
// commit, so plugins hear about every change however it was made.

/**
 * Supported currencies. USD only for now; the column and check stay so a
 * future international plugin only has to extend this list.
 */
const CURRENCIES = ["USD"] as const;

/** `amount` is signed cents: negative is money out. The balance is their sum. */
export const TRANSACTIONS_TABLE = `CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD')),
  date TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  created_at INTEGER NOT NULL
)`;

export const TRANSACTIONS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions (date)",
  "CREATE INDEX IF NOT EXISTS transactions_category_date_idx ON transactions (category_id, date)",
];

/** Largest amount accepted, 99,999,999.99: eight digits and two decimals, as the web form allows. */
const MAX_AMOUNT = 9_999_999_999;

const TEXT_PATTERN = /^[\p{L}0-9 .,'\-()!?&@#%/+:_]*$/u;

export const transactionSchema = z.object({
  title: z.string().trim().min(1).max(50).regex(TEXT_PATTERN, "Title contains invalid characters"),
  /** Negative is money out, positive money in. */
  amount: money({ min: 1, max: MAX_AMOUNT, signed: true }),
  date: localDate,
  /** Every transaction belongs to a category of its direction. */
  categoryId: z.uuid({ message: "Choose a category" }),
  currency: z.enum(CURRENCIES).default("USD"),
});

export type TransactionInput = z.output<typeof transactionSchema>;

export const filterSchema = z.object({
  query: z.string().max(100).optional(),
  type: z.enum(CATEGORY_TYPES).optional(),
  categoryId: z.uuid().optional(),
});

export const TRANSACTION_SORTS = ["date", "amount", "createdAt"] as const;
const SORT_COLUMNS: Record<(typeof TRANSACTION_SORTS)[number], string> = {
  date: "t.date",
  amount: "t.amount",
  createdAt: "t.created_at",
};

interface TransactionRow {
  id: string;
  title: string;
  amount: Cents;
  currency: string;
  date: string;
  createdAt: number;
  categoryId: string;
  categoryName: string;
  categoryType: CategoryType;
  categoryColor: string;
}

const SELECT = `SELECT t.id, t.title, t.amount, t.currency, t.date, t.created_at AS createdAt,
  c.id AS categoryId, c.name AS categoryName, c.type AS categoryType, c.color AS categoryColor
FROM transactions t JOIN categories c ON c.id = t.category_id`;

function transactionView(r: TransactionRow) {
  return {
    id: r.id,
    title: r.title,
    amount: toAmount(r.amount),
    type: typeOf(r.amount),
    currency: r.currency,
    date: r.date,
    category: {
      id: r.categoryId,
      name: r.categoryName,
      type: r.categoryType,
      color: r.categoryColor,
    },
    createdAt: new Date(r.createdAt),
  };
}

export type TransactionView = ReturnType<typeof transactionView>;

export async function getTransaction(ex: Executor, id: string): Promise<TransactionView> {
  const row = await first<TransactionRow>(ex, { sql: `${SELECT} WHERE t.id = ?`, args: [id] });
  if (!row) throw notFound("Transaction not found");
  return transactionView(row);
}

export async function listTransactions(
  ex: Executor,
  filter: z.output<typeof filterSchema>,
  page: PageRequest<(typeof TRANSACTION_SORTS)[number]>,
) {
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (filter.query) {
    // Title or category name; and when the query reads as a number ("$1,200", "-35.5"), the amount too,
    // compared as text without sign so "135" also finds $135.77.
    // `%` and `_` are LIKE wildcards; escape them (and the escape character) so they match literally.
    const literal = filter.query
      .trim()
      .toLowerCase()
      .replace(/[\\%_]/g, "\\$&");
    const text = `%${literal}%`;
    const matches = ["lower(t.title) LIKE ? ESCAPE '\\'", "lower(c.name) LIKE ? ESCAPE '\\'"];
    args.push(text, text);
    const number = filter.query.replace(/[\s$,+\-−]/g, "");
    if (/^\d+(\.\d{0,2})?$/.test(number)) {
      matches.push("printf('%.2f', abs(t.amount) / 100.0) LIKE ?");
      args.push(`%${number.endsWith(".") ? number.slice(0, -1) : number}%`);
    }
    conditions.push(`(${matches.join(" OR ")})`);
  }
  if (filter.type) conditions.push(filter.type === "EXPENSE" ? "t.amount < 0" : "t.amount > 0");
  if (filter.categoryId) {
    conditions.push("t.category_id = ?");
    args.push(filter.categoryId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const order = `${SORT_COLUMNS[page.sort]} ${page.direction === "asc" ? "ASC" : "DESC"}, t.created_at DESC, t.id`;
  const [rows, count] = await Promise.all([
    all<TransactionRow>(ex, {
      sql: `${SELECT} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      args: [...args, page.size, page.offset],
    }),
    first<{ total: number }>(ex, {
      sql: `SELECT count(*) AS total FROM transactions t JOIN categories c ON c.id = t.category_id ${where}`,
      args,
    }),
  ]);
  return pageOf(rows.map(transactionView), count?.total ?? 0, page);
}

/** The account balance: the sum of every transaction. */
export async function balance(ex: Executor): Promise<{ balance: number }> {
  const row = await first<{ total: number }>(ex, "SELECT coalesce(sum(amount), 0) AS total FROM transactions");
  return { balance: toAmount(row?.total ?? 0) };
}

export interface MonthTotals {
  /** `YYYY-MM`. */
  month: string;
  income: number;
  /** Money out, as a positive number. */
  spending: number;
}

export interface CategorySpending {
  id: string;
  name: string;
  amount: number;
  /** Percent of the month's spending, one decimal. */
  share: number;
}

/**
 * The dashboard for `month` (`YYYY-MM`): the balance at its end, its totals
 * and the previous month's, every month of its year, and where its spending
 * went by category. Months without transactions are zeros.
 */
export async function summary(ex: Executor, month: string) {
  const year = month.slice(0, 4);
  const previousMonth = addMonths(`${month}-01`, -1).slice(0, 7);
  const [rows, closing, byCategory] = await Promise.all([
    all<{ month: string; income: Cents; spending: Cents }>(ex, {
      sql: `SELECT substr(date, 1, 7) AS month,
          coalesce(sum(CASE WHEN amount > 0 THEN amount END), 0) AS income,
          coalesce(sum(CASE WHEN amount < 0 THEN -amount END), 0) AS spending
        FROM transactions WHERE substr(date, 1, 4) = ? OR substr(date, 1, 7) IN (?, ?)
        GROUP BY month`,
      args: [year, month, previousMonth],
    }),
    // "YYYY-MM-31" sorts after every date in the month.
    first<{ total: Cents }>(ex, {
      sql: "SELECT coalesce(sum(amount), 0) AS total FROM transactions WHERE date <= ?",
      args: [`${month}-31`],
    }),
    all<{ id: string; name: string; amount: Cents }>(ex, {
      sql: `SELECT c.id, c.name, sum(-t.amount) AS amount
        FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE t.amount < 0 AND substr(t.date, 1, 7) = ?
        GROUP BY c.id ORDER BY amount DESC, c.name`,
      args: [month],
    }),
  ]);
  const totals = (m: string): MonthTotals => {
    const row = rows.find((r) => r.month === m);
    return { month: m, income: toAmount(row?.income ?? 0), spending: toAmount(row?.spending ?? 0) };
  };
  const spent = byCategory.reduce((sum, c) => sum + c.amount, 0);
  return {
    month,
    balance: toAmount(closing?.total ?? 0),
    current: totals(month),
    previous: totals(previousMonth),
    months: Array.from({ length: 12 }, (_, i) => totals(`${year}-${String(i + 1).padStart(2, "0")}`)),
    categories: byCategory.map((c): CategorySpending => ({
      id: c.id,
      name: c.name,
      amount: toAmount(c.amount),
      share: Math.round((c.amount / spent) * 1000) / 10,
    })),
  };
}

async function checkInput(ex: Executor, clock: Clock, input: TransactionInput) {
  if (input.date > clock.today()) throw badRequest("Transaction date cannot be in the future");
  await requireCategoryFor(ex, input.categoryId, input.amount);
}

/** Inserts a transaction inside an open database transaction, without raising the hook. */
async function insertTransaction(ex: Executor, clock: Clock, input: TransactionInput): Promise<string> {
  await checkInput(ex, clock, input);
  const id = randomUUID();
  await ex.execute({
    sql: `INSERT INTO transactions
      (id, title, amount, currency, date, category_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, input.title, input.amount, input.currency, input.date, input.categoryId, clock.now().getTime()],
  });
  return id;
}

type Writer = Pick<Deps, "db" | "clock" | "hooks">;

export async function createTransaction(deps: Writer, input: TransactionInput): Promise<TransactionView> {
  const view = await inTransaction(deps.db, async (tx) =>
    getTransaction(tx, await insertTransaction(tx, deps.clock, input)),
  );
  await deps.hooks.call("transaction.created", view);
  return view;
}

export async function updateTransaction(deps: Writer, id: string, input: TransactionInput): Promise<TransactionView> {
  const view = await inTransaction(deps.db, async (tx) => {
    await getTransaction(tx, id);
    await checkInput(tx, deps.clock, input);
    await tx.execute({
      sql: `UPDATE transactions SET title = ?, amount = ?, currency = ?, date = ?, category_id = ?
        WHERE id = ?`,
      args: [input.title, input.amount, input.currency, input.date, input.categoryId, id],
    });
    return getTransaction(tx, id);
  });
  await deps.hooks.call("transaction.updated", view);
  return view;
}

export async function deleteTransaction(deps: Writer, id: string): Promise<void> {
  // Announce the transaction as it was, since it no longer exists afterwards.
  const view = await inTransaction(deps.db, async (tx) => {
    const before = await getTransaction(tx, id);
    await tx.execute({ sql: "DELETE FROM transactions WHERE id = ?", args: [id] });
    return before;
  });
  await deps.hooks.call("transaction.deleted", view);
}

const idParam = z.object({ id: z.uuid() });

const summaryQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM")
    .optional(),
});

/** Serves /transactions, /balance and /summary. */
export function transactionRoutes(deps: Deps) {
  const { db, clock } = deps;
  return new Hono()
    .get("/balance", async (c) => ok(c, await balance(db)))
    .get("/summary", validate("query", summaryQuery), async (c) => {
      const month = c.req.valid("query").month ?? clock.today().slice(0, 7);
      return ok(c, await summary(db, month));
    })
    .get("/transactions", validate("query", filterSchema), async (c) => {
      const page = pageRequest(c, TRANSACTION_SORTS, { sort: "date", direction: "desc" });
      return ok(c, await listTransactions(db, c.req.valid("query"), page));
    })
    .get("/transactions/:id", validate("param", idParam), async (c) =>
      ok(c, await getTransaction(db, c.req.valid("param").id)),
    )
    .post("/transactions", validate("json", transactionSchema), async (c) =>
      ok(c, await createTransaction(deps, c.req.valid("json")), 201),
    )
    .put("/transactions/:id", validate("param", idParam), validate("json", transactionSchema), async (c) =>
      ok(c, await updateTransaction(deps, c.req.valid("param").id, c.req.valid("json"))),
    )
    .delete("/transactions/:id", validate("param", idParam), async (c) => {
      await deleteTransaction(deps, c.req.valid("param").id);
      return c.body(null, 204);
    });
}
