/**
 * Unified runtime path resolution — allows data directories to be injected via environment variables,
 * enabling Electron packaging support.
 *
 * Key background: when the Next.js standalone output's server.js starts it calls process.chdir(__dirname),
 * so after being bundled into Electron, process.cwd() points to the read-only resources directory — writing
 * sqlite/uploads/output there will crash. The Electron main process therefore injects
 * APP_DATA_DIR=app.getPath('userData')/data (a writable location).
 * In dev (next dev) the variable is not injected and falls back to the project-root data/ directory,
 * preserving the original behavior exactly.
 */

import { join } from "path";

/** Writable data root directory (sqlite.db / uploads / output all live under here) */
export function getDataDir(): string {
  return process.env.APP_DATA_DIR || join(process.cwd(), "data");
}

/** Migrations SQL directory (read-only resource). Points to the drizzle folder inside resources when packaged in Electron. */
export function getMigrationsDir(): string {
  return process.env.APP_MIGRATIONS_DIR || join(process.cwd(), "drizzle");
}

/**
 * Last path component regardless of separator style. DB rows written on Windows carry
 * backslash absolute paths (e.g. `D:\clipforge\data\output\<id>\final.mp4`) while download
 * URLs always need the bare file name — a plain split("/") returns the whole Windows path
 * and produces broken `/api/output/...` URLs (issue #15). Pure function.
 */
export function fileNameOf(p: string | null | undefined): string {
  return (p ?? "").split(/[\\/]/).pop() ?? "";
}

/** Upload assets root directory: data/uploads */
export function getUploadsDir(): string {
  return join(getDataDir(), "uploads");
}

/** Composition output root directory: data/output */
export function getOutputDir(): string {
  return join(getDataDir(), "output");
}
