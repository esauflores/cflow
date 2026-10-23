import { sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Clock } from "@api/core/config.ts";
import { addMonths } from "@api/core/dates.ts";
import type { Db } from "@api/core/deps.ts";
import { badRequest, notFound, pageOf, type PageRequest, type PageInput, toPageRequest } from "@api/core/errors.ts";
import { type Cents, toAmount } from "@api/core/money.ts";
import type { CategoryType } from "@api/modules/ledger/categories.schemas.ts";
import { requireCategoryFor, typeOf } from "@api/modules/ledger/categories.service.ts";
import type {
  CategoryTypeName,
  TransactionFilter,
  TransactionInput,
} from "@api/modules/ledger/transactions.schemas.ts";

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
    currency: r.currency as "USD",
    date: r.date,
    category: {
      id: r.categoryId,
      name: r.categoryName,
      type: r.categoryType,
      color: r.categoryColor,
    },
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

export type TransactionView = ReturnType<typeof transactionView>;

export function getTransaction(db: Db, id: string): TransactionView {
  const row = db.get<TransactionRow>(sql`${sql.raw(SELECT)} WHERE t.id = ${id}`);
  if (!row) throw notFound("Transaction not found");
  return transactionView(row);
}

export function listTransactions(
  db: Db,
  filter: TransactionFilter,
  page: PageRequest<(typeof TRANSACTION_SORTS)[number]>,
) {
  const conditions: SQL[] = [];
  if (filter.query) {
    // Title or category name; and when the query reads as a number ("$1,200", "-35.5"), the amount too, compared as
    // text without sign so "135" also finds $135.77. `%` and `_` are LIKE wildcards; escape them (and the escape
    // character) so they match literally.
    const literal = filter.query
      .trim()
      .toLowerCase()
      .replace(/[\\%_]/g, "\\$&");
    const text = `%${literal}%`;
    const matches = [sql`lower(t.title) LIKE ${text} ESCAPE '\\'`, sql`lower(c.name) LIKE ${text} ESCAPE '\\'`];
    const number = filter.query.replace(/[\s$,+\-−]/g, "");
    if (/^\d+(\.\d{0,2})?$/.test(number)) {
      matches.push(
        sql`printf('%.2f', abs(t.amount) / 100.0) LIKE ${`%${number.endsWith(".") ? number.slice(0, -1) : number}%`}`,
      );
    }
    conditions.push(sql`(${sql.join(matches, sql` OR `)})`);
  }
  if (filter.type) conditions.push(filter.type === "EXPENSE" ? sql`t.amount < 0` : sql`t.amount > 0`);
  if (filter.categoryId) conditions.push(sql`t.category_id = ${filter.categoryId}`);
  const where = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
  const order = sql.raw(
    `${SORT_COLUMNS[page.sort]} ${page.direction === "asc" ? "ASC" : "DESC"}, t.created_at DESC, t.id`,
  );
  const rows = db.all<TransactionRow>(
    sql`${sql.raw(SELECT)} ${where} ORDER BY ${order} LIMIT ${page.size} OFFSET ${page.offset}`,
  );
  const count = db.get<{ total: number }>(
    sql`SELECT count(*) AS total FROM transactions t JOIN categories c ON c.id = t.category_id ${where}`,
  );
  return pageOf(rows.map(transactionView), count?.total ?? 0, page);
}

/** The account balance: the sum of every transaction. */
export function balance(db: Db): { balance: number } {
  const row = db.get<{ total: number }>(sql`SELECT coalesce(sum(amount), 0) AS total FROM transactions`);
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
 * The dashboard for `month` (`YYYY-MM`): the balance at its end, its totals and the previous month's, every month of
 * its year, and where its spending went by category. Months without transactions are zeros.
 */
export function summary(db: Db, month: string) {
  const year = month.slice(0, 4);
  const previousMonth = addMonths(`${month}-01`, -1).slice(0, 7);
  const rows = db.all<{ month: string; income: Cents; spending: Cents }>(
    sql`SELECT substr(date, 1, 7) AS month,
        coalesce(sum(CASE WHEN amount > 0 THEN amount END), 0) AS income,
        coalesce(sum(CASE WHEN amount < 0 THEN -amount END), 0) AS spending
      FROM transactions WHERE substr(date, 1, 4) = ${year} OR substr(date, 1, 7) IN (${month}, ${previousMonth})
      GROUP BY month`,
  );
  // "YYYY-MM-31" sorts after every date in the month.
  const closing = db.get<{ total: Cents }>(
    sql`SELECT coalesce(sum(amount), 0) AS total FROM transactions WHERE date <= ${`${month}-31`}`,
  );
  const byCategory = db.all<{ id: string; name: string; amount: Cents }>(
    sql`SELECT c.id, c.name, sum(-t.amount) AS amount
      FROM transactions t JOIN categories c ON c.id = t.category_id
      WHERE t.amount < 0 AND substr(t.date, 1, 7) = ${month}
      GROUP BY c.id ORDER BY amount DESC, c.name`,
  );
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
      share: spent === 0 ? 0 : Math.round((c.amount / spent) * 1000) / 10,
    })),
  };
}

function checkInput(db: Db, clock: Clock, input: TransactionInput) {
  if (input.date > clock.today()) throw badRequest("Transaction date cannot be in the future");
  requireCategoryFor(db, input.categoryId, input.amount);
}

export function createTransaction(db: Db, clock: Clock, input: TransactionInput): TransactionView {
  checkInput(db, clock, input);
  const id = randomUUID();
  db.run(
    sql`INSERT INTO transactions (id, title, amount, currency, date, category_id, created_at)
      VALUES (${id}, ${input.title}, ${input.amount}, ${input.currency}, ${input.date}, ${input.categoryId}, ${clock.now().getTime()})`,
  );
  return getTransaction(db, id);
}

export function updateTransaction(db: Db, clock: Clock, id: string, input: TransactionInput): TransactionView {
  getTransaction(db, id);
  checkInput(db, clock, input);
  db.run(
    sql`UPDATE transactions SET title = ${input.title}, amount = ${input.amount}, currency = ${input.currency},
      date = ${input.date}, category_id = ${input.categoryId} WHERE id = ${id}`,
  );
  return getTransaction(db, id);
}

export function deleteTransaction(db: Db, id: string): void {
  getTransaction(db, id);
  db.run(sql`DELETE FROM transactions WHERE id = ${id}`);
}

export function pageFromQuery(query: PageInput) {
  return toPageRequest(query, TRANSACTION_SORTS, { sort: "date", direction: "desc", size: 20 });
}

export type { CategoryTypeName };
