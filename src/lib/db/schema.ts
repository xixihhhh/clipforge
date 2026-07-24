import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Projects table
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "scripting", "assets", "video", "composing", "done"] }).notNull().default("draft"),
  // Content type: product=commerce (product-centred), topic=topic-based video (no product; one-sentence topic → narration script → auto-matched free footage)
  contentType: text("content_type", { enum: ["product", "topic"] }).default("product"),
  // One-sentence topic entered by the user in topic mode (e.g. "在家如何泡一杯手冲咖啡")
  topic: text("topic"),
  productName: text("product_name"),
  productCategory: text("product_category"),
  productDescription: text("product_description"),
  productPrice: text("product_price"), // Product price display text (e.g. "¥39.9" / "£63.00", mainly sourced from link ingest, used for product-card overlays)
  // Shop / affiliate link (2026 commerce monetization): the storefront URL the video drives buyers to,
  // and an optional affiliate/partner code for commission tracking. Preserved from product-link ingest;
  // flows into publish copy (UTM-tagged link) and an end-card QR code.
  shopUrl: text("shop_url"),
  affiliateCode: text("affiliate_code"),
  productImages: text("product_images", { mode: "json" }).$type<string[]>().default([]),
  productAnalysis: text("product_analysis"), // LLM visual analysis result
  productId: text("product_id"), // Linked product library entry (optional; can also be filled in directly)
  brandId: text("brand_id"), // Linked brand settings
  templateId: text("template_id"), // Script template in use
  videoMode: text("video_mode", { enum: ["product_closeup", "graphic_montage", "scene_demo", "live_presenter"] }).default("product_closeup"), // Video mode
  sourceType: text("source_type", { enum: ["manual", "clone"] }).default("manual"), // manual=created by hand, clone=viral-video remake
  sourceVideoUrl: text("source_video_url"), // Source video URL for viral-video remakes
  characterId: text("character_id"), // On-screen character bound to the project (live_presenter mode only)
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Scripts table
export const scripts = sqliteTable("scripts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  styleType: text("style_type", { enum: ["pain_point", "scene", "comparison", "story", "custom"] }).notNull(),
  title: text("title"),
  totalDuration: integer("total_duration"), // Total duration in seconds
  shots: text("shots", { mode: "json" }).$type<Shot[]>().default([]),
  selected: integer("selected", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Performance feedback: manually entered placement data recorded after publishing.
// style/category/platform are snapshotted at entry time so historical samples are not
// polluted if the project is later modified — enables per-style aggregation of "what sells best".
export const publishMetrics = sqliteTable("publish_metrics", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  style: text("style").notNull(), // Script style key: pain_point/scene/comparison/story/custom
  hookId: text("hook_id"), // Hook mechanism id (= HookPattern.id), used for hook A/B feedback, nullable
  category: text("category"), // Product category (snapshotted)
  platform: text("platform"), // douyin/tiktok/kuaishou/xiaohongshu/...
  views: integer("views").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  shares: integer("shares").notNull().default(0),
  orders: integer("orders").notNull().default(0), // Number of orders placed
  note: text("note"),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Assets table
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").notNull(), // Corresponding shot index
  // stock_footage = free commercial-use video/images fetched from a stock library (e.g. Pexels)
  type: text("type", { enum: ["ai_generated", "product_image", "user_upload", "stock_footage"] }).notNull(),
  filePath: text("file_path"),
  thumbnailPath: text("thumbnail_path"),
  provider: text("provider"),
  model: text("model"),
  prompt: text("prompt"),
  // Asset provenance (required for stock_footage compliance: retain source link/author/license; generate credits on export)
  sourceUrl: text("source_url"), // Source page URL (e.g. Pexels video detail page)
  author: text("author"), // Asset author (for attribution)
  license: text("license"), // License type, e.g. "Pexels"
  status: text("status", { enum: ["pending", "generating", "done", "failed"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Video clips table
export const videoClips = sqliteTable("video_clips", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").notNull(),
  assetId: text("asset_id").references(() => assets.id),
  filePath: text("file_path"),
  duration: integer("duration"), // Milliseconds
  provider: text("provider"),
  model: text("model"),
  transitionType: text("transition_type", { enum: ["ai_start_end", "ai_reference", "direct_concat", "ffmpeg_fade"] }).default("ai_start_end"),
  status: text("status", { enum: ["pending", "generating", "done", "failed"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// AI generation tasks table — every billable cloud task is persisted the moment the
// provider acknowledges it (issue #16: a poll timeout used to silently drop tasks the
// user had already paid for). Non-terminal rows can be resumed after a restart.
export const aiTasks = sqliteTable("ai_tasks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // nullable on purpose: generation can be triggered outside a project context
  projectId: text("project_id"),
  shotId: integer("shot_id"),
  provider: text("provider").notNull(),
  // the model actually submitted to the provider (after any mode remapping)
  model: text("model").notNull(),
  mediaType: text("media_type", { enum: ["image", "video"] }).notNull().default("video"),
  mode: text("mode"),
  prompt: text("prompt"),
  // provider-side task/prediction ID — the recovery handle for a paid task
  taskId: text("task_id").notNull(),
  // unknown = client lost contact (poll timeout / restart); the cloud task may still be running
  status: text("status", { enum: ["submitted", "processing", "completed", "failed", "unknown"] }).notNull().default("submitted"),
  resultUrls: text("result_urls", { mode: "json" }).$type<string[]>(),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Compositions table
export const compositions = sqliteTable("compositions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  outputPath: text("output_path"),
  resolution: text("resolution", { enum: ["720p", "1080p"] }).default("1080p"),
  aspectRatio: text("aspect_ratio", { enum: ["9:16", "16:9", "1:1"] }).default("9:16"), // Portrait-first
  duration: integer("duration"), // Milliseconds
  bgmPath: text("bgm_path"),
  ttsEnabled: integer("tts_enabled", { mode: "boolean" }).default(false),
  subtitleStyle: text("subtitle_style", { mode: "json" }).$type<SubtitleStyle>(),
  status: text("status", { enum: ["pending", "composing", "done", "failed"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Products table — product information reused across projects
export const products = sqliteTable("products", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(), // Product name
  category: text("category", { enum: ["beauty", "food", "home", "fashion", "tech", "other"] }).notNull(),
  description: text("description"), // Selling-point description
  images: text("images", { mode: "json" }).$type<string[]>().default([]), // List of product image URLs
  price: text("price"), // Price info (e.g. "59.9元", "199-299元")
  targetAudience: text("target_audience"), // Target audience
  analysis: text("analysis"), // LLM visual analysis result (cached)
  videoCount: integer("video_count").default(0), // Number of videos generated
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Brand settings table — unified brand visual identity
export const brandSettings = sqliteTable("brand_settings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(), // Brand / store name
  logoPath: text("logo_path"), // Logo image path
  primaryColor: text("primary_color"), // Brand primary color (hex)
  secondaryColor: text("secondary_color"), // Brand secondary color
  fontFamily: text("font_family"), // Preferred font family
  watermark: text("watermark", { mode: "json" }).$type<WatermarkConfig>(), // Watermark configuration
  introTemplatePath: text("intro_template_path"), // Intro template path
  outroTemplatePath: text("outro_template_path"), // Outro template path
  isDefault: integer("is_default", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Script templates table — user-saved high-performing script templates
export const scriptTemplates = sqliteTable("script_templates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(), // Template name
  description: text("description"), // Template description
  category: text("category"), // Applicable product category
  videoMode: text("video_mode"), // Applicable video mode
  styleType: text("style_type"), // Script style
  shots: text("shots", { mode: "json" }).$type<Shot[]>().default([]), // Script structure (shot prompts will be replaced on use)
  sourceProjectId: text("source_project_id"), // Source project
  useCount: integer("use_count").default(0), // Times used
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Characters table — on-screen presenters reused across projects
export const characters = sqliteTable("characters", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(), // Character name, e.g. "小美"
  description: text("description"), // Short description, e.g. "25岁女生，活泼开朗"
  appearance: text("appearance"), // Appearance traits (injected into AI prompts)
  referenceImages: text("reference_images", { mode: "json" }).$type<string[]>().default([]), // List of reference image URLs
  voiceProfile: text("voice_profile", { mode: "json" }).$type<CharacterVoiceProfile>(), // Voice preferences
  isDefault: integer("is_default", { mode: "boolean" }).default(false), // Whether this is the default on-screen presenter
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Settings table
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ===== Type definitions =====

/** Video mode: determines the asset generation strategy */
export type VideoMode =
  | "product_closeup"   // Product close-up: original product image + motion effects, highest realism
  | "graphic_montage"   // Graphic montage: product image + text cards + transition animations
  | "scene_demo"        // Scene demo: AI-generated usage scenario (no faces)
  | "live_presenter";   // Live presenter: on-screen character explains the product (requires a character or user-uploaded footage)

export interface Shot {
  shotId: number;
  type: "hook" | "pain_point" | "product_reveal" | "demo" | "social_proof" | "cta";
  duration: number; // Seconds
  description: string; // Scene description
  camera: string; // Camera movement
  visualSource: "ai_generate" | "product_image" | "user_upload";
  transition: "ai_start_end" | "ai_reference" | "direct_concat" | "ffmpeg_fade";
  voiceover: string; // Voiceover copy
  prompt?: string; // AI image/video generation prompt
  /** English stock-footage keywords for this shot (1-3), used to auto-match footage from free libraries (key for topic-based videos without a product) */
  stockKeywords?: string[];
  /** On-screen character ID, references the characters table (optional) */
  characterId?: string;
  /** Motion effect, only used for the product_image type */
  motion?: "zoom_in_slow" | "pan_left" | "pan_right" | "ken_burns" | "static";
  /** Text overlay (graphic montage mode) */
  textOverlay?: {
    text: string;
    style: "title" | "subtitle" | "highlight" | "price";
  };
}

/** Character voice preferences */
export interface CharacterVoiceProfile {
  /** Voice style description, e.g. "温柔女声" / "专业男声" */
  style: string;
  /** Speech-rate preference 0.8–1.5 */
  speed?: number;
  /** Emotional tone */
  emotion?: "neutral" | "happy" | "serious" | "energetic";
}

/** Watermark configuration */
export interface WatermarkConfig {
  /** Whether the watermark is enabled */
  enabled: boolean;
  /** Position */
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Opacity 0–1 */
  opacity: number;
  /** Scale 0.1–0.5 */
  scale: number;
}

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  position: "bottom" | "center" | "top";
}
