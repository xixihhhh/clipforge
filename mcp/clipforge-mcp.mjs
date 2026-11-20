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
 *   CLIPFORGE_LLM_MODEL    LLM model name (e.g. deepseek-ai/deepseek-v4-pro)
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
const CAPTION_PRESETS = ["standard", "bold", "minimal", "karaoke"]; // caption style presets (mirrors src/lib/caption-presets.ts)

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
  if (Number.isFinite(args.bgmVolume) && args.bgmVolume >= 0.05 && args.bgmVolume <= 0.4) body.bgmVolume = Math.round(args.bgmVolume * 100) / 100; // normalized 0.05-0.4 mix level
  if (args.audioStems === true) body.exportAudioStems = true; // render editable voice/BGM WAV stems after the main composition
  if (args.bgmDuck === true) body.bgmDuck = true; // voiceover ducking (makes narration clearer)
  if (args.karaoke === true) body.karaoke = true; // karaoke word-by-word captions
  if (CAPTION_PRESETS.includes(args.captionPreset)) body.captionPreset = args.captionPreset; // caption style preset
  if (args.productCard === true) body.productCard = true; // product card overlay (only applies when product image exists)
  if (args.aiDisclosure === false) body.aigcBadge = false; // opt OUT of the default-on visible AIGC badge
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
  voice: { type: "string", description: "Edge TTS 音色 value（如 zh-CN-XiaoxiaoNeural / en-US-AriaNeural，必须来自 clipforge_list_voices，猜测的 id 会合成失败或读错语种）。create_video 不指定则按主题语言自动挑（英文主题→英文音色，日/韩同理；中文→晓晓）" },
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
  captionPreset: {
    type: "string",
    enum: CAPTION_PRESETS,
    description:
      "字幕样式预设：standard 白字半透明底板（默认）/ bold 大号粗描边无底板（高留存爆款风）/ minimal 小号细描边（纪实干净画面）/ karaoke 逐字高亮（等价 karaoke=true）",
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
  bgmVolume: {
    type: "number",
    minimum: 0.05,
    maximum: 0.4,
    description: "背景音乐混音强度，0.05-0.4（默认 0.18）；有旁白时仍会自动闪避",
  },
  audioStems: {
    type: "boolean",
    description: "额外导出可编辑的旁白和 BGM WAV 音轨；完成后从 composition.timelineUrl sidecar 的 audioStems 读取下载地址；默认 false（会增加一次音频渲染）",
  },
  aiDisclosure: {
    type: "boolean",
    description:
      "「内容由 AI 生成」显式角标（片头左上角 ≥2 秒，2026-07 抖音新规要求，仅 AI 配音也须标注）。默认 true（自动烧录）；设 false 关闭——发布门禁会提示限流风险。GB45438 隐式文件元数据始终写入，不受此开关影响",
  },
  ctaText: {
    type: "string",
    description: "片尾购买 CTA 文案（如「👇 点击下方小黄车下单」），不传则不加片尾 CTA",
  },
};

/** Shared projectId schema property — most tools operate on an existing project */
const PROJECT_ID_PROP = {
  type: "string",
  description: "项目 ID（来自 clipforge_list_projects，或 create/ingest/generate 类工具返回的 projectId）",
};

