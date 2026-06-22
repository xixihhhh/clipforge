import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import * as schema from "./schema";
import { getDataDir, getMigrationsDir } from "@/lib/paths";

// 数据库文件路径：可写数据目录（Electron 打包时由主进程注入 APP_DATA_DIR=userData/data）
const DB_DIR = getDataDir();
const DB_PATH = path.join(DB_DIR, "sqlite.db");
// 迁移文件目录（drizzle-kit generate 产出，随仓库提交；打包时指向 resources/drizzle）
const MIGRATIONS_DIR = getMigrationsDir();

// 确保 data 目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// 创建 better-sqlite3 连接实例
const sqlite = new Database(DB_PATH);

// 开启 WAL 模式，提升并发读写性能
// 跳过 next build 阶段：journal_mode=WAL 会改写库文件头、需短暂排他锁，
// 构建时多 worker 并发导入本模块会同时抢锁触发 "database is locked"。
// WAL 是库文件的持久属性，运行时（next start / Electron）设置一次即可。
if (process.env.NEXT_PHASE !== "phase-production-build") {
  sqlite.pragma("journal_mode = WAL");
}
// 开启外键约束（每连接级 pragma，不写库文件、无锁竞争，构建期保留无碍）
sqlite.pragma("foreign_keys = ON");

// 创建 drizzle ORM 实例，绑定 schema 以支持关系查询
export const db = drizzle(sqlite, { schema });

// 开箱即用：启动时自动应用迁移，确保全新克隆/空库也能建好所有表
// （修复 issue #2「no such table: projects」——data/ 被 gitignore，开箱无表）
// 跳过 next build 阶段：构建时多 worker 并发导入本模块会同时 migrate 同一空库，
// 触发竞态（"duplicate column" 等）。迁移只需在运行时（next start / Electron）执行一次。
if (process.env.NEXT_PHASE !== "phase-production-build") {
  try {
    if (fs.existsSync(MIGRATIONS_DIR)) {
      migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    }
  } catch (err) {
    console.error("数据库迁移失败:", err);
  }
}

// 兼容函数式调用
export function getDb() {
  return db;
}
