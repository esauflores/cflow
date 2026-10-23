import { z } from "@hono/zod-openapi";

/** The password rule shared by setup and change-password. */
export const NewPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(256)
  .openapi({ example: "correct horse battery staple" });

export const SessionSchema = z
  .object({
    token: z.string().openapi({ example: "eyJ…" }),
    expiresAt: z.string().openapi({ example: "2026-11-22T09:30:00.000Z" }),
    guest: z.boolean(),
  })
  .openapi("Session");

export const StatusSchema = z
  .object({
    bootstrapped: z.boolean(),
    allowGuest: z.boolean(),
    plugins: z.array(z.string()).openapi({ example: ["core", "i18n"] }),
  })
  .openapi("ServerStatus");

export const PasswordBodySchema = z.object({ password: z.string().min(1).max(256) });
export const SetupBodySchema = z.object({ password: NewPasswordSchema });
export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: NewPasswordSchema,
});