const TRANSCRIPT_PLAN_PROP = {
  type: "object",
  description: "完整剪辑计划快照；先 inspect 获取词 ID 和 latestPlan，再修改后 preview",
  properties: {
    version: { type: "number", enum: [1] },
    removedWordIds: { type: "array", items: { type: "string" }, description: "要删除的稳定词 ID 数组" },
    removeSilence: { type: "boolean" },
    silencePaddingMs: { type: "number", description: "静音两端保留毫秒，0-1000" },
    wordPaddingMs: { type: "number", description: "删词两端扩展毫秒，0-250" },
    burnSubtitles: { type: "boolean" },
    captionReplacements: { type: "array", maxItems: 200, description: "字幕词组校对，只影响字幕；同一组词 ID 必须连续且各组不重叠", items: { type: "object", properties: { wordIds: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } }, text: { type: "string", minLength: 1, maxLength: 240 } }, required: ["wordIds", "text"] } },
    sourceRange: {
      type: "object", description: "可选：只保留原片的这个连续区间（秒），区间内仍可删词/去静音；省略则使用完整原片",
      properties: { start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 } },
      required: ["start", "end"],
    },
  },
  required: ["version", "removedWordIds", "removeSilence", "silencePaddingMs", "wordPaddingMs", "burnSubtitles"],
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
      "一句话成片：输入一个主题，自动写旁白脚本→判官团（节奏/口语/创意/结构/画面五判官）自动挑刺并重写弱句→从免费素材库配齐画面→免费 AI 配音+字幕→FFmpeg 合成竖屏短视频，返回可下载的视频地址。需要为 MCP 配置 LLM 环境变量；素材与配音全程免 Key。",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "一句话主题，如「在家如何泡一杯手冲咖啡」" },
        narrationStyle: { type: "string", enum: NARRATION_STYLES, description: "旁白风格，默认 knowledge" },
        durationSec: { type: "number", description: "目标时长（秒），默认 25，建议 15-60" },
        footage: {
          type: "string",
          enum: FOOTAGE_KINDS,
          description: "画面类型：auto（默认，逐镜视频优先、配不到再退图片，全程免 Key）/ image（只图片，最快）/ video（只视频）",
        },
        wait: {
          type: "boolean",
          description:
            "默认 true=等合成完成后返回视频地址（最长约 11 分钟，MCP 客户端超时较短时可能被掐断）。false=提交合成后立即返回 compositionId，用 clipforge_get_video { projectId, compositionId } 轮询取片——长视频/严格超时环境推荐 false。",
        },
        ...OUTPUT_OPTION_PROPS,
      },
      required: ["topic"],
    },
  },
  {
    name: "clipforge_ingest_product",
    description:
      "贴一个商品页链接，自动抓取标题/价格/商品图（解析优先级 schema.org JSON-LD > OpenGraph > Twitter Card > 标题/meta），可一键建带货项目并下载前几张商品图。带货成片的「链接优先」入口。返回 projectId、解析出的商品信息与已下载商品图列表。不需要 LLM；对带标准 OG/JSON-LD 标签的页面（Shopify、独立站、TikTok Shop 等）支持最好，部分平台有反爬可能解析不全。",
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
    name: "clipforge_product_script",
    description:
      "带货脚本一条龙：贴商品链接 → 自动抓取商品信息（标题/价/图）→ LLM 生成多套带货分镜脚本，返回 projectId 与脚本数据。等于 clipforge_ingest_product + 网页端「生成带货脚本」两步合一，agent 一句话即可从链接到脚本。生成时会自动结合你已发布视频的转化数据（数据飞轮）偏向更能卖的风格/钩子。之后用 clipforge_compose { projectId } 出片。需要 LLM 环境变量。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "商品页链接（http/https）" },
        styleType: {
          type: "string",
          enum: ["pain_point", "scene", "comparison", "story", "drama", "reversal", "interview", "unboxing", "product_pov", "talking_head", "auto"],
          description:
            "脚本风格（四大形态）：剧情形 drama 情景短剧(双角色冲突对话+免费多音色)/reversal 反转剧场/interview 街头采访(主持人+路人)/story 剧情故事；物品形 unboxing 开箱测评/product_pov 物品拟人(商品第一人称)/comparison 对比测评；口播形 talking_head 达人口播/pain_point 痛点种草；场景形 scene 场景安利。默认 auto（按历史转化数据智能推荐）",
        },
        durationSec: { type: "number", description: "目标时长（秒），默认 30，建议 15-60" },
        category: {
          type: "string",
          enum: ["beauty", "food", "home", "fashion", "tech", "other"],
          description: "商品品类（美妆/食品/家居/服饰/数码/其他），用于风格模板与转化数据分品类回流；不填则按 beauty 兜底",
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
        durationSec: { type: "number", description: "目标时长（秒），默认 25，建议 15-60" },
      },
      required: ["topic"],
    },
  },
  {
    name: "clipforge_search_stock",
    description:
      "从免费可商用素材库检索画面（keyless Openverse 图片优先；配了 Pexels/Pixabay Key 的实例还会聚合视频）。返回候选列表（title/provider/license/author/预览图与来源页链接），只检索不下载——用于人工挑素材或核对授权；自动配画面无需先调它（create_video/compose 内置逐镜配片）。检索词建议英文。不需要 LLM。",
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
    description: "列出 ClipForge 里的项目。返回项目数组（id / 名称 / 类型 / 状态 / 主题），后续工具的 projectId 从这里取。不需要 LLM。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "clipforge_compose",
    description:
      "为一个已有脚本+素材的项目执行合成（免费 Edge TTS 配音+字幕），返回可下载的视频地址。用于 generate_script 之后单独出片。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        autoFillStock: { type: "boolean", description: "合成前是否先自动从免费素材库配齐缺画面的分镜，默认 true" },
        footage: { type: "string", enum: FOOTAGE_KINDS, description: "自动配画面的类型，默认 auto" },
        wait: {
          type: "boolean",
          description:
            "默认 true=等合成完成后返回视频地址。false=提交后立即返回 compositionId，用 clipforge_get_video { projectId, compositionId } 轮询——长视频/严格超时环境推荐 false。",
        },
        ...OUTPUT_OPTION_PROPS,
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_update_shots",
    description:
      "单句精修：只改指定分镜的台词/画面描述/运镜，不动其他镜头——配合 clipforge_gate / clipforge_qc 的反馈做点改（如「第3镜台词拖」），改完重新 clipforge_compose 出片即可，不必整篇重生成（重生成会丢掉判官团已做的重写）。建议改完台词可再跑一次判官（重新 compose 前无强制要求）。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        scriptId: { type: "string", description: "要改的脚本 id；缺省时改当前选中的脚本" },
        shots: {
          type: "array",
          description: "要修改的分镜列表（只传要改的字段）",
          items: {
            type: "object",
            properties: {
              shotId: { type: "number", description: "分镜编号" },
              voiceover: { type: "string", description: "新台词（长度尽量与原句相当，配音时长钉在分镜槽里）" },
              description: { type: "string", description: "新画面描述（写可见动作：谁做什么）" },
              camera: { type: "string", description: "新运镜描述" },
            },
            required: ["shotId"],
          },
        },
      },
      required: ["projectId", "shots"],
    },
  },
  {
    name: "clipforge_list_voices",
    description: "列出可用的免费 Edge TTS 多语言音色（中/英/日/韩/西）。返回音色数组（value/label/gender/lang）与默认音色，create_video / compose 的 voice 参数只能从这里选。不需要 LLM。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "clipforge_get_video",
    description:
      "查询某项目合成的视频结果，不触发重新合成——用于轮询 create_video/compose 的异步产物或取回此前做过的视频。传 compositionId 可查指定那一次合成（并发合成时防串片）；缺省查最新一次。返回状态（composing/done/failed/none）与可下载的 mp4 地址。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        compositionId: { type: "string", description: "某次合成的 id（compose/create_video 在 wait:false 时返回）；缺省查最新一次" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_trends",
    description:
      "拉某地区每日热搜，建议「该做什么主题」。返回话题数组（含热度 + 相关新闻背景），条目可直接当 clipforge_create_video 的 topic。免 Key，不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: { geo: { type: "string", description: "地区两字母码，如 US/JP/GB，默认 US（en 系国家覆盖最全）" } },
    },
  },
  {
    name: "clipforge_import_script",
    description:
      "把你已经写好的整段旁白导入某项目，自动切成分镜（免 AI 生成），之后用 clipforge_compose 出片。配合本地素材即「自带稿子+自带素材」全自主成片。返回 scriptId 与切出的分镜数。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
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
        projectId: PROJECT_ID_PROP,
        targetLang: { type: "string", description: "目标语种码，如 en。免费音色覆盖 en/ja/ko/es/zh/fr/de，其它语种可译出但需自备音色" },
      },
      required: ["projectId", "targetLang"],
    },
  },
  {
    name: "clipforge_cover",
    description:
      "从某项目最新成片抽一帧 + 叠加大标题生成封面图/缩略图（提升点击率）。返回封面 PNG 地址。需先合成过视频。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
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
      "为某项目的商品链接生成「扫码购买」二维码 PNG（适合私域分发：微信群/朋友圈/详情页）。编码的链接自动打 UTM 追踪参数（utm_source=平台、campaign=clipforge）。返回二维码 PNG 地址与实际编码的 shopLink；指定国内平台时返回 warning 提示站外导流风险（抖音等平台处罚成片内二维码，独立 PNG 不受影响）。项目需已有商品链接（ingest 商品链接会自动保留），或用 url 传入。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
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
      "把「扫码购买」二维码烧进某项目最新成片的片尾最后几秒（后处理，不改合成管线），引导扫码转化。⚠️ 站外导流风险：platform=douyin 默认拒绝（抖音 2026-07 起成片内二维码首违关橱窗 7 天、二违永久收回带货权限，force=true 可强制）；其他国内平台会生成但返回 warning；tiktok/reels/shorts 无此风险。二维码编码项目商品链接（UTM 追踪）。返回处理后的新 mp4 地址与 shopLink（不覆盖原片），必要时含 warning。需先合成过视频、且项目有商品链接（或用 url 传入）。CTA 文字默认关闭（易与视频自带贴片重叠），可 ctaText 开启。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        url: { type: "string", description: "商品链接（不填则用项目已存的 shopUrl）" },
        platform: {
          type: "string",
          description: "目标平台（作为 utm_source 并触发平台风险把关）：douyin 默认拒绝烧码、kuaishou/xiaohongshu/shipinhao 带警告、tiktok/reels/shorts 无风险。不传则按「未知平台」附带提醒",
        },
        force: { type: "boolean", description: "true = 明知抖音站外导流处罚仍强制烧码（仅私域分发场景建议）。默认 false" },
        seconds: { type: "number", description: "片尾展示二维码的秒数，默认 3" },
        ctaText: { type: "string", description: "二维码上方 CTA 文字（可选，默认不加，避免与视频贴片重叠）" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_export_platform",
    description:
      "把某项目成片按目标平台规格导出（后处理重编码，不改合成管线）：按平台画幅选择模糊填充、黑边留白或指定位置裁切 + 按平台编码预算限制码率（CRF+VBV 双约束，抖音 6000kbps / Reels 5000 / 其余 8000）+ 导出后 ffprobe 实测回读，返回「实测码率 vs 编码目标」双语报告（report.withinCap 仅表示符合本地编码预算，平台仍可能重新编码）。默认使用最新一次成功合成；可传 compositionId 固定某次成功合成，便于批量/审计复现。支持 douyin|kuaishou|xiaohongshu|shipinhao|tiktok|reels|shorts。需先合成过视频。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        platform: { type: "string", enum: ["douyin", "kuaishou", "xiaohongshu", "shipinhao", "tiktok", "reels", "shorts"], description: "目标平台" },
        compositionId: { type: "string", description: "指定要导出的成功合成 ID（不填则使用最新一次成功合成）" },
        framing: { type: "object", description: "构图设置，默认 blur 完整保留。crop 会裁掉画幅外的内容和烧录字幕，请先预览。", properties: {
          mode: { type: "string", enum: ["blur", "fit", "crop"] },
          positionX: { type: "number", minimum: 0, maximum: 1, description: "水平裁切位置，0 左、0.5 中、1 右" },
          positionY: { type: "number", minimum: 0, maximum: 1, description: "垂直裁切位置，0 上、0.5 中、1 下" },
        } },
        preview: { type: "boolean", description: "true 只生成内存中的 JPEG 构图预览，不导出整片" },
        previewTime: { type: "number", minimum: 0, description: "原片预览秒数，默认 0，超出时长时取末帧附近" },
      },
      required: ["projectId", "platform"],
    },
  },
  {
    name: "clipforge_qc",
    description:
      "对某项目最新成片跑自动质检（后处理，不改合成管线）：流完整性/时长/分辨率校验 + 黑屏(blackdetect)/长静音(silencedetect)/响度漂移(EBU R128 对 -14 LUFS)/画面冻结检测，返回结构化双语报告（status: ok|warn|fail + 逐项 checks）。批量出片后发布前把关用：fail 的片子别直接发。需先合成过视频。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        compositionId: { type: "string", description: "指定要质检的合成 ID（不填则用最新一次合成）" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_master",
    description:
      "分析成片真实拼接点前后的亮度/色度/饱和度差异，并测量整片 EBU R128 响度。默认 apply=false，只返回证据与建议：不改文件、不调用模型、不会产生模型费用。apply=true 时必须显式选择 normalizeAudio 或 deflicker，并创建新的非破坏母版版本，不覆盖原片；normalizeAudio 使用两遍响度标准化，deflicker 会重编码画面且可能抹平纹理，只应在确认画面存在时间闪烁时启用。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        compositionId: { type: "string", description: "指定要分析或精修的成功合成 ID；不填则使用最新一次成功合成" },
        apply: { type: "boolean", description: "默认 false，仅分析。true 时创建新的母版版本" },
        normalizeAudio: { type: "boolean", description: "两遍 EBU R128 响度标准化到 -14 LUFS；仅 apply=true 时执行" },
        deflicker: { type: "boolean", description: "时间去闪烁，会重编码画面；仅确认存在闪烁且 apply=true 时启用" },
        label: { type: "string", description: "新母版版本名称，最长 60 字符" },
        wait: { type: "boolean", description: "apply=true 时默认等待完成；false 立即返回 compositionId，之后用 clipforge_get_video 精确轮询" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_gate",
    description:
      "发布门禁（交付/发布前必跑的一键聚合检查）：脚本发布就绪（广告法风险词/开场钩子/时长/CTA/前3秒亮品）+ 成片质检（黑屏/静音/响度/流完整性）+ 素材授权（商用风险/署名要求）三层一次跑完，返回单一 status: pass|warn|fail 与逐项双语说明（report.items[].problems 列具体问题）。语义：fail=有必须修复的问题，先修复再交付；warn=需人工确认的风险（许可复核/署名），交付时必须把这些风险明示给用户；pass=自动检查无拦截项。strict=true 时 warn 也使返回的 ok 为 false。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        compositionId: { type: "string", description: "指定要检查的合成 ID（不填则用最新一次成功合成）" },
        strict: { type: "boolean", description: "严格模式：warn 也视为拦截（ok=false），投流前建议开" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_credits",
    description:
      "导出某项目的素材授权清单：逐镜溯源（来源/作者/许可）+ 商用风险分级（NC/ND/未知许可标记「需人工复核」）+ CC BY 素材的可直接粘贴署名行 + BGM 授权。投流/广告审核要授权凭证时用，或发布前自查素材商用安全。返回结构化 JSON（summary.commercialSafe 表示是否无风险项）。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_native_feel",
    description:
      "把某项目最新成片重渲成「原生实拍感」（后处理，不改合成管线）：手持微抖动（确定性正弦驱动，可用 seed 让 A/B 变体动线不同）+ 轻颗粒 + 轻微去精致化调色。应对 2026 平台对「过度精致 AI 感」内容的降权，让 AI 成片更像手机实拍。返回处理后的新 mp4 地址（不覆盖原片）。需先合成过视频。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        strength: { type: "string", enum: ["subtle", "medium"], description: "力度：subtle 轻微(默认) / medium 明显手持感" },
        seed: { type: "number", description: "抖动相位种子（不同变体传不同值避免动线一致）" },
        grain: { type: "boolean", description: "是否加颗粒，默认 true" },
        vignette: { type: "boolean", description: "是否加轻晕影，默认 false（观感明显，按需开）" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_preview_gif",
    description:
      "从某项目最新成片切一小段转成循环 GIF 预览（分享 / 嵌入 / 列表 hover 用）。返回 GIF 地址。需先合成过视频。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        startSec: { type: "number", description: "起始秒，默认 0" },
        durationSec: { type: "number", description: "时长秒（1-10），默认 4" },
        width: { type: "number", description: "宽度 px，默认 360" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_contact_sheet",
    description:
      "把某项目最新成片渲成一张速览图 PNG：默认 smart 模式按真实场景切换抽帧——拼接点缩略图带红框、波形时间轴上红线标出所有检测到的切点，一眼看出黑屏/字幕遮挡/拼接突兀/爆音/静音尾巴。返回速览图 PNG 地址、切点秒数组 cuts、抽帧时刻 frameTimes（proxy=true 时另含审片小样地址）。合成后建议调用并查看这张图再告知用户成片可用。proxy=true 额外生成短边≤720、烧录时间码的审片小样 mp4，便于人工按精确时刻反馈。需先合成过视频。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        frames: { type: "number", description: "胶片条帧数（4-12），默认 8" },
        thumbWidth: { type: "number", description: "单帧宽度 px（120-320），默认 180" },
        mode: { type: "string", enum: ["smart", "even"], description: "抽帧模式：smart=场景切点优先（默认）；even=均匀抽帧" },
        proxy: { type: "boolean", description: "true 时同时生成 720p 时间码审片小样" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_export_subtitle",
    description:
      "导出某项目脚本字幕为 SRT 或 WebVTT（二次剪辑 / 平台原生字幕 / 无障碍）。返回字幕文本内容（subtitle 字段，可直接存为 .srt/.vtt 文件）。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        format: { type: "string", enum: ["srt", "vtt"], description: "字幕格式，默认 srt" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "clipforge_find_clips",
    description: "从已转写素材按原话、句末和停顿查找短片段。纯本地只读，不调用模型、不生成视频。返回每段原话、sourceRange、plan 和 latestRevision；可把候选 plan 交给 clipforge_transcript_edit 预演，确认后生成新版本。按字面匹配原话并使用时间规则整理建议。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        mediaId: { type: "string", description: "已完成转写的原片 ID" },
        query: { type: "string", maxLength: 160, description: "可选：匹配原话的关键词或短语" },
        targetSeconds: { type: "number", minimum: 5, maximum: 120, description: "目标片段时长，默认 30 秒" },
        limit: { type: "integer", minimum: 1, maximum: 12, description: "最多返回数量，默认 6" },
      },
      required: ["projectId", "mediaId"],
    },
  },
  {
    name: "clipforge_transcript_inspect",
    description:
      "检查一条已导入原片的本地逐字稿和当前剪辑版本。分页返回稳定词 ID、时间戳、latestRevision/latestPlan 和最新执行状态；不修改任何数据。长逐字稿用 offset/limit 分页读取。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        mediaId: { type: "string", description: "导入原片 ID（网页文字剪辑工作台或媒体 API 返回）" },
        offset: { type: "number", description: "词偏移，默认 0" },
        limit: { type: "number", description: "本页词数，默认 500，最大 2000" },
      },
      required: ["projectId", "mediaId"],
    },
  },
  {
    name: "clipforge_transcript_edit",
    description:
      "预演或应用文字剪辑计划。默认 apply=false，只返回删除词数、区间、缩短时长和下一 revision，不写库也不渲染；只有用户明确确认后才传 apply=true。正式应用必须携带 inspect 返回的 baseRevision 和稳定 operationId，重复 operationId 幂等，不覆盖原片或旧版本。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        mediaId: { type: "string", description: "导入原片 ID" },
        baseRevision: { type: "number", description: "inspect 返回的 latestRevision；版本变化时服务端拒绝应用" },
        operationId: { type: "string", description: "8-128 字符稳定操作 ID；apply=true 必填，重试必须复用同一个值" },
        plan: TRANSCRIPT_PLAN_PROP,
        apply: { type: "boolean", description: "默认 false=只预演；用户看过 diff 并明确确认后才能设 true" },
      },
      required: ["projectId", "mediaId", "baseRevision", "plan"],
    },
  },
  {
    name: "clipforge_timeline_export",
    description:
      "把文字剪辑计划导出为专业时间线。OTIO 保留可编辑视频/音频切片，EDL 用于传统 NLE 交换，CSV 用于人工审阅；只返回文件内容和元数据，不写库、不渲染、不包含本机绝对路径。先用 clipforge_transcript_inspect 获取 latestPlan，修改后可先用 transcript_edit dry-run 审阅。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
        mediaId: { type: "string", description: "导入原片 ID" },
        format: { type: "string", enum: ["otio", "edl", "csv"], description: "默认 otio" },
        revision: { type: "number", description: "可选版本号，仅写入交付元数据和文件名" },
        plan: TRANSCRIPT_PLAN_PROP,
      },
      required: ["projectId", "mediaId", "plan"],
    },
  },
  {
    name: "clipforge_carousel",
    description:
      "把某项目脚本渲成小红书图文卡片（标题卡 + 逐条要点卡，渐变底，默认 3:4），返回各卡片图地址。视频之外的图文输出。不需要 LLM。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: PROJECT_ID_PROP,
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

  // 1.5) judge pass: four narrow judges (pacing/spoken-voice/freshness/structure) tear the lines
  // apart and weak ones are rewritten in place — the hands-off chain keeps the quality bar, the
  // agent never operates the panel. Best-effort: a failed pass never blocks the video.
  let judgeRewrites = 0;
  const scriptId = scriptRes?.scripts?.[0]?.id;
  if (scriptId) {
    try {
      const report = await api(`/api/project/${projectId}/script-judge`, {
        method: "POST",
        body: { scriptId, llmConfig: LLM },
      });
      // tier gate (judge v2): auto-apply invariant/default only — taste tier is opinion, not defect;
      // the visual judge's description rewrites ride the same shotTexts PATCH
      const gated = (rows) => (Array.isArray(rows) ? rows.filter((r) => r.tier !== "taste") : []);
      const shotTexts = new Map();
      for (const r of gated(report?.rewrites)) shotTexts.set(r.shotId, { shotId: r.shotId, voiceover: r.voiceover });
      for (const r of gated(report?.descriptionRewrites)) {
        shotTexts.set(r.shotId, { ...(shotTexts.get(r.shotId) ?? { shotId: r.shotId }), description: r.description });
      }
      if (shotTexts.size > 0) {
        await api(`/api/project/${projectId}/scripts`, {
          method: "PATCH",
          body: { scriptId, shotTexts: Array.from(shotTexts.values()) },
        });
        judgeRewrites = shotTexts.size;
      }
    } catch {
      /* quality pass is best-effort */
    }
  }

  // 2) match visuals: free Openverse images by default; with Pexels/Pixabay keys, fetches video B-roll per footage setting
  const mediaType = resolveMediaType(args.footage);
  const fill = await api(`/api/project/${projectId}/stock-fill`, {
    method: "POST",
    body: { source: "all", mediaType, apiKeys: STOCK_KEYS, ...(LLM.baseUrl && LLM.model ? { llmConfig: LLM } : {}) },
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
  // wait:false — non-blocking submit (see handleCompose): script/judge/footage results are
  // already known, only the render is left running in the background
  if (args.wait === false) {
    return ok({
      ok: true,
      projectId,
      compositionId,
      status: "composing",
      topic,
      narrationStyle,
      voice: usedVoice,
      shots: shots.length,
      ...(judgeRewrites ? { judgeRewrites } : {}),
      footageFilled: `${fill.filled}/${fill.total}`,
      next: `合成已在后台进行。用 clipforge_get_video { projectId: "${projectId}", compositionId: "${compositionId}" } 轮询取片。`,
    });
  }
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
    // judge panel: how many weak lines were auto-rewritten before composing
    ...(judgeRewrites ? { judgeRewrites } : {}),
    footageFilled: `${fill.filled}/${fill.total}`,
    // material continuity: how many shots reused a provider+author already picked by a same-entity shot
    ...(fill.sameSourceHits ? { sameSourceShots: fill.sameSourceHits } : {}),
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
      body: { source: "all", mediaType: resolveMediaType(args.footage), apiKeys: STOCK_KEYS, ...(LLM.baseUrl && LLM.model ? { llmConfig: LLM } : {}) },
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
  // wait:false — non-blocking submit: hand back the compositionId instead of holding the MCP
  // call open for up to 11 minutes (strict-timeout clients would kill the call and orphan the run)
  if (args.wait === false) {
    return ok({
      ok: true,
      projectId,
      compositionId,
      status: "composing",
      next: `合成已在后台进行。用 clipforge_get_video { projectId: "${projectId}", compositionId: "${compositionId}" } 轮询取片。`,
    });
  }
  const composition = await pollCompose(projectId, { compositionId });
  return ok({ ok: true, projectId, voice: body.freeTts.voice || "zh-CN-XiaoxiaoNeural", videoUrl: absVideoUrl(composition), status: composition.status });
}

/**
 * Targeted per-shot copy edits (voiceover / description / camera) through the scripts PATCH —
 * the surgical-fix loop for gate/qc feedback without regenerating the whole script.
 */
async function handleUpdateShots(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const patches = (Array.isArray(args.shots) ? args.shots : [])
    .filter((sh) => sh && Number.isFinite(sh.shotId))
    .map((sh) => ({
      shotId: Number(sh.shotId),
      ...(typeof sh.voiceover === "string" && sh.voiceover.trim() ? { voiceover: sh.voiceover.trim() } : {}),
      ...(typeof sh.description === "string" && sh.description.trim() ? { description: sh.description.trim() } : {}),
      ...(typeof sh.camera === "string" && sh.camera.trim() ? { camera: sh.camera.trim() } : {}),
    }))
    .filter((sh) => Object.keys(sh).length > 1);
  if (patches.length === 0) throw new Error("shots 里没有可应用的修改（每项至少带 voiceover/description/camera 之一）");
  let scriptId = typeof args.scriptId === "string" && args.scriptId.trim() ? args.scriptId.trim() : "";
  if (!scriptId) {
    const scripts = await api(`/api/project/${projectId}/scripts`);
    const selected = (Array.isArray(scripts) ? scripts : []).find((x) => x.selected) ?? (Array.isArray(scripts) ? scripts[0] : null);
    if (!selected?.id) throw new Error("该项目没有脚本可改——先生成或导入脚本");
    scriptId = selected.id;
  }
  await api(`/api/project/${projectId}/scripts`, { method: "PATCH", body: { scriptId, shotTexts: patches } });
  return ok({
    ok: true,
    projectId,
    scriptId,
    updatedShots: patches.map((sh) => sh.shotId),
    next: `已改 ${patches.length} 个分镜。重新 clipforge_compose { projectId: "${projectId}" } 出片使修改生效。`,
  });
}

async function handleListVoices() {
  const res = await api("/api/tts/free");
  return ok({ ok: true, default: res.default, voices: res.voices ?? [] });
}

async function handleGetVideo(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  // compositionId pins the query to one specific run — concurrent composes (retries, A/B
  // variants) would otherwise cross results under "latest"
  const compositionId = typeof args.compositionId === "string" && args.compositionId.trim() ? args.compositionId.trim() : "";
  const query = compositionId ? `?compositionId=${encodeURIComponent(compositionId)}` : "";
  const { composition } = await api(`/api/project/${projectId}/compose${query}`);
  if (!composition) {
    return ok({ ok: true, projectId, status: "none", videoUrl: null, hint: "该项目还没有合成记录，用 clipforge_compose 出片。" });
  }
  return ok({
    ok: true,
    projectId,
    status: composition.status,
    videoUrl: absVideoUrl(composition),
    timelineUrl: composition.timelineUrl ? `${BASE_URL}${composition.timelineUrl}` : null,
  });
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
      ? "已建带货项目并抓取商品图。下一步：用 clipforge_product_script 直接从链接生成带货脚本（需 LLM），或 clipforge_compose 出片。"
      : "仅解析、未建项目（createProject=false）。",
  });
}

