#!/usr/bin/env node
/**
 * ClipForge MCP Server — exposes ClipForge's "one-sentence-to-video" pipeline as MCP tools,
 * allowing any MCP client (Claude Desktop / Claude Code / Cursor, etc.) to drive video generation directly.
 *
 * Design: this service is a thin wrapper around the ClipForge HTTP API (reusing all its orchestration:
 * DB / FFmpeg / free TTS / free stock), communicating with the client via stdio.
 * Only "generate script" requires an LLM Key; Openverse stock + Edge TTS are fully key-free.
 *
 * Environment variables:
 *   CLIPFORGE_BASE_URL     ClipForge instance URL (default http://localhost:3000; run `pnpm dev` / `pnpm start` first)
 *   CLIPFORGE_LLM_BASE_URL LLM endpoint (OpenAI-compatible, e.g. https://api.atlascloud.ai/v1)
 *   CLIPFORGE_LLM_API_KEY  LLM key (required for script generation; omitting it gives a clear prompt in create_video / generate_script)
 *   CLIPFORGE_LLM_MODEL    LLM model name (e.g. deepseek-ai/deepseek-v3.2)
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = (process.env.CLIPFORGE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const LLM = {
  baseUrl: process.env.CLIPFORGE_LLM_BASE_URL || "",
  apiKey: process.env.CLIPFORGE_LLM_API_KEY || "",
  model: process.env.CLIPFORGE_LLM_MODEL || "",
};

// Free stock source keys (optional): when provided, adds high-quality Pexels/Pixabay video; without them, keyless Wikimedia video + Openverse images are still available
const STOCK_KEYS = {};
if (process.env.CLIPFORGE_PIXABAY_KEY) STOCK_KEYS.pixabay = process.env.CLIPFORGE_PIXABAY_KEY;
if (process.env.CLIPFORGE_PEXELS_KEY) STOCK_KEYS.pexels = process.env.CLIPFORGE_PEXELS_KEY;

const NARRATION_STYLES = ["knowledge", "story", "lifestyle", "inspiration", "travel"];
const FOOTAGE_KINDS = ["auto", "image", "video"];
const ASPECT_RATIOS = ["9:16", "16:9", "1:1"]; // 9:16 portrait (Douyin/Kuaishou/Reels/Shorts) · 16:9 landscape · 1:1 square
const QUALITY_PRESETS = ["fast", "standard", "hd"]; // maps to real FFmpeg encoding: resolution + x264 preset + crf

/** footage resolution: default "auto" — delegates to stock-fill per shot ("video first, fall back to image" — fully key-free); image/video are explicit overrides */
function resolveMediaType(footage) {
  return FOOTAGE_KINDS.includes(footage) ? footage : "auto";
}

/** Build the compose request body from tool args: free TTS (optional voice) + aspect ratio + quality preset */
function composeBody(args) {
  const body = { freeTts: { enabled: true } };
  if (typeof args.voice === "string" && args.voice) body.freeTts.voice = args.voice;
  if (ASPECT_RATIOS.includes(args.aspectRatio)) body.aspectRatio = args.aspectRatio;
  if (QUALITY_PRESETS.includes(args.quality)) body.renderPreset = args.quality;
  if (args.bgm === true) body.freeBgm = true; // automatically add a free CC background music track
  if (["upbeat", "chill", "energetic", "emotional"].includes(args.bgmMood)) body.bgmMood = args.bgmMood; // BGM mood
  if (args.bgmDuck === true) body.bgmDuck = true; // voiceover ducking (makes narration clearer)
  if (args.karaoke === true) body.karaoke = true; // karaoke word-by-word captions
  if (args.productCard === true) body.productCard = true; // product card overlay (only applies when product image exists)
  if (args.aiDisclosure === true) body.aiDisclosure = true; // AI compliance disclosure label
  if (typeof args.ctaText === "string" && args.ctaText.trim()) body.ctaText = args.ctaText.trim(); // end-card purchase CTA
  return body;
}

