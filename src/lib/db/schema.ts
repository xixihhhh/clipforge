import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  CreativeIntent,
  ProductionSnapshot,
  ProjectMediaInsight,
  VisualBible,
  WorkflowStagePlan,
} from "@/lib/production-system";
import type { TimeRange, TranscriptDocument, TranscriptEditPlan } from "@/lib/transcript-editor";
import type { TranscriptEditSummary } from "@/lib/transcript-edit-protocol";
import type { TranscriptCheckpoint } from "@/lib/transcript-checkpoint";
import type {
  GenerationQualityReport,
  QualityDisposition,
  ShotQualityContract,
} from "@/lib/generation-quality";
import type { GenerationControlSummary } from "@/lib/video-repair-plan";

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
  // Project-level production intelligence. JSON columns keep the new planning/memory layer
  // additive: existing projects read null and continue through the original pipeline unchanged.
  creativeIntent: text("creative_intent", { mode: "json" }).$type<CreativeIntent>(),
  visualBible: text("visual_bible", { mode: "json" }).$type<VisualBible>(),
  mediaInsights: text("media_insights", { mode: "json" }).$type<ProjectMediaInsight[]>().default([]),
  productionWorkflow: text("production_workflow", { mode: "json" }).$type<WorkflowStagePlan[]>(),
  versionSnapshots: text("version_snapshots", { mode: "json" }).$type<ProductionSnapshot[]>().default([]),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Scripts table
