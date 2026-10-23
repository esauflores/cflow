import { OpenAPIHono, z, type OpenAPIHonoOptions } from "@hono/zod-openapi";
import type { Env } from "hono";

import { errorBody, fieldErrors, message } from "@api/core/errors.ts";

/** The error envelope, named `Error` in the OpenAPI document. */
export const ErrorSchema = z
  .object({
    success: z.literal(false),
    message: z.string().openapi({ example: "Validation failed" }),
    code: z.string().openapi({ example: "VALIDATION_ERROR" }),
    timestamp: z.string(),
    path: z.string(),
    template: z.string().optional(),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    errors: z
      .array(
        z.object({
          field: z.string(),
          code: z.string(),
          message: z.string(),
          template: z.string().optional(),
          params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        }),
      )
      .optional(),
  })
  .openapi("Error");

/** Successful responses keep CFlow's `{ success: true, data }` envelope. */
export const envelope = <T extends z.ZodType>(data: T) => z.object({ success: z.literal(true), data });

/** Invalid input (params, query, body) answers `400` with CFlow's error envelope and one entry per field. */
const answerInvalidInput: OpenAPIHonoOptions<Env>["defaultHook"] = (result, c) => {
  if (result.success) return;
  return c.json(
    errorBody(c, message("Validation failed"), "VALIDATION_ERROR", fieldErrors(result.error, "input")),
    400,
  );
};

/** A module's router, mounted in app.ts under the app's /api base path. */
export const createRouter = <E extends Env = Env>() =>
  new OpenAPIHono<E>({ defaultHook: answerInvalidInput as unknown as OpenAPIHonoOptions<E>["defaultHook"] });

/** A response body: `ErrorSchema` for the error answers, `envelope(...)` for the successful ones. */
export const errorResponse = {
  content: { "application/json": { schema: ErrorSchema } },
  description: "The request failed",
} as const;
