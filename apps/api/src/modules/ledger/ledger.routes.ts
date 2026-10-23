import { createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

import type { Deps } from "@api/core/deps.ts";
import { createRouter, envelope, errorResponse } from "@api/core/openapi.ts";
import {
  CategoryDeletedSchema,
  CategoryInputSchema,
  CategorySchema,
  CategoryUpdateSchema,
} from "@api/modules/ledger/categories.schemas.ts";
import * as categories from "@api/modules/ledger/categories.service.ts";
import {
  BalanceSchema,
  FilterSchema,
  IdParamSchema,
  SummaryQuerySchema,
  SummarySchema,
  TransactionInputSchema,
  TransactionPageSchema,
  TransactionSchema,
} from "@api/modules/ledger/transactions.schemas.ts";
import * as ledger from "@api/modules/ledger/transactions.service.ts";

const json = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const balanceRoute = createRoute({
  method: "get",
  path: "/balance",
  summary: "The sum of every transaction",
  responses: { 200: json(envelope(BalanceSchema), "The account balance") },
});

const summaryRoute = createRoute({
  method: "get",
  path: "/summary",
  summary: "The dashboard for a month",
  request: { query: SummaryQuerySchema },
  responses: { 200: json(envelope(SummarySchema), "The month's totals, year and categories") },
});

const listRoute = createRoute({
  method: "get",
  path: "/transactions",
  summary: "List transactions, a page at a time",
  request: { query: FilterSchema },
  responses: {
    200: json(envelope(TransactionPageSchema), "A page of transactions"),
    400: errorResponse,
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/transactions/{id}",
  summary: "One transaction",
  request: { params: IdParamSchema },
  responses: {
    200: json(envelope(TransactionSchema), "The transaction"),
    404: errorResponse,
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/transactions",
  summary: "Record a transaction",
  request: { body: { content: { "application/json": { schema: TransactionInputSchema } }, required: true } },
  responses: {
    201: json(envelope(TransactionSchema), "The transaction, as saved"),
    400: errorResponse,
    404: errorResponse,
  },
});

const updateRoute = createRoute({
  method: "put",
  path: "/transactions/{id}",
  summary: "Change a transaction",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: TransactionInputSchema } }, required: true },
  },
  responses: {
    200: json(envelope(TransactionSchema), "The transaction, as saved"),
    400: errorResponse,
    404: errorResponse,
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/transactions/{id}",
  summary: "Delete a transaction",
  request: { params: IdParamSchema },
  responses: { 204: { description: "The transaction was deleted" }, 404: errorResponse },
});

const categoriesRoute = createRoute({
  method: "get",
  path: "/categories",
  summary: "Every category, with how many transactions use it",
  responses: { 200: json(envelope(z.array(CategorySchema)), "The categories") },
});

const createCategoryRoute = createRoute({
  method: "post",
  path: "/categories",
  summary: "Add a category",
  request: { body: { content: { "application/json": { schema: CategoryInputSchema } }, required: true } },
  responses: {
    201: json(envelope(CategorySchema), "The category, as saved"),
    400: errorResponse,
    409: errorResponse,
  },
});

const updateCategoryRoute = createRoute({
  method: "patch",
  path: "/categories/{id}",
  summary: "Rename or recolour a category",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: CategoryUpdateSchema } }, required: true },
  },
  responses: {
    200: json(envelope(CategorySchema), "The category, as saved"),
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

const deleteCategoryRoute = createRoute({
  method: "delete",
  path: "/categories/{id}",
  summary: "Delete a category, moving its transactions to Other",
  request: { params: IdParamSchema },
  responses: {
    200: json(envelope(CategoryDeletedSchema), "How many transactions moved"),
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});

export function ledgerRoutes({ db, clock }: Deps) {
  return createRouter()
    .openapi(balanceRoute, (c) => c.json({ success: true as const, data: ledger.balance(db) }, 200))
    .openapi(summaryRoute, (c) =>
      c.json(
        {
          success: true as const,
          data: ledger.summary(db, c.req.valid("query").month ?? clock.today().slice(0, 7)),
        },
        200,
      ),
    )
    .openapi(listRoute, (c) => {
      const query = c.req.valid("query");
      return c.json(
        {
          success: true as const,
          data: ledger.listTransactions(db, query, ledger.pageFromQuery(query)),
        },
        200,
      );
    })
    .openapi(getRoute, (c) =>
      c.json({ success: true as const, data: ledger.getTransaction(db, c.req.valid("param").id) }, 200),
    )
    .openapi(createRouteDef, (c) =>
      c.json({ success: true as const, data: ledger.createTransaction(db, clock, c.req.valid("json")) }, 201),
    )
    .openapi(updateRoute, (c) =>
      c.json(
        {
          success: true as const,
          data: ledger.updateTransaction(db, clock, c.req.valid("param").id, c.req.valid("json")),
        },
        200,
      ),
    )
    .openapi(deleteRoute, (c) => {
      ledger.deleteTransaction(db, c.req.valid("param").id);
      return c.body(null, 204);
    })
    .openapi(categoriesRoute, (c) => c.json({ success: true as const, data: categories.listCategories(db) }, 200))
    .openapi(createCategoryRoute, (c) =>
      c.json({ success: true as const, data: categories.createCategory(db, c.req.valid("json")) }, 201),
    )
    .openapi(updateCategoryRoute, (c) =>
      c.json(
        {
          success: true as const,
          data: categories.updateCategory(db, c.req.valid("param").id, c.req.valid("json")),
        },
        200,
      ),
    )
    .openapi(deleteCategoryRoute, (c) =>
      c.json({ success: true as const, data: categories.deleteCategory(db, c.req.valid("param").id) }, 200),
    );
}
