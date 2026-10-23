import { z } from "@hono/zod-openapi";

import { localDate } from "@api/core/dates.ts";
import { money } from "@api/core/money.ts";
import { CATEGORY_TYPES, type CategoryType } from "@api/modules/ledger/categories.schemas.ts";

/** Supported currencies. USD only for now; the column and check stay so a future module only has to extend this. */
export const CURRENCIES = ["USD"] as const;

/** Largest amount accepted, 99,999,999.99: eight digits and two decimals, as the web form allows. */
const MAX_AMOUNT = 9_999_999_999;

const TEXT_PATTERN = /^[\p{L}0-9 .,'\-()!?&@#%/+:_]*$/u;

export const TransactionInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(TEXT_PATTERN, "Title contains invalid characters")
      .openapi({ example: "Groceries at the market" }),
    /** Negative is money out, positive money in. */
    amount: money({ min: 1, max: MAX_AMOUNT, signed: true }).openapi({ example: -12.5 }),
    date: localDate.openapi({ example: "2026-03-14" }),
    categoryId: z.uuid({ message: "Choose a category" }),
    currency: z.enum(CURRENCIES).default("USD"),
  })
  .openapi("NewTransaction");

export const TransactionCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(CATEGORY_TYPES),
  color: z.string(),
});

export const TransactionSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    amount: z.number().openapi({ description: "Signed: negative is money out" }),
    type: z.enum(CATEGORY_TYPES),
    currency: z.enum(CURRENCIES),
    date: z.string(),
    category: TransactionCategorySchema,
    createdAt: z.string(),
  })
  .openapi("Transaction");

export const BalanceSchema = z.object({ balance: z.number() }).openapi("Balance");

export const FilterSchema = z.object({
  query: z
    .string()
    .max(100)
    .optional()
    .openapi({ param: { name: "query", in: "query" } }),
  type: z
    .enum(CATEGORY_TYPES)
    .optional()
    .openapi({ param: { name: "type", in: "query" } }),
  categoryId: z
    .uuid()
    .optional()
    .openapi({ param: { name: "categoryId", in: "query" } }),
  page: z
    .string()
    .optional()
    .openapi({ param: { name: "page", in: "query" }, example: "0" }),
  size: z
    .string()
    .optional()
    .openapi({ param: { name: "size", in: "query" }, example: "20" }),
  sort: z
    .string()
    .optional()
    .openapi({ param: { name: "sort", in: "query" }, example: "date,desc" }),
});

export const PageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    content: z.array(item),
    page: z.object({
      size: z.number().int(),
      number: z.number().int(),
      totalElements: z.number().int(),
      totalPages: z.number().int(),
    }),
  });

export const TransactionPageSchema = PageSchema(TransactionSchema).openapi("TransactionPage");

export const MonthTotalsSchema = z.object({
  month: z.string().openapi({ example: "2026-03" }),
  income: z.number(),
  spending: z.number(),
});

export const CategorySpendingSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  amount: z.number(),
  share: z.number().openapi({ description: "Percent of the month's spending, one decimal" }),
});

export const SummarySchema = z
  .object({
    month: z.string(),
    balance: z.number(),
    current: MonthTotalsSchema,
    previous: MonthTotalsSchema,
    months: z.array(MonthTotalsSchema),
    categories: z.array(CategorySpendingSchema),
  })
  .openapi("Summary");

export const SummaryQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM")
    .optional()
    .openapi({ param: { name: "month", in: "query" }, example: "2026-03" }),
});

export const IdParamSchema = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});

export type TransactionInput = z.output<typeof TransactionInputSchema>;
export type TransactionFilter = z.output<typeof FilterSchema>;
export type CategoryTypeName = CategoryType;
