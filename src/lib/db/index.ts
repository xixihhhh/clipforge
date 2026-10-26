import { drizzle } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import * as schema from "./schema";
import { getDataDir, getMigrationsDir } from "@/lib/paths";
import { initializeSqlite } from "./initialize";

export let dbInitError: string | null = null;
export let dbMigrationError: string | null = null;
type AppDb = ReturnType<typeof drizzle<typeof schema>>;
let realDb: AppDb | null = null;

function connect(): AppDb {
  if (realDb) return realDb;
  let sqlite: Database.Database | undefined;
  let migrating = false;
  dbInitError = null;
  dbMigrationError = null;
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    // Keep native module loading inside the catch so ABI errors reach /api/health.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require("better-sqlite3") as typeof Database;
    sqlite = new BetterSqlite3(path.join(getDataDir(), "sqlite.db"), { timeout: 5000 });
    migrating = true;
    initializeSqlite(sqlite, getMigrationsDir());
    realDb = drizzle(sqlite, { schema });
  } catch (error) {
    sqlite?.close(); // Failed initialization must not leave a lock-holding connection behind.
    const message = error instanceof Error ? `${error.message}${(error as NodeJS.ErrnoException).code ? `（${(error as NodeJS.ErrnoException).code}）` : ""}` : String(error);
    if (migrating) dbMigrationError = message;
    else dbInitError = message;
    throw new Error(`数据库不可用：${message}。请稍后重试；诊断信息见 /api/health。`, { cause: error });
  }

  // Crash recovery is best-effort and only runs after successful initialization.
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 15 * 60;
    sqlite.prepare("UPDATE compositions SET status = 'failed' WHERE status IN ('composing', 'pending') AND created_at < ? AND id NOT IN (SELECT composition_id FROM media_edits WHERE status IN ('queued', 'rendering') AND composition_id IS NOT NULL)").run(cutoff);
  } catch (error) {
    console.warn("Stale composition sweep failed (non-fatal):", error);
  }
  return realDb;
}

// Lazy initialization avoids build-worker writes. A transient startup lock does not
// poison the module forever: the next request can connect again after the lock clears.
export const db = new Proxy({} as AppDb, {
  get(_target, property) {
    const connection = connect();
    const value = Reflect.get(connection, property);
    return typeof value === "function" ? value.bind(connection) : value;
  },
});

export function getDb() {
  return db;
}
