import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type SaasDatabase = ReturnType<typeof drizzle<typeof schema>>;

const globalForSaasDb = globalThis as typeof globalThis & {
  clipforgePostgresClient?: ReturnType<typeof postgres>;
  clipforgeSaasDb?: SaasDatabase;
};

export function getSaasDb(): SaasDatabase {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for SaaS database access");
  }

  if (!globalForSaasDb.clipforgePostgresClient) {
    globalForSaasDb.clipforgePostgresClient = postgres(databaseUrl, {
      max: process.env.NODE_ENV === "production" ? 10 : 3,
      prepare: false,
    });
  }
  if (!globalForSaasDb.clipforgeSaasDb) {
    globalForSaasDb.clipforgeSaasDb = drizzle(globalForSaasDb.clipforgePostgresClient, { schema });
  }

  return globalForSaasDb.clipforgeSaasDb;
}
