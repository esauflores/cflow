import { zValidator } from "@hono/zod-validator";
import type { Context, ErrorHandler, NotFoundHandler, ValidationTargets } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RESOURCE_NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR"
  | "INVALID_CREDENTIALS";

/** Values for a message's `{name}` placeholders. */
export type Params = Record<string, string | number>;

/** Fills `{name}` placeholders from `params`; unknown ones stay as written. */
function fill(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/**
 * A message as sent: `message` is the English text; when it holds values, `template` and `params` come
 * too, so a client can show it in another language (the i18n plugin translates the template).
 */
interface Message {
  message: string;
  template?: string;
  params?: Params;
}

const message = (template: string, params?: Params): Message =>
  params ? { message: fill(template, params), template, params } : { message: template };

export interface FieldError extends Message {
  field: string;
  code: string;
}

/** A failure that maps directly onto an HTTP error envelope. `message` may hold `{name}` placeholders. */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly errors: FieldError[] | undefined;
  readonly body: Message;

  constructor(
    status: ContentfulStatusCode,
    code: ErrorCode,
    template: string,
    options: { errors?: FieldError[]; params?: Params } = {},
  ) {
    const body = message(template, options.params);
    super(body.message);
    this.status = status;
    this.code = code;
    this.errors = options.errors;
    this.body = body;
  }
}

type Options = { code?: ErrorCode; params?: Params };

export const badRequest = (text: string, { code = "BAD_REQUEST", params }: Options = {}) =>
  new AppError(400, code, text, { params });
export const unauthorized = (text: string, { code = "UNAUTHORIZED", params }: Options = {}) =>
  new AppError(401, code, text, { params });
export const forbidden = (text: string, { code = "FORBIDDEN", params }: Options = {}) =>
  new AppError(403, code, text, { params });
export const notFound = (text: string, { code = "RESOURCE_NOT_FOUND", params }: Options = {}) =>
  new AppError(404, code, text, { params });
export const conflict = (text: string, { code = "CONFLICT", params }: Options = {}) =>
  new AppError(409, code, text, { params });

// zod's own messages for the checks that don't name one, as templates over the issue's values
// (`minimum`, `maximum`), so they read plainly and can be translated.
z.config({
  customError: (issue) => {
    if (issue.code === "too_small" && issue.origin === "string") return "Must be at least {minimum} characters";
    if (issue.code === "too_big" && issue.origin === "string") return "Must be at most {maximum} characters";
    if (issue.code === "invalid_type" && issue.input === undefined) return "Required";
    return "Invalid value";
  },
});

/** Writes the success envelope, `{ success: true, data }`. */
export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true, data }, status);
}

function errorBody(c: Context, body: Message, code: ErrorCode, errors?: FieldError[]) {
  return {
    success: false,
    ...body,
    timestamp: new Date().toISOString(),
    path: c.req.path,
    code,
    ...(errors ? { errors } : {}),
  };
}

export const onError: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(errorBody(c, err.body, err.code, err.errors), err.status);
  }
  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode;
    const code: ErrorCode = status === 401 ? "UNAUTHORIZED" : status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    return c.json(errorBody(c, { message: err.message || "Request failed" }, code), status);
  }
  if (isConstraintViolation(err)) {
    return c.json(errorBody(c, message("The request conflicts with existing data"), "CONFLICT"), 409);
  }
  console.error(err);
  return c.json(errorBody(c, message("An unexpected error occurred"), "INTERNAL_SERVER_ERROR"), 500);
};

export const onNotFound: NotFoundHandler = (c) =>
  c.json(
    errorBody(
      c,
      message("No route for {method} {path}", { method: c.req.method, path: c.req.path }),
      "RESOURCE_NOT_FOUND",
    ),
    404,
  );

/** True when `err` (or its cause) is a SQLite constraint failure. */
function isConstraintViolation(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ("code" in e && typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT")) return true;
  }
  return false;
}

/**
 * One FieldError per zod issue. A message with `{name}` placeholders is filled from the issue: its
 * `params` (custom checks) or its `minimum`/`maximum` (length checks).
 */
function fieldErrors(error: { issues: readonly z.core.$ZodIssue[] }, fallback: string): FieldError[] {
  return error.issues.map((issue) => {
    const values: Params = { ...(issue.code === "custom" ? (issue.params as Params | undefined) : {}) };
    if (issue.code === "too_small") values.minimum = Number(issue.minimum);
    if (issue.code === "too_big") values.maximum = Number(issue.maximum);
    const hasPlaceholders = /\{\w+\}/.test(issue.message);
    return {
      field: issue.path.map(String).join(".") || fallback,
      code: issue.code,
      ...message(issue.message, hasPlaceholders ? values : undefined),
    };
  });
}

/** Validates a value outside HTTP (plugins), failing like the validator middleware does. */
export function parseInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(400, "VALIDATION_ERROR", "Validation failed", { errors: fieldErrors(result.error, "input") });
  return result.data;
}

export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        errorBody(c, message("Validation failed"), "VALIDATION_ERROR", fieldErrors(result.error, target)),
        400,
      );
    }
  });
}

export interface PageRequest<Sort extends string> {
  page: number;
  size: number;
  offset: number;
  sort: Sort;
  direction: "asc" | "desc";
}

/** Paging as plain values, for callers without an HTTP request (plugins). */
export interface PageInput {
  page?: number | string | undefined;
  size?: number | string | undefined;
  /** `field` or `field,asc|desc`, as in the `sort` query parameter. */
  sort?: string | undefined;
}

/**
 * Normalises paging input (Spring's Pageable conventions), restricted to
 * `sortable` fields.
 */
export function toPageRequest<Sort extends string>(
  input: PageInput,
  sortable: readonly Sort[],
  defaults: { sort: Sort; direction: "asc" | "desc"; size?: number },
): PageRequest<Sort> {
  const page = clampInt(input.page?.toString(), 0, 0, 100_000);
  const size = clampInt(input.size?.toString(), defaults.size ?? 20, 1, 100);
  const [field, dir] = (input.sort ?? "").split(",");
  const known = sortable.includes(field as Sort);
  const sort = known ? (field as Sort) : defaults.sort;
  const direction = dir === "asc" || dir === "desc" ? dir : known ? "asc" : defaults.direction;
  return { page, size, offset: page * size, sort, direction };
}

/** Reads `page`, `size` and `sort` from the query string. */
export function pageRequest<Sort extends string>(
  c: Context,
  sortable: readonly Sort[],
  defaults: { sort: Sort; direction: "asc" | "desc"; size?: number },
): PageRequest<Sort> {
  return toPageRequest(
    { page: c.req.query("page"), size: c.req.query("size"), sort: c.req.query("sort") },
    sortable,
    defaults,
  );
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export interface Page<T> {
  content: T[];
  page: { size: number; number: number; totalElements: number; totalPages: number };
}

export function pageOf<T>(content: T[], total: number, request: PageRequest<string>): Page<T> {
  return {
    content,
    page: {
      size: request.size,
      number: request.page,
      totalElements: total,
      totalPages: Math.ceil(total / request.size),
    },
  };
}
