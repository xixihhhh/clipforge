#!/usr/bin/env node
/**
 * ClipForge MCP Server —— 把 ClipForge 的「一句话成片」流水线暴露为 MCP 工具，
 * 让 Claude Desktop / Claude Code / Cursor 等任意 MCP 客户端都能直接驱动出片。
 *
 * 设计：本服务是 ClipForge HTTP API 的薄封装（复用其全部编排：DB / FFmpeg / 免费 TTS / 免费素材），
 * 通过 stdio 与客户端通信。只有「生成脚本」需要一个 LLM Key（其余 Openverse 素材 + Edge TTS 全程免 Key）。
 *
 * 环境变量：
 *   CLIPFORGE_BASE_URL     ClipForge 实例地址（默认 http://localhost:3000，需先 `pnpm dev` / `pnpm start`）
 *   CLIPFORGE_LLM_BASE_URL LLM 接口（OpenAI 兼容，如 https://api.atlascloud.ai/v1）
 *   CLIPFORGE_LLM_API_KEY  LLM Key（生成脚本必需；不配则 create_video / generate_script 会给出明确提示）
 *   CLIPFORGE_LLM_MODEL    LLM 模型名（如 deepseek-ai/deepseek-v3.2）
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

// 免费素材源 Key（可选）：配了就再补充 Pexels/Pixabay 高质量视频；不配也有 keyless Wikimedia 视频 + Openverse 图片
const STOCK_KEYS = {};
if (process.env.CLIPFORGE_PIXABAY_KEY) STOCK_KEYS.pixabay = process.env.CLIPFORGE_PIXABAY_KEY;
if (process.env.CLIPFORGE_PEXELS_KEY) STOCK_KEYS.pexels = process.env.CLIPFORGE_PEXELS_KEY;

const NARRATION_STYLES = ["knowledge", "story", "lifestyle", "inspiration", "travel"];
const FOOTAGE_KINDS = ["auto", "image", "video"];
const ASPECT_RATIOS = ["9:16", "16:9", "1:1"]; // 9:16 竖屏(抖音/快手/Reels/Shorts) · 16:9 横屏 · 1:1 方形
const QUALITY_PRESETS = ["fast", "standard", "hd"]; // 映射真实 FFmpeg 编码：分辨率 + x264 preset + crf

/** footage 解析：默认 "auto"——交给 stock-fill 逐镜「视频优先、缺则图片」（全程免 Key）；image/video 为显式指定 */
function resolveMediaType(footage) {
  return FOOTAGE_KINDS.includes(footage) ? footage : "auto";
}

/** 由工具入参拼出 compose 请求体：免费 TTS（可选音色）+ 画幅 + 画质预设 */
function composeBody(args) {
  const body = { freeTts: { enabled: true } };
  if (typeof args.voice === "string" && args.voice) body.freeTts.voice = args.voice;
  if (ASPECT_RATIOS.includes(args.aspectRatio)) body.aspectRatio = args.aspectRatio;
  if (QUALITY_PRESETS.includes(args.quality)) body.renderPreset = args.quality;
  if (args.bgm === true) body.freeBgm = true; // 自动加一段免费 CC 背景音乐
  if (args.karaoke === true) body.karaoke = true; // 卡拉OK逐字字幕
  if (args.productCard === true) body.productCard = true; // 商品卡贴片（有商品图才生效）
  return body;
}

/** create_video / compose 共用的「成片选项」JSON-Schema 属性 */
const OUTPUT_OPTION_PROPS = {
  voice: { type: "string", description: "Edge TTS 音色 value（见 clipforge_list_voices），默认 zh-CN-XiaoxiaoNeural" },
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
};

/** 调用 ClipForge HTTP API；非 2xx 抛出携带后端 error 文案的异常 */
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
    // 读 body 也要在超时保护内：fetch 只在收到响应头时 resolve，body 卡住时不清掉 timer 才能中止
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