/**
 * Pick the default free voice based on the writing system of the topic text (used when no voice is explicitly specified).
 * Without this, English/Japanese/Korean topics would be read with the Chinese default voice, producing garbled pronunciation.
 * Returns null = use the server-side Chinese default.
 * Hiragana/Katakana → Japanese, Hangul → Korean, CJK → Chinese (null), everything else (Latin, etc.) → English.
 * Latin-script languages like Spanish cannot be distinguished by script alone — must be specified explicitly.
 */
export function defaultVoiceForTopic(topic) {
  const t = String(topic || "");
  if (/[぀-ヿ]/.test(t)) return "ja-JP-NanamiNeural"; // hiragana/katakana → Japanese
  if (/[가-힯]/.test(t)) return "ko-KR-SunHiNeural"; // hangul → Korean (bundled Noto CJK subtitle font covers hangul)
  if (/[一-鿿]/.test(t)) return null; // CJK → Chinese default
  return "en-US-AriaNeural"; // Latin etc. → English
}

/** Shared "output options" JSON-Schema properties for create_video / compose */
const OUTPUT_OPTION_PROPS = {
  voice: { type: "string", description: "Edge TTS 音色 value（见 clipforge_list_voices）。create_video 不指定则按主题语言自动挑（英文主题→英文音色，日/韩同理；中文→晓晓）" },
  aspectRatio: { type: "string", enum: ASPECT_RATIOS, description: "画幅，默认 9:16 竖屏" },
  quality: { type: "string", enum: QUALITY_PRESETS, description: "画质预设 fast/standard/hd，默认 standard" },
  bgm: {
    type: "boolean",
    description: "是否自动加一段免费 CC 背景音乐（Openverse keyless，混在旁白下方自动压低）。CC 音乐多需署名，默认 false",
  },
  karaoke: {
    type: "boolean",
    description: "卡拉OK逐字高亮字幕（整句留屏、逐字随旁白变色，2026 爆款字幕样式）。默认 false（默认是 rapid 短句卡字幕）",
  },
  productCard: {
    type: "boolean",
    description: "带货商品卡贴片（左下角商品图缩略+名+价+购买引导）。仅对有商品图的带货项目生效，topic 视频无效。默认 false",
  },
  bgmMood: {
    type: "string",
    enum: ["upbeat", "chill", "energetic", "emotional"],
    description: "免费 BGM 的情绪（需 bgm=true）：upbeat 欢快 / chill 舒缓 / energetic 动感 / emotional 情感。不传则按商品品类自动挑",
  },
  bgmDuck: {
    type: "boolean",
    description: "旁白闪避：旁白一响自动压低 BGM、停顿回升，旁白更清晰（需有 BGM）。默认 false",
  },
  aiDisclosure: {
    type: "boolean",
    description: "烧「AI 生成」合规标识（抖音/TikTok 对 AI 合成内容的要求；另含 GB45438 隐式文件元数据始终写入）。默认 false",
  },
  ctaText: {
    type: "string",
    description: "片尾购买 CTA 文案（如「👇 点击下方小黄车下单」），不传则不加片尾 CTA",
  },
};

