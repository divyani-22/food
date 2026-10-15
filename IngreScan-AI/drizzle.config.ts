import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL (mysql://...) is required to run MySQL drizzle commands. The embedded SQLite database migrates itself on server start; to generate SQLite migrations use `pnpm db:generate:sqlite`."
  );
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
  },
});
