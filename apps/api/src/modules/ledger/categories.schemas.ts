import { z } from "@hono/zod-openapi";

export const CATEGORY_TYPES = ["INCOME", "EXPENSE"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const CategorySchema = z
  .object({
    id: z.uuid(),
    name: z.string().openapi({ example: "Food" }),
    type: z.enum(CATEGORY_TYPES),
    color: z.string().openapi({ example: "#ef4444" }),
    usage: z.number().int().openapi({ description: "How many transactions use it", example: 3 }),
  })
  .openapi("Category");

const categoryName = z.string().trim().min(1, "Enter a name").max(50);

/** A six-digit hex colour, e.g. "#3b82f6". */
const categoryColor = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a hex colour like #3b82f6");

export const CategoryInputSchema = z
  .object({
    name: categoryName,
    type: z.enum(CATEGORY_TYPES),
    color: categoryColor.optional(),
  })
  .openapi("NewCategory");

export const CategoryUpdateSchema = z
  .object({ name: categoryName.optional(), color: categoryColor.optional() })
  .refine((input) => input.name !== undefined || input.color !== undefined, { message: "Nothing to update" })
  .openapi("CategoryUpdate");

export const CategoryDeletedSchema = z
  .object({ moved: z.number().int().openapi({ description: "Transactions moved to Other", example: 2 }) })
  .openapi("CategoryDeleted");
