import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDataDir, getMigrationsDir } from "@/lib/paths";
import { db, dbInitError, dbMigrationError } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/**
 * 一站式自诊断接口：用户报障时只需截 http://127.0.0.1:<端口>/api/health 一张图，
 * 即可看到数据库/迁移/ffmpeg/运行时的真实状态——不用再来回追问日志文件（issue #10/#12 的教训）。
 * 只读、无副作用、不含任何密钥信息。
 */
export async function GET() {
  // 数据库连通性：真实执行一条查询（能同时暴露原生模块 ABI 问题与表缺失问题）
  let dbStatus = "ok";
  let projectCount: number | null = null;
  try {
    const row = db.select({ n: sql<number>`count(*)` }).from(projects).get();
    projectCount = row?.n ?? 0;
  } catch (e) {
    dbStatus = e instanceof Error ? e.message : String(e);
  }

  const migrationsDir = getMigrationsDir();
  const dataDir = getDataDir();
  const ffmpeg = process.env.FFMPEG_PATH || "system";

  return NextResponse.json({
    version: process.env.npm_package_version || "unknown",
    time: new Date().toISOString(),
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron || null,
      moduleAbi: process.versions.modules,
    },
    db: {
      status: dbStatus,
      initError: dbInitError,
      migrationError: dbMigrationError,
      projectCount,
      file: path.join(dataDir, "sqlite.db"),
      fileExists: fs.existsSync(path.join(dataDir, "sqlite.db")),
    },
    paths: {
      dataDir,
      dataDirWritable: (() => {
        try {
          fs.accessSync(dataDir, fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      })(),
      migrationsDir,
      migrationsDirExists: fs.existsSync(migrationsDir),
    },
    ffmpeg: {
      path: ffmpeg,
      exists: ffmpeg === "system" ? null : fs.existsSync(ffmpeg),
    },
  });
}
