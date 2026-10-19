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

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/** A failure that maps directly onto an HTTP error envelope. */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly errors: FieldError[] | undefined;

  constructor(status: ContentfulStatusCode, code: ErrorCode, message: string, errors?: FieldError[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export const badRequest = (message: string, code: ErrorCode = "BAD_REQUEST") => new AppError(400, code, message);
export const unauthorized = (message: string, code: ErrorCode = "UNAUTHORIZED") => new AppError(401, code, message);
export const forbidden = (message: string, code: ErrorCode = "FORBIDDEN") => new AppError(403, code, message);
export const notFound = (message: string, code: ErrorCode = "RESOURCE_NOT_FOUND") => new AppError(404, code, message);
export const conflict = (message: string, code: ErrorCode = "CONFLICT") => new AppError(409, code, message);

/** Writes the success envelope, `{ success: true, data }`. */
export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true, data }, status);
}

function errorBody(c: Context, message: string, code: ErrorCode, errors?: FieldError[]) {
  return {
    success: false,
    message,
    timestamp: new Date().toISOString(),
    path: c.req.path,
    code,
    ...(errors ? { errors } : {}),
  };
}

export const onError: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(errorBody(c, err.message, err.code, err.errors), err.status);
  }
  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode;
    const code: ErrorCode = status === 401 ? "UNAUTHORIZED" : status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    return c.json(errorBody(c, err.message || "Request failed", code), status);
  }
  if (isConstraintViolation(err)) {
    return c.json(errorBody(c, "The request conflicts with existing data", "CONFLICT"), 409);
  }
  console.error(err);
  return c.json(errorBody(c, "An unexpected error occurred", "INTERNAL_SERVER_ERROR"), 500);
};

export const onNotFound: NotFoundHandler = (c) =>
  c.json(errorBody(c, `No route for ${c.req.method} ${c.req.path}`, "RESOURCE_NOT_FOUND"), 404);

/** True when `err` (or its cause) is a SQLite constraint failure. */
function isConstraintViolation(err: unknown): boolean {
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if ("code" in e && typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT")) return true;
  }
  return false;
}

/** zod validator that reports failures in the standard validation envelope. */
function fieldErrors(
  error: { issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[] },
  fallback: string,
): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || fallback,
    code: issue.code,
    message: issue.message,
  }));
}

/** Validates a value outside HTTP (plugins), failing like the validator middleware does. */
export function parseInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(400, "VALIDATION_ERROR", "Validation failed", fieldErrors(result.error, "input"));
  return result.data;
}

export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(errorBody(c, "Validation failed", "VALIDATION_ERROR", fieldErrors(result.error, target)), 400);
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
