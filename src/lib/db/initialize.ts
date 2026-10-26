import type Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

/** WAL can return BUSY immediately even with busy_timeout; retry only initialization. */
export function retryDatabaseBusy<T>(operation: () => T, timeoutMs = 10_000): T {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return operation();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (!code?.startsWith("SQLITE_BUSY") && !code?.startsWith("SQLITE_LOCKED")) throw error;
      if (Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(100, deadline - Date.now()));
    }
  }
}

export function initializeSqlite(sqlite: Database.Database, migrationsFolder: string): void {
  sqlite.pragma("busy_timeout = 5000");
  retryDatabaseBusy(() => sqlite.pragma("journal_mode = WAL"));
  sqlite.pragma("foreign_keys = ON");
  const migrations = readMigrationFiles({ migrationsFolder });
  // Acquire the write lock BEFORE reading migration history. The stock synchronous
  // migrator reads first, so two starting processes can both apply the same migration.
  retryDatabaseBusy(() => sqlite.transaction(() => {
    sqlite.exec('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    const last = sqlite.prepare('SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1').get() as { created_at: number } | undefined;
    for (const migration of migrations) {
      if (last && Number(last.created_at) >= migration.folderMillis) continue;
      for (const statement of migration.sql) sqlite.exec(statement);
      sqlite.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run(migration.hash, migration.folderMillis);
    }
  }).immediate());
}
