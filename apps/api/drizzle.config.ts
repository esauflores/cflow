import { defineConfig } from "drizzle-kit";

/** `bun run db:generate` compares the modules' tables with the last migration and writes a new one into drizzle/. */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/modules/*/*.table.ts",
  out: "./drizzle",
});
