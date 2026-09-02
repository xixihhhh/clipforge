import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/saas-db/schema.ts",
  out: "./drizzle-saas",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/clipforge",
  },
  strict: true,
  verbose: true,
});
