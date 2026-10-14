import { defineConfig } from "drizzle-kit";

// Generates migrations for the embedded SQLite database into ./drizzle-sqlite.
// They are applied automatically on server start (see server/_core/database.ts).
export default defineConfig({
  schema: "./drizzle/schema.sqlite.ts",
  out: "./drizzle-sqlite",
  dialect: "sqlite",
});