/** 生成脚本前确保 LLM 配置就绪，否则给出可操作的提示 */
function requireLlm() {
  if (!LLM.baseUrl || !LLM.apiKey || !LLM.model) {
    throw new Error(
      "生成脚本需要 LLM。请为 MCP 服务设置环境变量：CLIPFORGE_LLM_BASE_URL、CLIPFORGE_LLM_API_KEY、CLIPFORGE_LLM_MODEL（OpenAI 兼容接口，如 Atlas Cloud / DeepSeek / OpenRouter）。",
    );
  }
}

/** 轮询合成结果直到 done/failed（compose 是异步的，立即返回 compositionId 后台跑） */
async function pollCompose(projectId, { timeoutMs = 300000, intervalMs = 2500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // 注意：用传入的时间预算循环；这里不依赖 Date.now 的随机性，仅作超时控制
  for (;;) {
    const { composition } = await api(`/api/project/${projectId}/compose`);
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

// ---- 工具定义（JSON Schema，无需 zod）----
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
    description: "列出可用的免费 Edge TTS 中文音色（value/label/性别）及默认音色，供 create_video / compose 的 voice 参数选用。不需要 LLM。",
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
];

// ---- 工具处理 ----
async function handleCreateVideo(args) {
  requireLlm();
  const topic = String(args.topic || "").trim();
  if (topic.length < 2) throw new Error("topic 太短，请给一个完整的一句话主题");
  const narrationStyle = NARRATION_STYLES.includes(args.narrationStyle) ? args.narrationStyle : "knowledge";
  const targetDuration = Number.isFinite(args.durationSec) ? Number(args.durationSec) : 25;

  // 1) 写脚本
  const scriptRes = await api("/api/topic/script", {
    method: "POST",
    body: { topic, narrationStyle, targetDuration, llmConfig: LLM },
  });
  const projectId = scriptRes.projectId;
  const shots = scriptRes?.scripts?.[0]?.shots ?? [];

  // 2) 配画面：默认免费 Openverse 图片；配了 Pexels/Pixabay Key 则按 footage 取视频 B-roll
  const mediaType = resolveMediaType(args.footage);
  const fill = await api(`/api/project/${projectId}/stock-fill`, {
    method: "POST",
    body: { source: "all", mediaType, apiKeys: STOCK_KEYS },
  });
  // 一个画面都没配到就别硬合成（会产出空白/失败片）——给可操作的提示
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

  // 3) 合成（免费 Edge TTS 配音 + 字幕；可选音色/画幅/画质）
  await api(`/api/project/${projectId}/compose`, { method: "POST", body: composeBody(args) });
  const composition = await pollCompose(projectId);

  return ok({
    ok: true,
    projectId,
    topic,
    narrationStyle,
    footage: mediaType,
    voice: composeBody(args).freeTts.voice || "zh-CN-XiaoxiaoNeural",
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
    }).catch(() => {}); // 配画面失败不阻断合成（可能已有素材）
  }
  await api(`/api/project/${projectId}/compose`, { method: "POST", body: composeBody(args) });
  const composition = await pollCompose(projectId);
  return ok({ ok: true, projectId, videoUrl: absVideoUrl(composition), status: composition.status });
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
  const createProject = args.createProject !== false; // 默认建项目并下图
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

const HANDLERS = {
  clipforge_create_video: handleCreateVideo,
  clipforge_ingest_product: handleIngestProduct,
  clipforge_generate_script: handleGenerateScript,
  clipforge_search_stock: handleSearchStock,
  clipforge_list_projects: handleListProjects,
  clipforge_compose: handleCompose,
  clipforge_list_voices: handleListVoices,
  clipforge_get_video: handleGetVideo,
};

// ---- 启动 MCP server ----
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
// 启动日志走 stderr（stdout 被 MCP 协议占用）
console.error(`ClipForge MCP server 已启动 · 目标实例 ${BASE_URL}`);