// One-shot commerce script: ingest a product URL → generate a commerce script server-side (needs LLM).
// Chains the two existing routes (/api/ingest/product then /api/llm/script) so agents skip the manual
// hand-off. The script route already folds in the performance-feedback flywheel by category.
async function handleProductScript(args) {
  requireLlm();
  const url = String(args.url || "").trim();
  if (!/^https?:\/\/.+/i.test(url)) throw new Error("url 必须是合法的 http/https 商品链接");

  // Step 1: ingest the product (creates the project + downloads images; no LLM needed)
  const ingest = await api("/api/ingest/product", { method: "POST", body: { url, createProject: true } });
  const projectId = ingest.projectId;
  if (!projectId) throw new Error("未能从该链接建项目（可能被反爬或缺少标准商品标签），请换一个链接或改用网页端上传商品图。");
  const productName = ingest.product?.title?.trim();
  if (!productName) throw new Error("未能解析出商品标题，无法生成带货脚本。请换一个带标准 OG/JSON-LD 标签的链接。");

  // Step 2: generate the commerce script from the ingested product data (LLM)
  const styleType = ["pain_point", "scene", "comparison", "story", "drama", "reversal", "interview", "unboxing", "product_pov", "talking_head", "auto"].includes(args.styleType) ? args.styleType : "auto";
  const targetDuration = Number.isFinite(args.durationSec) ? Number(args.durationSec) : 30;
  const scriptRes = await api("/api/llm/script", {
    method: "POST",
    body: {
      projectId,
      productName,
      productDescription: ingest.product?.description ?? "",
      productImages: ingest.productImages ?? [],
      ...(args.category ? { category: args.category } : {}),
      styleType,
      targetDuration,
      llmConfig: LLM,
    },
  });

  const scripts = Array.isArray(scriptRes?.scripts) ? scriptRes.scripts : [];
  return ok({
    ok: true,
    projectId,
    product: ingest.product ?? null,
    productImages: ingest.productImages ?? [],
    scripts: scripts.map((s) => ({
      id: s.id,
      title: s.title ?? "",
      styleType: s.styleType,
      totalDuration: s.totalDuration ?? 0,
      selected: s.selected ?? false,
      shots: (s.shots ?? []).map((sh) => ({
        shotId: sh.shotId,
        duration: sh.duration,
        voiceover: sh.voiceover,
        stockKeywords: sh.stockKeywords ?? [],
      })),
    })),
    next: `已生成 ${scripts.length} 套带货脚本（默认选中第一套）。下一步用 clipforge_compose { projectId: "${projectId}" } 配画面+配音+合成出片。`,
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
  return ok({
    ok: true,
    projectId,
    qr: res.qr ? `${BASE_URL}${res.qr}` : null,
    shopLink: res.shopLink ?? null,
    ...(res.warning ? { warning: res.warning } : {}),
  });
}

// Burn a "scan to buy" QR onto the last few seconds of the composed video
async function handleEndCard(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const body = {};
  if (typeof args.url === "string" && args.url.trim()) body.url = args.url.trim();
  if (typeof args.platform === "string" && args.platform.trim()) body.platform = args.platform.trim();
  if (args.force === true) body.force = true; // override the douyin off-site-diversion refusal
  if (Number.isFinite(args.seconds)) body.seconds = args.seconds;
  if (typeof args.ctaText === "string" && args.ctaText.trim()) body.ctaText = args.ctaText.trim();
  const res = await api(`/api/project/${projectId}/end-card`, { method: "POST", body });
  return ok({
    ok: true,
    projectId,
    video: res.video ? `${BASE_URL}${res.video}` : null,
    shopLink: res.shopLink ?? null,
    ...(res.warning ? { warning: res.warning } : {}),
  });
}

// Automated quality check over the latest composed video (streams / black / silence / loudness / freeze)
async function handleQc(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const body = {};
  if (typeof args.compositionId === "string" && args.compositionId.trim()) body.compositionId = args.compositionId.trim();
  const res = await api(`/api/project/${projectId}/qc`, { method: "POST", body });
  return ok({ ok: res.status !== "fail", projectId, compositionId: res.compositionId ?? null, status: res.status, checks: res.checks ?? [] });
}

// Read-only continuity/loudness analysis by default; explicit apply options create
// a new composition version and never overwrite the selected source composition.
async function handleMaster(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const apply = args.apply === true;
  const normalizeAudio = args.normalizeAudio === true;
  const deflicker = args.deflicker === true;
  if (!apply && (normalizeAudio || deflicker)) {
    throw new Error("normalizeAudio / deflicker 需要同时设置 apply=true；apply=false 时仅分析");
  }
  if (apply && !normalizeAudio && !deflicker) {
    throw new Error("apply=true 时必须至少选择 normalizeAudio 或 deflicker");
  }
  const body = { action: apply ? "render" : "analyze" };
  if (typeof args.compositionId === "string" && args.compositionId.trim()) body.compositionId = args.compositionId.trim();
  if (apply) {
    body.normalizeAudio = normalizeAudio;
    body.deflicker = deflicker;
    if (typeof args.label === "string" && args.label.trim()) body.label = args.label.trim();
  }
  const res = await api(`/api/project/${projectId}/mastering`, { method: "POST", body });
  if (!apply) {
    return ok({ ok: true, projectId, compositionId: res.compositionId ?? null, analysis: res.analysis ?? null });
  }
  if (args.wait === false) {
    return ok({
      ok: true,
      projectId,
      compositionId: res.compositionId,
      status: res.status,
      analysis: res.analysis ?? null,
      options: res.options ?? null,
      next: `母版正在后台生成。用 clipforge_get_video { projectId: "${projectId}", compositionId: "${res.compositionId}" } 轮询取片。`,
    });
  }
  const composition = await pollCompose(projectId, { compositionId: res.compositionId });
  return ok({
    ok: true,
    projectId,
    compositionId: composition.id,
    status: composition.status,
    videoUrl: absVideoUrl(composition),
    analysis: res.analysis ?? null,
    options: res.options ?? null,
  });
}

// Platform export with anti-recompression bitrate cap + measured-vs-line report
async function handleExportPlatform(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const platform = String(args.platform || "").trim();
  if (!platform) throw new Error("platform 不能为空");
  const body = { platform };
  if (args.compositionId !== undefined) {
    if (typeof args.compositionId !== "string" || !/^[a-zA-Z0-9-]+$/.test(args.compositionId.trim())) throw new Error("无效的成片版本 ID");
    body.compositionId = args.compositionId.trim();
  }
  for (const key of ["framing", "preview", "previewTime"]) if (args[key] !== undefined) body[key] = args[key];
  const res = await api(`/api/project/${projectId}/export-platform`, { method: "POST", body });
  if (args.preview === true) return { content: [
    { type: "text", text: JSON.stringify({ compositionId: res.compositionId, platform, framing: res.framing, previewTime: res.previewTime, size: res.size }) },
    { type: "image", data: res.preview.split(",")[1], mimeType: "image/jpeg" },
  ] };
  return ok({ ok: true, projectId, compositionId: res.compositionId ?? null, platform, platformName: res.platformName, framing: res.framing, url: res.url, size: res.size, report: res.report ?? null });
}

// Release gate: aggregated pre-publish verdict (script readiness + video QC + asset licenses)
async function handleGate(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const body = {};
  if (typeof args.compositionId === "string" && args.compositionId.trim()) body.compositionId = args.compositionId.trim();
  const res = await api(`/api/project/${projectId}/gate`, { method: "POST", body });
  const status = res.report?.status ?? "fail";
  const blocked = status === "fail" || (args.strict === true && status !== "pass");
  return ok({ ok: !blocked, projectId, compositionId: res.compositionId ?? null, status, report: res.report ?? null });
}

// Asset license manifest (per-shot provenance + commercial-risk flags + attribution lines)
async function handleCredits(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const m = await api(`/api/project/${projectId}/credits`);
  return ok({ ok: true, projectId, summary: m.summary, items: m.items ?? [], bgm: m.bgm ?? null });
}

// Hand-shot look post-process over the latest composed video
async function handleNativeFeel(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const body = {};
  if (args.strength === "medium" || args.strength === "subtle") body.strength = args.strength;
  if (Number.isFinite(args.seed)) body.seed = args.seed;
  if (typeof args.grain === "boolean") body.grain = args.grain;
  if (args.vignette === true) body.vignette = true;
  const res = await api(`/api/project/${projectId}/native-feel`, { method: "POST", body });
  return ok({ ok: true, projectId, video: res.video ? `${BASE_URL}${res.video}` : null, strength: res.strength ?? null });
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

// Contact sheet: one-image overview (filmstrip + waveform) of the latest composed video — the
// agent-side eyeball check: fetch the PNG and *look* at it before telling the user the video is good
async function handleContactSheet(args) {
  const projectId = String(args.projectId || "").trim();
  if (!projectId) throw new Error("projectId 不能为空");
  const body = {};
  if (Number.isFinite(args.frames)) body.frames = args.frames;
  if (Number.isFinite(args.thumbWidth)) body.thumbWidth = args.thumbWidth;
  if (args.mode === "even" || args.mode === "smart") body.mode = args.mode;
  if (args.proxy === true) body.proxy = true;
  const res = await api(`/api/project/${projectId}/contact-sheet`, { method: "POST", body });
  return ok({
    ok: true,
    projectId,
    sheet: res.sheet ? `${BASE_URL}${res.sheet}` : null,
    layout: res.layout ?? null,
    mode: res.mode ?? null,
    cuts: res.cuts ?? [],
    frameTimes: res.frameTimes ?? [],
    proxy: res.proxy ? `${BASE_URL}${res.proxy}` : null,
  });
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

async function handleFindClips(args) {
  const projectId = String(args.projectId || "").trim();
  const mediaId = String(args.mediaId || "").trim();
  if (!projectId || !mediaId) throw new Error("projectId 和 mediaId 不能为空");
  const params = new URLSearchParams({ query: String(args.query ?? ""), targetSeconds: String(args.targetSeconds ?? 30), limit: String(args.limit ?? 6) });
  return ok(await api(`/api/project/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/clips?${params}`));
}

async function handleTranscriptInspect(args) {
  const projectId = String(args.projectId || "").trim();
  const mediaId = String(args.mediaId || "").trim();
  if (!projectId || !mediaId) throw new Error("projectId 和 mediaId 不能为空");
  const offset = Number.isInteger(args.offset) ? Math.max(0, Number(args.offset)) : 0;
  const limit = Number.isInteger(args.limit) ? Math.min(2000, Math.max(1, Number(args.limit))) : 500;
  const result = await api(`/api/project/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/edit?offset=${offset}&limit=${limit}`);
  return ok({
    ok: true,
    ...result,
    next: result.transcript?.hasMore
      ? `继续读取 offset=${result.transcript.wordOffset + result.transcript.words.length}；修改完整 plan 后先调用 clipforge_transcript_edit（apply=false）预演。`
      : "修改完整 plan 后先调用 clipforge_transcript_edit（apply=false）预演；向用户展示 diff，确认后才 apply=true。",
  });
}

async function handleTranscriptEdit(args) {
  const projectId = String(args.projectId || "").trim();
  const mediaId = String(args.mediaId || "").trim();
  if (!projectId || !mediaId) throw new Error("projectId 和 mediaId 不能为空");
  if (!Number.isInteger(args.baseRevision) || Number(args.baseRevision) < 0) throw new Error("baseRevision 必须来自 clipforge_transcript_inspect");
  if (!args.plan || typeof args.plan !== "object") throw new Error("plan 不能为空");
  const apply = args.apply === true;
  const operationId = typeof args.operationId === "string" ? args.operationId.trim() : "";
  if (apply && !operationId) throw new Error("apply=true 必须提供稳定 operationId；重试时复用同一个值");
  const result = await api(`/api/project/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/edit`, {
    method: "POST",
    body: {
      action: apply ? "apply" : "preview",
      operationId: operationId || undefined,
      actor: "mcp",
      baseRevision: Number(args.baseRevision),
      plan: args.plan,
    },
  });
  return ok({
    ok: true,
    projectId,
    mediaId,
    ...result,
    next: apply
      ? "剪辑版本已提交；用 clipforge_transcript_inspect 查看 latestEdit.status，完成后再做 QC。"
      : "这是 dry-run，尚未写库或渲染。把 proposal.diff/summary 展示给用户；明确确认后用同一 plan、baseRevision 与 proposal.operationId 调用 apply=true。",
  });
}

async function handleTimelineExport(args) {
  const projectId = String(args.projectId || "").trim();
  const mediaId = String(args.mediaId || "").trim();
  if (!projectId || !mediaId) throw new Error("projectId 和 mediaId 不能为空");
  if (!args.plan || typeof args.plan !== "object") throw new Error("plan 不能为空");
  const format = ["otio", "edl", "csv"].includes(args.format) ? args.format : "otio";
  const result = await api(`/api/project/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/timeline`, {
    method: "POST",
    body: {
      format,
      plan: args.plan,
      inline: true,
      ...(Number.isInteger(args.revision) && args.revision > 0 ? { revision: args.revision } : {}),
    },
  });
  return ok({
    ok: true,
    projectId,
    mediaId,
    format,
    fileName: result.fileName,
    mimeType: result.mimeType,
    clips: result.clips,
    duration: result.duration,
    frameRate: result.frameRate,
    content: result.content,
    next: `把 content 原样保存为 ${result.fileName}；导入剪辑软件后按原文件名重链素材。`,
  });
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
  clipforge_product_script: handleProductScript,
  clipforge_generate_script: handleGenerateScript,
  clipforge_search_stock: handleSearchStock,
  clipforge_list_projects: handleListProjects,
  clipforge_compose: handleCompose,
  clipforge_update_shots: handleUpdateShots,
  clipforge_list_voices: handleListVoices,
  clipforge_get_video: handleGetVideo,
  clipforge_trends: handleTrends,
  clipforge_import_script: handleImportScript,
  clipforge_dub: handleDub,
  clipforge_cover: handleCover,
  clipforge_shop_qr: handleShopQr,
  clipforge_end_card: handleEndCard,
  clipforge_export_platform: handleExportPlatform,
  clipforge_qc: handleQc,
  clipforge_master: handleMaster,
  clipforge_gate: handleGate,
  clipforge_credits: handleCredits,
  clipforge_native_feel: handleNativeFeel,
  clipforge_preview_gif: handlePreviewGif,
  clipforge_contact_sheet: handleContactSheet,
  clipforge_export_subtitle: handleExportSubtitle,
  clipforge_transcript_inspect: handleTranscriptInspect,
  clipforge_find_clips: handleFindClips,
  clipforge_transcript_edit: handleTranscriptEdit,
  clipforge_timeline_export: handleTimelineExport,
  clipforge_carousel: handleCarousel,
};

// ---- Start MCP server ----
const server = new Server(
  { name: "clipforge", version: "0.1.7" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const handler = HANDLERS[req.params.name];
  if (!handler) {
    // Name the valid tools so the calling model can self-correct instead of retrying blind
    return {
      content: [{ type: "text", text: `未知工具：${req.params.name}。可用工具：${Object.keys(HANDLERS).join("、")}` }],
      isError: true,
    };
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