export const scripts = sqliteTable("scripts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  styleType: text("style_type", {
    enum: ["pain_point", "scene", "comparison", "story", "drama", "reversal", "interview", "unboxing", "product_pov", "talking_head", "custom"],
  }).notNull(),
  title: text("title"),
  totalDuration: integer("total_duration"), // Total duration in seconds
  shots: text("shots", { mode: "json" }).$type<Shot[]>().default([]),
  // Dialogue-script cast (drama style): drives per-character TTS voices + visual-anchor prompts
  characters: text("characters", { mode: "json" }).$type<ScriptCharacter[]>(),
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
  generationPlan: text("generation_plan", { mode: "json" }).$type<GenerationControlSummary>(),
  // Asset provenance (required for stock_footage compliance: retain source link/author/license; generate credits on export)
  sourceUrl: text("source_url"), // Source page URL (e.g. Pexels video detail page)
  author: text("author"), // Asset author (for attribution)
  license: text("license"), // License type, e.g. "Pexels"
  // Multiple takes may coexist for one shot. Exactly one active take feeds composition;
  // old takes remain available for comparison, rollback, and quality learning.
  selected: integer("selected", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["pending", "generating", "done", "failed"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Multimodal shot reviews are append-only: the same asset can be reassessed when the
// contract or evaluator improves while preserving the evidence behind earlier decisions.
export const generationReviews = sqliteTable("generation_reviews", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  shotId: integer("shot_id").notNull(),
  contract: text("contract", { mode: "json" }).$type<ShotQualityContract>().notNull(),
  report: text("report", { mode: "json" }).$type<GenerationQualityReport>().notNull(),
  disposition: text("disposition", { mode: "json" }).$type<QualityDisposition>().notNull(),
  evaluatorModel: text("evaluator_model").notNull(),
  verdict: text("verdict", { enum: ["accept", "review", "reject"] }).notNull(),
  humanDecision: text("human_decision", { enum: ["accepted", "rejected"] }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
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
  // audio: Sonilo AI 配乐/音效等付费音频任务（无 CHECK 约束，纯类型层放宽，无需迁移）
  mediaType: text("media_type", { enum: ["image", "video", "audio"] }).notNull().default("video"),
  mode: text("mode"),
  prompt: text("prompt"),
  controlPlan: text("control_plan", { mode: "json" }).$type<GenerationControlSummary>(),
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
  // First-frame poster extracted right after a successful render (absolute path next to the
  // output file). Local extraction — never a third-party URL that can expire. Backfilled
  // lazily by /api/works for rows rendered before this column existed.
  thumbnailPath: text("thumbnail_path"),
  resolution: text("resolution", { enum: ["720p", "1080p"] }).default("1080p"),
  aspectRatio: text("aspect_ratio", { enum: ["9:16", "16:9", "1:1"] }).default("9:16"), // Portrait-first
  duration: integer("duration"), // Milliseconds
  bgmPath: text("bgm_path"),
  ttsEnabled: integer("tts_enabled", { mode: "boolean" }).default(false),
  subtitleStyle: text("subtitle_style", { mode: "json" }).$type<SubtitleStyle>(),
  // Whether the visible "内容由 AI 生成" badge was burned in (read back by the release gate's AIGC-label check)
  aigcBadge: integer("aigc_badge", { mode: "boolean" }),
  // Human-readable variant label (variant-matrix batch renders, e.g. "疑问钩子×卡拉OK×动感")
  label: text("label"),
  status: text("status", { enum: ["pending", "composing", "done", "failed"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Imported long-form/raw media lives outside the per-shot assets table. The original file is
// immutable; browser-local ASR writes a validated word timeline back to this row, and every edit
// creates a separate media_edits revision + composition instead of modifying the source.
export const mediaSources = sqliteTable("media_sources", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  duration: integer("duration").notNull().default(0), // milliseconds
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  hasAudio: integer("has_audio", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["uploaded", "transcribing", "ready", "failed"] }).notNull().default("uploaded"),
  progress: integer("progress").notNull().default(0),
  model: text("model"),
  device: text("device", { enum: ["webgpu", "wasm"] }),
  language: text("language"),
  transcript: text("transcript", { mode: "json" }).$type<TranscriptDocument>(),
  transcriptCheckpoint: text("transcript_checkpoint", { mode: "json" }).$type<TranscriptCheckpoint>(),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Immutable non-destructive edit revisions. The plan records intent (removed words / silence /
// subtitles); keepRanges records the exact source-time result executed by FFmpeg for reproducible
// rerenders and future Agent diffs.
export const mediaEdits = sqliteTable("media_edits", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull().references(() => mediaSources.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(1),
  operationId: text("operation_id"),
  baseRevision: integer("base_revision").notNull().default(0),
  actor: text("actor", { enum: ["human", "agent", "cli", "mcp", "api"] }).notNull().default("human"),
  plan: text("plan", { mode: "json" }).$type<TranscriptEditPlan>().notNull(),
  keepRanges: text("keep_ranges", { mode: "json" }).$type<TimeRange[]>().notNull(),
  summary: text("summary", { mode: "json" }).$type<TranscriptEditSummary>(),
  compositionId: text("composition_id").references(() => compositions.id, { onDelete: "set null" }),
  status: text("status", { enum: ["queued", "rendering", "done", "failed"] }).notNull().default("queued"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("media_edits_operation_id_unique").on(table.operationId),
  uniqueIndex("media_edits_source_revision_unique").on(table.sourceId, table.revision),
]);

// Server-side pipeline runs — the hands-off chain (judge → stock-fill → compose) as a
// persistent record instead of a string of browser fetches. Closing the tab no longer kills
// the run: the page re-attaches via GET and a failed/interrupted run can resume from its
// recorded stage instead of starting over.
export const pipelineRuns = sqliteTable("pipeline_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  scriptId: text("script_id"),
  // the stage currently executing — on failure it marks the breakpoint to resume from
  stage: text("stage", { enum: ["judge", "stock_fill", "compose"] }).notNull().default("judge"),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull().default("running"),
  compositionId: text("composition_id"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Batch jobs — a /batch run persisted the moment it starts. The executor still lives in the
// page (items only progress while it is open), but progress and per-item output links survive
// any refresh/crash, and an unfinished job offers "continue where it left off" on reload.
export const batchJobs = sqliteTable("batch_jobs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  status: text("status", { enum: ["running", "done", "cancelled"] }).notNull().default("running"),
  total: integer("total").notNull().default(0),
  // full run config: videoMode/scriptStyle/duration/toggles + the anti-homogenization plan,
  // so a resumed job re-runs remaining items with identical settings and variation slots
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Batch job items — one row per product in the batch, back-linking the produced project and
// composition so nothing rendered is ever orphaned from its batch.
export const batchJobItems = sqliteTable("batch_job_items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  jobId: text("job_id").notNull().references(() => batchJobs.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  productName: text("product_name").notNull(),
  // human-readable variation-slot summary (display only; the machine slot lives in job config)
  variation: text("variation"),
  projectId: text("project_id"),
  compositionId: text("composition_id"),
  status: text("status", { enum: ["pending", "generating", "composing", "done", "failed"] }).notNull().default("pending"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
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

// User-owned ad-template recipes ("my templates"): AI-generated recipes saved for reuse
// and recipes imported from shared JSON. The built-in curated library stays in code
// (ad-templates.ts); this table only holds what the user creates or brings in.
export const adTemplateRecipes = sqliteTable("ad_template_recipes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // Full AdTemplate recipe (already sanitized/validated at write time)
  recipe: text("recipe", { mode: "json" }).notNull(),
  // Where it came from: ai=saved from AI custom generation, import=shared JSON import, edit=recipe-editor fork
  // (TS-level enum only — SQLite column is plain TEXT, so extending needs no migration)
  source: text("source", { enum: ["ai", "import", "edit"] }).notNull().default("ai"),
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

/**
 * Script-defined character for dialogue-driven scripts (drama style): the LLM invents the cast per
 * script, so characters live inside the script row (NOT the global `characters` presenter library).
 * `gender` drives free multi-voice TTS assignment; `appearance` is the visual anchor injected into
 * every shot prompt featuring this character for cross-shot consistency.
 */
export interface ScriptCharacter {
  id: string;
  name: string;
  gender: "female" | "male";
  /** One-line persona, e.g. "毒舌闺蜜，嘴狠心软" */
  persona?: string;
  /** Visual anchor: hair + outfit color + age band, e.g. "黑色长直发、米色针织衫、25岁" */
  appearance?: string;
}

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