/** Call the ClipForge HTTP API; throws an error with the backend error message on non-2xx responses */
async function api(path, { method = "GET", body, timeoutMs = 600000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  let text;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    // Reading the body must also be within the timeout guard: fetch only resolves when response headers arrive; the timer must stay active to abort a stalled body read
    text = await res.text();
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`请求超时：${path}`);
    throw new Error(`连不上 ClipForge（${BASE_URL}）。请先启动实例：pnpm dev 或 pnpm start。原始错误：${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error || data?.raw || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.payload = data;
    throw err;
  }
  return data;
}

/** Ensure LLM config is ready before generating a script; otherwise throw an actionable error */
function requireLlm() {
  if (!LLM.baseUrl || !LLM.apiKey || !LLM.model) {
    throw new Error(
      "生成脚本需要 LLM。请为 MCP 服务设置环境变量：CLIPFORGE_LLM_BASE_URL、CLIPFORGE_LLM_API_KEY、CLIPFORGE_LLM_MODEL（OpenAI 兼容接口，如 Atlas Cloud / DeepSeek / OpenRouter）。",
    );
  }
}

/**
 * Poll for compose result until done/failed (compose is async: it returns compositionId immediately and runs in the background).
 * Pass the compositionId returned by POST to poll that exact run — polling "latest" is racy when
 * concurrent composes (retries, A/B variants) exist. No-id fallback kept for older servers whose
 * GET does not support ?compositionId=. Client deadline (660s) intentionally exceeds the server-side
 * render timeout (600s, composer COMPOSE_TIMEOUT_MS) so slow-but-successful renders aren't misreported.
 */
async function pollCompose(projectId, { compositionId, timeoutMs = 660000, intervalMs = 2500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const query = compositionId ? `?compositionId=${encodeURIComponent(compositionId)}` : "";
  // Note: loops within the given time budget; Date.now() is used only for timeout control, not randomness
  for (;;) {
    const { composition } = await api(`/api/project/${projectId}/compose${query}`);
    const status = composition?.status;
    if (status === "done") return composition;
    if (status === "failed") throw new Error("合成失败（FFmpeg/TTS 出错），请检查素材与脚本");
    if (Date.now() > deadline) throw new Error("合成超时，可稍后用 clipforge_get_video 再查结果");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function absVideoUrl(composition) {
  return composition?.url ? `${BASE_URL}${composition.url}` : null;
}

function ok(textObj) {
  const text = typeof textObj === "string" ? textObj : JSON.stringify(textObj, null, 2);
  return { content: [{ type: "text", text }] };
}

// ---- Tool definitions (JSON Schema, no zod required) ----
const TOOLS = [
  {
    name: "clipforge_create_video",
    description:
      "一句话成片：输入一个主题，自动写旁白脚本→从免费素材库配齐画面→免费 AI 配音+字幕→FFmpeg 合成竖屏短视频，返回可下载的视频地址。需要为 MCP 配置 LLM 环境变量；素材与配音全程免 Key。",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "一句话主题，如「在家如何泡一杯手冲咖啡」" },
        narrationStyle: { type: "string", enum: NARRATION_STYLES, description: "旁白风格，默认 knowledge" },
        durationSec: { type: "number", description: "目标时长（秒），默认 25" },
        footage: {
          type: "string",
          enum: FOOTAGE_KINDS,
          description: "画面类型：auto（默认，逐镜视频优先、配不到再退图片，全程免 Key）/ image（只图片，最快）/ video（只视频）",
        },
        ...OUTPUT_OPTION_PROPS,
      },
      required: ["topic"],
    },
  },
  {
    name: "clipforge_ingest_product",
    description:
      "贴一个商品页链接，自动抓取标题/价格/商品图（解析优先级 schema.org JSON-LD > OpenGraph > Twitter Card > 标题/meta），可一键建带货项目并下载前几张商品图。带货成片的「链接优先」入口。不需要 LLM；对带标准 OG/JSON-LD 标签的页面（Shopify、独立站、TikTok Shop 等）支持最好，部分平台有反爬可能解析不全。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "商品页链接（http/https）" },
        createProject: {
          type: "boolean",
          description: "是否一键建带货项目并下载前几张商品图，默认 true；false 则仅返回解析出的商品信息不落库",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "clipforge_generate_script",
    description:
      "只生成去商品化的旁白分镜脚本（不配画面/不合成），返回 projectId 与各分镜（含英文素材检索词）。需要 LLM 环境变量。",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "一句话主题" },
        narrationStyle: { type: "string", enum: NARRATION_STYLES, description: "旁白风格，默认 knowledge" },
        durationSec: { type: "number", description: "目标时长（秒），默认 25" },
      },
      required: ["topic"],
    },
  },
  {
    name: "clipforge_search_stock",
    description:
      "从免费可商用素材库检索画面（keyless Openverse 图片优先；配了 Pexels/Pixabay Key 的实例还会聚合视频）。检索词建议英文。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索词（建议英文，召回更好）" },
        mediaType: { type: "string", enum: ["image", "video", "audio"], description: "媒体类型，默认 image" },
        limit: { type: "number", description: "返回条数，默认 8" },
      },
      required: ["query"],
    },
  },
  {
    name: "clipforge_list_projects",
    description: "列出 ClipForge 里的项目（id / 名称 / 类型 / 状态）。不需要 LLM。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "clipforge_compose",
    description:
      "为一个已有脚本+素材的项目执行合成（免费 Edge TTS 配音+字幕），返回可下载的视频地址。用于 generate_script 之后单独出片。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID（来自 list_projects / generate_script）" },
        autoFillStock: { type: "boolean", description: "合成前是否先自动从免费素材库配齐缺画面的分镜，默认 true" },
        footage: { type: "string", enum: FOOTAGE_KINDS, description: "自动配画面的类型，默认 auto" },
        ...OUTPUT_OPTION_PROPS,
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_list_voices",
    description: "列出可用的免费 Edge TTS 多语言音色（中/英/日/韩/西，含 value/label/gender/lang）及默认音色，供 create_video / compose 的 voice 参数选用。不需要 LLM。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "clipforge_get_video",
    description:
      "查询某项目最新一次合成的视频结果（状态 / 可下载地址），不触发重新合成——用于轮询 create_video/compose 的异步产物或取回此前做过的视频。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "项目 ID" } },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_trends",
    description:
      "拉某地区每日热搜，建议「该做什么主题」（含热度 + 相关新闻背景），可直接当 clipforge_create_video 的 topic。免 Key，不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: { geo: { type: "string", description: "地区两字母码，如 US/JP/GB，默认 US（en 系国家覆盖最全）" } },
    },
  },
  {
    name: "clipforge_import_script",
    description:
      "把你已经写好的整段旁白导入某项目，自动切成分镜（免 AI 生成），之后用 clipforge_compose 出片。配合本地素材即「自带稿子+自带素材」全自主成片。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID（来自 list_projects）" },
        script: { type: "string", description: "你写好的整段旁白文案" },
        title: { type: "string", description: "可选标题" },
      },
      required: ["projectId", "script"],
    },
  },
  {
    name: "clipforge_dub",
    description:
      "把某项目当前脚本翻成目标语种、存为译制版（出海：同片换语种发不同市场，画面不变只换声音字幕）。返回推荐音色，再用 clipforge_compose 传该 voice 出译制版。需要 LLM 环境变量。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID" },
        targetLang: { type: "string", description: "目标语种码，如 en/ja/ko/es" },
      },
      required: ["projectId", "targetLang"],
    },
  },
  {
    name: "clipforge_cover",
    description:
      "从某项目最新成片抽一帧 + 叠加大标题生成封面图/缩略图（提升点击率）。需先合成过视频。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID" },
        title: { type: "string", description: "封面标题（短而吸睛）" },
        position: { type: "string", enum: ["center", "lower", "upper"], description: "标题位置，默认 center" },
        frameAt: { type: "number", description: "抽帧位置（秒），默认 1" },
      },
      required: ["projectId", "title"],
    },
  },
  {
    name: "clipforge_shop_qr",
    description:
      "为某项目的商品链接生成「扫码购买」二维码 PNG（可放片尾引导转化）。编码的链接自动打 UTM 追踪参数（utm_source=平台、campaign=clipforge）。项目需已有商品链接（ingest 商品链接会自动保留），或用 url 传入。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID" },
        url: { type: "string", description: "商品链接（不填则用项目已存的 shopUrl）" },
        platform: { type: "string", description: "投放平台（作为 utm_source，如 douyin/tiktok/xiaohongshu）" },
        size: { type: "number", description: "二维码边长像素，默认 512" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_end_card",
    description:
      "把「扫码购买」二维码烧进某项目最新成片的片尾最后几秒（后处理，不改合成管线），输出新 mp4，引导扫码转化。二维码编码项目商品链接（UTM 追踪）。需先合成过视频、且项目有商品链接（或用 url 传入）。CTA 文字默认关闭（易与视频自带贴片重叠），可 ctaText 开启。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID" },
        url: { type: "string", description: "商品链接（不填则用项目已存的 shopUrl）" },
        platform: { type: "string", description: "投放平台（作为 utm_source）" },
        seconds: { type: "number", description: "片尾展示二维码的秒数，默认 3" },
        ctaText: { type: "string", description: "二维码上方 CTA 文字（可选，默认不加，避免与视频贴片重叠）" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_preview_gif",
    description:
      "从某项目最新成片切一小段转成循环 GIF 预览（分享 / 嵌入 / 列表 hover 用）。需先合成过视频。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID" },
        startSec: { type: "number", description: "起始秒，默认 0" },
        durationSec: { type: "number", description: "时长秒（1-10），默认 4" },
        width: { type: "number", description: "宽度 px，默认 360" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_export_subtitle",
    description:
      "导出某项目脚本字幕为 SRT 或 WebVTT（二次剪辑 / 平台原生字幕 / 无障碍）。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID" },
        format: { type: "string", enum: ["srt", "vtt"], description: "字幕格式，默认 srt" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_carousel",
    description:
      "把某项目脚本渲成小红书图文卡片（标题卡 + 逐条要点卡，渐变底，默认 3:4），返回各卡片图地址。视频之外的图文输出。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "项目 ID" },
        width: { type: "number", description: "卡片宽 px，默认 1080" },
        height: { type: "number", description: "卡片高 px，默认 1440（3:4）" },
        theme: { type: "string", enum: ["night", "warm", "mint", "mono", "rose"], description: "卡片主题色，默认 night" },
      },
      required: ["projectId"],
    },
  },
];

// ---- Tool handlers ----
async function handleCreateVideo(args) {
  requireLlm();
  const topic = String(args.topic || "").trim();
  if (topic.length < 2) throw new Error("topic 太短，请给一个完整的一句话主题");
  const narrationStyle = NARRATION_STYLES.includes(args.narrationStyle) ? args.narrationStyle : "knowledge";
  const targetDuration = Number.isFinite(args.durationSec) ? Number(args.durationSec) : 25;

  // 1) generate script
  const scriptRes = await api("/api/topic/script", {
    method: "POST",
    body: { topic, narrationStyle, targetDuration, llmConfig: LLM },
  });
  const projectId = scriptRes.projectId;
  const shots = scriptRes?.scripts?.[0]?.shots ?? [];

  // 2) match visuals: free Openverse images by default; with Pexels/Pixabay keys, fetches video B-roll per footage setting
  const mediaType = resolveMediaType(args.footage);
  const fill = await api(`/api/project/${projectId}/stock-fill`, {
    method: "POST",
    body: { source: "all", mediaType, apiKeys: STOCK_KEYS },
  });
  // if no visuals were matched at all, don't force a compose (it would produce a blank/failed video) — return an actionable hint instead
  if (!fill.filled) {
    return ok({
      ok: false,
      projectId,
      footage: mediaType,
      footageFilled: `0/${fill.total}`,
      error:
        "免费素材库没给这个主题配到任何画面，无法合成。换个更常见/更具体的主题，或为实例配 Pexels/Pixabay Key（CLIPFORGE_PEXELS_KEY）后重试。",
    });
  }

  // 3) compose (free Edge TTS voiceover + captions; optional voice/aspect ratio/quality)
  const body = composeBody(args);
  // if no voice is explicitly specified, pick a default based on the topic language (English topic → English voice, to avoid Chinese voice reading English)
  if (!body.freeTts.voice) {
    const v = defaultVoiceForTopic(topic);
    if (v) body.freeTts.voice = v;
  }
  // actual voice sent to the backend (including auto-detection above); do NOT call composeBody(args) again — that would produce a fresh body without detection, reporting the wrong voice
  const usedVoice = body.freeTts.voice || "zh-CN-XiaoxiaoNeural";
  // POST returns the compositionId of this run — poll that exact one, not "latest"
  const { compositionId } = await api(`/api/project/${projectId}/compose`, { method: "POST", body });
  const composition = await pollCompose(projectId, { compositionId });

  return ok({
    ok: true,
    projectId,
    topic,
    narrationStyle,
    footage: mediaType,
    voice: usedVoice,
    aspectRatio: ASPECT_RATIOS.includes(args.aspectRatio) ? args.aspectRatio : "9:16",
    shots: shots.length,
    footageFilled: `${fill.filled}/${fill.total}`,
    videoUrl: absVideoUrl(composition),
    status: composition.status,
    hint: "videoUrl 可直接下载/播放（mp4）。在 ClipForge 网页 /project/" + projectId + "/export 可进一步多平台导出。",
  });
}

async function handleGenerateScript(args) {
  requireLlm();
  const topic = String(args.topic || "").trim();
  if (topic.length < 2) throw new Error("topic 太短");
  const narrationStyle = NARRATION_STYLES.includes(args.narrationStyle) ? args.narrationStyle : "knowledge";
  const targetDuration = Number.isFinite(args.durationSec) ? Number(args.durationSec) : 25;
  const res = await api("/api/topic/script", {
    method: "POST",
    body: { topic, narrationStyle, targetDuration, llmConfig: LLM },
  });
  const script = res?.scripts?.[0];
  return ok({
    ok: true,
    projectId: res.projectId,
    title: script?.title ?? "",
    shots: (script?.shots ?? []).map((s) => ({
      shotId: s.shotId,
      duration: s.duration,
      voiceover: s.voiceover,
      stockKeywords: s.stockKeywords ?? [],
    })),
    next: "用 clipforge_compose { projectId } 出片。",
  });
}

async function handleSearchStock(args) {
  const query = String(args.query || "").trim();
  if (!query) throw new Error("query 不能为空");
  const mediaType = ["image", "video", "audio"].includes(args.mediaType) ? args.mediaType : "image";
  const perPage = Number.isFinite(args.limit) ? Math.max(1, Math.min(30, Number(args.limit))) : 8;
  const res = await api("/api/stock/search", {
    method: "POST",
    body: { query, source: "all", mediaType, perPage, download: false, apiKeys: STOCK_KEYS },
  });
  const candidates = (res.candidates ?? []).slice(0, perPage).map((c) => ({
    title: c.title,
    provider: c.source,
    mediaType: c.mediaType,
    preview: c.previewImage,
    pageUrl: c.pageUrl,
    license: c.license,
    author: c.author,
  }));
  return ok({ ok: true, query, count: candidates.length, candidates, skippedSources: res.skippedSources ?? [] });
}

async function handleListProjects() {
  const rows = await api("/api/project");
  const list = (Array.isArray(rows) ? rows : []).map((p) => ({
    id: p.id,
    name: p.name,
    contentType: p.contentType,
    status: p.status,
    topic: p.topic ?? undefined,
  }));
  return ok({ ok: true, count: list.length, projects: list });
}

async function handleCompose(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const autoFill = args.autoFillStock !== false;
  if (autoFill) {
    await api(`/api/project/${projectId}/stock-fill`, {
      method: "POST",
      body: { source: "all", mediaType: resolveMediaType(args.footage), apiKeys: STOCK_KEYS },
    }).catch(() => {}); // stock-fill failure does not block compose (project may already have assets)
  }
  const body = composeBody(args);
  // if no voice is explicitly specified, pick a default based on the project topic language (same logic as create_video) — otherwise Japanese/Korean topics via compose would fall back to the Chinese default voice and mispronounce
  if (!body.freeTts.voice) {
    const proj = await api(`/api/project/${projectId}`).catch(() => null);
    const v = proj && proj.topic ? defaultVoiceForTopic(String(proj.topic)) : null;
    if (v) body.freeTts.voice = v;
  }
  // POST returns the compositionId of this run — poll that exact one, not "latest"
  const { compositionId } = await api(`/api/project/${projectId}/compose`, { method: "POST", body });
  const composition = await pollCompose(projectId, { compositionId });
  return ok({ ok: true, projectId, voice: body.freeTts.voice || "zh-CN-XiaoxiaoNeural", videoUrl: absVideoUrl(composition), status: composition.status });
}

async function handleListVoices() {
  const res = await api("/api/tts/free");
  return ok({ ok: true, default: res.default, voices: res.voices ?? [] });
}

async function handleGetVideo(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const { composition } = await api(`/api/project/${projectId}/compose`);
  if (!composition) {
    return ok({ ok: true, projectId, status: "none", videoUrl: null, hint: "该项目还没有合成记录，用 clipforge_compose 出片。" });
  }
  return ok({ ok: true, projectId, status: composition.status, videoUrl: absVideoUrl(composition) });
}

async function handleIngestProduct(args) {
  const url = String(args.url || "").trim();
  if (!/^https?:\/\/.+/i.test(url)) throw new Error("url 必须是合法的 http/https 商品链接");
  const createProject = args.createProject !== false; // create the project and download images by default
  const data = await api("/api/ingest/product", { method: "POST", body: { url, createProject } });
  return ok({
    ok: true,
    projectId: data.projectId ?? null,
    product: data.product ?? null,
    productImages: data.productImages ?? [],
    hint: data.projectId
      ? "已建带货项目并抓取商品图。下一步：在网页端为该项目生成带货脚本后，用 clipforge_compose 出片（带货脚本需 LLM，暂未走 MCP）。"
      : "仅解析、未建项目（createProject=false）。",
  });
}

// Trending topics → suggest what to make next
async function handleTrends(args) {
  const geo = typeof args.geo === "string" && /^[a-z]{2}$/i.test(args.geo) ? args.geo : "US";
  const res = await api(`/api/trends?geo=${encodeURIComponent(geo)}`);
  return ok({ ok: true, geo: res.geo, count: res.count ?? (res.topics || []).length, topics: res.topics ?? [] });
}

// Import a user-written script → split into shots (no LLM)
async function handleImportScript(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const script = String(args.script || "").trim();
  if (script.length < 2) throw new Error("script 太短，请给完整旁白文案");
  const res = await api(`/api/project/${projectId}/import-script`, {
    method: "POST",
    body: { script, title: typeof args.title === "string" ? args.title : undefined },
  });
  return ok({ ok: true, projectId, scriptId: res.scriptId, shots: res.shots, next: "用 clipforge_compose { projectId } 出片。" });
}

// Dub: translate the current script into another language (needs LLM)
async function handleDub(args) {
  requireLlm();
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const targetLang = String(args.targetLang || "").trim();
  if (!targetLang) throw new Error("targetLang 不能为空（如 en/ja/ko/es）");
  const res = await api(`/api/project/${projectId}/dub`, { method: "POST", body: { targetLang, llmConfig: LLM } });
  return ok({
    ok: true,
    projectId,
    targetLang,
    scriptId: res.scriptId,
    recommendedVoice: res.recommendedVoice ?? null,
    next: `用 clipforge_compose { projectId, voice: "${res.recommendedVoice || "<目标语种音色>"}" } 出译制版。`,
  });
}

// Cover/thumbnail: frame + bold title overlay from the latest composed video
async function handleCover(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const title = String(args.title || "").trim();
  if (!title) throw new Error("title 不能为空");
  const body = { title };
  if (["center", "lower", "upper"].includes(args.position)) body.position = args.position;
  if (Number.isFinite(args.frameAt)) body.frameAt = args.frameAt;
  const res = await api(`/api/project/${projectId}/cover`, { method: "POST", body });
  return ok({ ok: true, projectId, cover: res.cover ? `${BASE_URL}${res.cover}` : null });
}

// Shop "scan to buy" QR from the project's shop link (UTM-tagged)
async function handleShopQr(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const body = {};
  if (typeof args.url === "string" && args.url.trim()) body.url = args.url.trim();
  if (typeof args.platform === "string" && args.platform.trim()) body.platform = args.platform.trim();
  if (Number.isFinite(args.size)) body.size = args.size;
  const res = await api(`/api/project/${projectId}/shop-qr`, { method: "POST", body });
  return ok({ ok: true, projectId, qr: res.qr ? `${BASE_URL}${res.qr}` : null, shopLink: res.shopLink ?? null });
}

// Burn a "scan to buy" QR onto the last few seconds of the composed video
async function handleEndCard(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const body = {};
  if (typeof args.url === "string" && args.url.trim()) body.url = args.url.trim();
  if (typeof args.platform === "string" && args.platform.trim()) body.platform = args.platform.trim();
  if (Number.isFinite(args.seconds)) body.seconds = args.seconds;
  if (typeof args.ctaText === "string" && args.ctaText.trim()) body.ctaText = args.ctaText.trim();
  const res = await api(`/api/project/${projectId}/end-card`, { method: "POST", body });
  return ok({ ok: true, projectId, video: res.video ? `${BASE_URL}${res.video}` : null, shopLink: res.shopLink ?? null });
}

// GIF preview from the latest composed video
async function handlePreviewGif(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const body = {};
  if (Number.isFinite(args.startSec)) body.startSec = args.startSec;
  if (Number.isFinite(args.durationSec)) body.durationSec = args.durationSec;
  if (Number.isFinite(args.width)) body.width = args.width;
  const res = await api(`/api/project/${projectId}/preview-gif`, { method: "POST", body });
  return ok({ ok: true, projectId, gif: res.gif ? `${BASE_URL}${res.gif}` : null });
}

// Export the project's subtitles as SRT/WebVTT (the route returns text, wrapped as { raw } by api())
async function handleExportSubtitle(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const format = args.format === "vtt" ? "vtt" : "srt";
  const data = await api(`/api/project/${projectId}/subtitle?format=${format}`);
  const subtitle = typeof data === "string" ? data : data.raw ?? "";
  return ok({ ok: true, projectId, format, subtitle });
}

// Image-card carousel from the script (Xiaohongshu 图文)
async function handleCarousel(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const body = {};
  if (Number.isFinite(args.width)) body.width = args.width;
  if (Number.isFinite(args.height)) body.height = args.height;
  if (typeof args.theme === "string") body.theme = args.theme;
  const res = await api(`/api/project/${projectId}/carousel`, { method: "POST", body });
  return ok({ ok: true, projectId, count: res.count, cards: (res.cards || []).map((c) => `${BASE_URL}${c}`) });
}

const HANDLERS = {
  clipforge_create_video: handleCreateVideo,
  clipforge_ingest_product: handleIngestProduct,
  clipforge_generate_script: handleGenerateScript,
  clipforge_search_stock: handleSearchStock,
  clipforge_list_projects: handleListProjects,
  clipforge_compose: handleCompose,
  clipforge_list_voices: handleListVoices,
  clipforge_get_video: handleGetVideo,
  clipforge_trends: handleTrends,
  clipforge_import_script: handleImportScript,
  clipforge_dub: handleDub,
  clipforge_cover: handleCover,
  clipforge_shop_qr: handleShopQr,
  clipforge_end_card: handleEndCard,
  clipforge_preview_gif: handlePreviewGif,
  clipforge_export_subtitle: handleExportSubtitle,
  clipforge_carousel: handleCarousel,
};

// ---- Start MCP server ----
const server = new Server(
  { name: "clipforge", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const handler = HANDLERS[req.params.name];
  if (!handler) {
    return { content: [{ type: "text", text: `未知工具：${req.params.name}` }], isError: true };
  }
  try {
    return await handler(req.params.arguments ?? {});
  } catch (e) {
    return { content: [{ type: "text", text: `调用失败：${e?.message || e}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// startup log goes to stderr (stdout is reserved for the MCP protocol)
console.error(`ClipForge MCP server 已启动 · 目标实例 ${BASE_URL}`);
