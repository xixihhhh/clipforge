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

const NARRATION_STYLES = ["knowledge", "story", "lifestyle", "inspiration", "travel"];

/** 调用 ClipForge HTTP API；非 2xx 抛出携带后端 error 文案的异常 */
async function api(path, { method = "GET", body, timeoutMs = 600000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === "AbortError") throw new Error(`请求超时：${path}`);
    throw new Error(`连不上 ClipForge（${BASE_URL}）。请先启动实例：pnpm dev 或 pnpm start。原始错误：${e?.message || e}`);
  }
  clearTimeout(timer);
  const text = await res.text();
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
      },
      required: ["topic"],
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
      },
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

  // 2) 配画面（免费素材，keyless Openverse 图片）
  const fill = await api(`/api/project/${projectId}/stock-fill`, {
    method: "POST",
    body: { source: "all", mediaType: "image" },
  });

  // 3) 合成（免费 Edge TTS 配音 + 字幕）
  await api(`/api/project/${projectId}/compose`, {
    method: "POST",
    body: { freeTts: { enabled: true } },
  });
  const composition = await pollCompose(projectId);

  return ok({
    ok: true,
    projectId,
    topic,
    narrationStyle,
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
    body: { query, source: "all", mediaType, perPage, download: false },
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
      body: { source: "all", mediaType: "image" },
    }).catch(() => {}); // 配画面失败不阻断合成（可能已有素材）
  }
  await api(`/api/project/${projectId}/compose`, {
    method: "POST",
    body: { freeTts: { enabled: true } },
  });
  const composition = await pollCompose(projectId);
  return ok({ ok: true, projectId, videoUrl: absVideoUrl(composition), status: composition.status });
}

const HANDLERS = {
  clipforge_create_video: handleCreateVideo,
  clipforge_generate_script: handleGenerateScript,
  clipforge_search_stock: handleSearchStock,
  clipforge_list_projects: handleListProjects,
  clipforge_compose: handleCompose,
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
