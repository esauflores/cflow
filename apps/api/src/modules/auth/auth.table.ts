import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Small key/value settings, such as the server password hash. */
export const appSettings = sqliteTable("app_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
});

/** Login sessions. `id` is the SHA-256 of the bearer token; the token itself is never stored. */
export const sessions = sqliteTable("sessions", {
  id: text().primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  role: text({ enum: ["owner", "guest"] })
    .notNull()
    .default("owner"),
});
