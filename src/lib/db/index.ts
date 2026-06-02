import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

// 数据库文件路径 — Render 上 data/ 目录可能被清空，需要确保可写
const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "sqlite.db");

// 确保 data 目录存在且可写（Render 每次部署后目录可能被清空）
try {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  // 测试目录是否可写
  const testFile = path.join(DB_DIR, ".write-test");
  fs.writeFileSync(testFile, "ok");
  fs.unlinkSync(testFile);
} catch (e) {
  console.warn("⚠️ data 目录不可写，尝试使用 /tmp:", e);
  // Render 上 /tmp 是可写的
  const tmpDir = "/tmp/daihuo";
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
}

// 创建 better-sqlite3 连接实例
const sqlite = new Database(DB_PATH);

// 开启 WAL 模式，提升并发读写性能
sqlite.pragma("journal_mode = WAL");
// 开启外键约束
sqlite.pragma("foreign_keys = ON");

// ============================================================
// 自动建表 — Render 部署后 database 是空的，必须确保表存在
// ============================================================
function ensureTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scripting','assets','video','composing','done')),
      product_name TEXT,
      product_category TEXT,
      product_description TEXT,
      product_images TEXT DEFAULT '[]',
      product_analysis TEXT,
      product_id TEXT,
      brand_id TEXT,
      template_id TEXT,
      video_mode TEXT DEFAULT 'product_closeup' CHECK(video_mode IN ('product_closeup','graphic_montage','scene_demo','live_presenter')),
      source_type TEXT DEFAULT 'manual' CHECK(source_type IN ('manual','clone')),
      source_video_url TEXT,
      character_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      style_type TEXT NOT NULL CHECK(style_type IN ('pain_point','scene','comparison','story','custom')),
      title TEXT,
      total_duration INTEGER,
      shots TEXT DEFAULT '[]',
      selected INTEGER DEFAULT 0 CHECK(selected IN (0,1)),
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      shot_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ai_generated','product_image','user_upload')),
      file_path TEXT,
      thumbnail_path TEXT,
      provider TEXT,
      model TEXT,
      prompt TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','generating','done','failed')),
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS video_clips (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      shot_id INTEGER NOT NULL,
      asset_id TEXT REFERENCES assets(id),
      file_path TEXT,
      duration INTEGER,
      provider TEXT,
      model TEXT,
      transition_type TEXT DEFAULT 'ai_start_end' CHECK(transition_type IN ('ai_start_end','ai_reference','direct_concat','ffmpeg_fade')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','generating','done','failed')),
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS compositions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      output_path TEXT,
      resolution TEXT DEFAULT '1080p' CHECK(resolution IN ('720p','1080p')),
      aspect_ratio TEXT DEFAULT '9:16' CHECK(aspect_ratio IN ('9:16','16:9','1:1')),
      duration INTEGER,
      bgm_path TEXT,
      tts_enabled INTEGER DEFAULT 0 CHECK(tts_enabled IN (0,1)),
      subtitle_style TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','composing','done','failed')),
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('beauty','food','home','fashion','tech','other')),
      description TEXT,
      images TEXT DEFAULT '[]',
      price TEXT,
      target_audience TEXT,
      analysis TEXT,
      video_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS brand_settings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo_path TEXT,
      primary_color TEXT,
      secondary_color TEXT,
      font_family TEXT,
      watermark TEXT,
      intro_template_path TEXT,
      outro_template_path TEXT,
      is_default INTEGER DEFAULT 1 CHECK(is_default IN (0,1)),
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS script_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      video_mode TEXT,
      style_type TEXT,
      shots TEXT DEFAULT '[]',
      source_project_id TEXT,
      use_count INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      appearance TEXT,
      reference_images TEXT DEFAULT '[]',
      voice_profile TEXT,
      is_default INTEGER DEFAULT 0 CHECK(is_default IN (0,1)),
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL CHECK(event_type IN ('video_generate','export','share')),
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      metadata TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  console.log("✅ All 11 tables ensured");
}

ensureTables();

// 创建 drizzle ORM 实例，绑定 schema 以支持关系查询
export const db = drizzle(sqlite, { schema });

// 兼容函数式调用
export function getDb() {
  return db;
}
