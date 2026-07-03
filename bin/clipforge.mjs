#!/usr/bin/env node
/**
 * ClipForge CLI — generate a video from a topic in one command: auto-write script, match footage, add voiceover, and compose.
 *
 * Thin wrapper around the ClipForge HTTP API (same orchestration as mcp/clipforge-mcp.mjs: DB / FFmpeg / free TTS / free stock),
 * zero third-party deps, pure Node. Requires a running instance (pnpm dev / pnpm start). Stock + voiceover need no API key; only script generation needs an LLM key.
 *
 * Usage:
 *   node bin/clipforge.mjs create --topic "在家手冲咖啡" [--duration 25] [--style knowledge]
 *        [--footage auto|image|video] [--voice <id>] [--aspect 9:16|16:9|1:1]
 *        [--quality fast|standard|hd] [--bgm] [--bgm-mood upbeat] [--karaoke] [--cta "👇 点击下方下单"] [--json]
 *   node bin/clipforge.mjs compose --project <id> [same compose options]   compose an existing project with script + assets
 *   node bin/clipforge.mjs list                     list projects
 *   node bin/clipforge.mjs voices                   list free voices
 *   node bin/clipforge.mjs get --project <id>       fetch the latest composed video URL
 *   node bin/clipforge.mjs --help | --version
 *
 * Environment variables (same as MCP):
 *   CLIPFORGE_BASE_URL (default http://localhost:3000)
 *   CLIPFORGE_LLM_BASE_URL / CLIPFORGE_LLM_API_KEY / CLIPFORGE_LLM_MODEL (required for create, OpenAI-compatible)
 *   CLIPFORGE_PEXELS_KEY / CLIPFORGE_PIXABAY_KEY (optional, for supplemental paid high-quality video sources)
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const BASE_URL = (process.env.CLIPFORGE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const LLM = {
  baseUrl: process.env.CLIPFORGE_LLM_BASE_URL || "",
  apiKey: process.env.CLIPFORGE_LLM_API_KEY || "",
  model: process.env.CLIPFORGE_LLM_MODEL || "",
};
const STOCK_KEYS = {};
if (process.env.CLIPFORGE_PIXABAY_KEY) STOCK_KEYS.pixabay = process.env.CLIPFORGE_PIXABAY_KEY;
if (process.env.CLIPFORGE_PEXELS_KEY) STOCK_KEYS.pexels = process.env.CLIPFORGE_PEXELS_KEY;

const NARRATION_STYLES = ["knowledge", "story", "lifestyle", "inspiration", "travel"];
const FOOTAGE_KINDS = ["auto", "image", "video"];
const ASPECT_RATIOS = ["9:16", "16:9", "1:1"];
const QUALITY_PRESETS = ["fast", "standard", "hd"];
const BGM_MOODS = ["upbeat", "chill", "energetic", "emotional"];

/** Read own package version (parent of bin/ is the repo root) */
function readVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Minimal argv parser (zero deps): first non-flag token becomes the subcommand; --key value reads a value, --flag sets true.
 * Exported for unit testing (see __tests__).
 */
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const eqBody = tok.slice(2);
      const eq = eqBody.indexOf("=");
      if (eq !== -1) {
        out.flags[eqBody.slice(0, eq)] = eqBody.slice(eq + 1); // --key=value syntax
        continue;
      }
      const key = eqBody;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.flags[key] = true; // boolean flag
      } else {
        out.flags[key] = next;
        i++;
      }
    } else {
      out._.push(tok);
    }
  }
  return out;
}

/** Build a compose request body from flags (equivalent to MCP composeBody, CLI-style input) */
export function composeBodyFromFlags(flags) {
  const body = { freeTts: { enabled: true } };
  if (typeof flags.voice === "string") body.freeTts.voice = flags.voice;
  if (ASPECT_RATIOS.includes(flags.aspect)) body.aspectRatio = flags.aspect;
  if (QUALITY_PRESETS.includes(flags.quality)) body.renderPreset = flags.quality;
  if (flags.bgm === true) body.freeBgm = true;
  if (BGM_MOODS.includes(flags["bgm-mood"])) body.bgmMood = flags["bgm-mood"];
  if (flags["bgm-duck"] === true) body.bgmDuck = true;
  if (flags.karaoke === true) body.karaoke = true;
  if (flags["product-card"] === true) body.productCard = true;
  if (flags["ai-disclosure"] === true) body.aiDisclosure = true;
  if (typeof flags.cta === "string" && flags.cta.trim()) body.ctaText = flags.cta.trim();
  return body;
}

/** Pick a default free voice based on topic language (same logic as MCP defaultVoiceForTopic); null = use server-side Chinese default */
export function defaultVoiceForTopic(topic) {
  const t = String(topic || "");
  if (/[぀-ヿ]/.test(t)) return "ja-JP-NanamiNeural";
  if (/[가-힯]/.test(t)) return "ko-KR-SunHiNeural";
  if (/[一-鿿]/.test(t)) return null;
  return "en-US-AriaNeural";
}

/** Call the ClipForge HTTP API; throws with the backend error message on non-2xx responses */
async function api(path, { method = "GET", body, timeoutMs = 600000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res, text;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
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
  if (!res.ok) throw new Error(data?.error || data?.raw || `HTTP ${res.status}`);
  return data;
}

/**
 * Poll the compose result until done/failed.
 * Pass the compositionId returned by POST to poll that exact run — polling "latest" is racy when
 * concurrent composes (retries, A/B variants) exist. No-id fallback kept for older servers whose
 * GET does not support ?compositionId=. Client deadline (660s) intentionally exceeds the server-side
 * render timeout (600s, composer COMPOSE_TIMEOUT_MS) so slow-but-successful renders aren't misreported.
 */
async function pollCompose(projectId, { compositionId, timeoutMs = 660000, intervalMs = 2500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const query = compositionId ? `?compositionId=${encodeURIComponent(compositionId)}` : "";
  for (;;) {
    const { composition } = await api(`/api/project/${projectId}/compose${query}`);
    const status = composition?.status;
    if (status === "done") return composition;
    if (status === "failed") throw new Error("合成失败（FFmpeg/TTS 出错），请检查素材与脚本");
    if (Date.now() > deadline) throw new Error("合成超时，可稍后用 `get --project` 再查");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const absVideoUrl = (c) => (c?.url ? `${BASE_URL}${c.url}` : null);
/** Progress goes to stderr (stdout is reserved for the final result, so scripts can pipe the videoUrl) */
const step = (m) => process.stderr.write(`· ${m}\n`);

function requireLlm() {
  if (!LLM.baseUrl || !LLM.apiKey || !LLM.model) {
    throw new Error(
      "create 需要 LLM。请设置环境变量 CLIPFORGE_LLM_BASE_URL、CLIPFORGE_LLM_API_KEY、CLIPFORGE_LLM_MODEL（OpenAI 兼容，如 Atlas Cloud / DeepSeek / OpenRouter）。",
    );
  }
}

async function cmdCreate(flags) {
  requireLlm();
  const topic = String(flags.topic || "").trim();
  if (topic.length < 2) throw new Error("--topic 太短，请给一句完整主题，如 --topic \"在家手冲咖啡\"");
  const narrationStyle = NARRATION_STYLES.includes(flags.style) ? flags.style : "knowledge";
  const targetDuration = Number.isFinite(Number(flags.duration)) && flags.duration ? Number(flags.duration) : 25;
  const mediaType = FOOTAGE_KINDS.includes(flags.footage) ? flags.footage : "auto";

  step(`写脚本：「${topic}」（${narrationStyle} · ${targetDuration}s）`);
  const scriptRes = await api("/api/topic/script", {
    method: "POST",
    body: { topic, narrationStyle, targetDuration, llmConfig: LLM },
  });
  const projectId = scriptRes.projectId;
  const shots = scriptRes?.scripts?.[0]?.shots ?? [];
  step(`脚本完成：${shots.length} 个分镜 · 项目 ${projectId}`);

  step(`配画面（${mediaType}，免费素材库）…`);
  const fill = await api(`/api/project/${projectId}/stock-fill`, {
    method: "POST",
    body: { source: "all", mediaType, apiKeys: STOCK_KEYS },
  });
  if (!fill.filled) {
    throw new Error(
      `免费素材库没给「${topic}」配到画面，无法合成。换个更常见/具体的主题，或设置 CLIPFORGE_PEXELS_KEY 后重试。`,
    );
  }
  step(`画面就绪：${fill.filled}/${fill.total}`);

  const body = composeBodyFromFlags(flags);
  if (!body.freeTts.voice) {
    const v = defaultVoiceForTopic(topic);
    if (v) body.freeTts.voice = v;
  }
  const usedVoice = body.freeTts.voice || "zh-CN-XiaoxiaoNeural";
  step(`合成中（Edge TTS 配音 · 音色 ${usedVoice}）…`);
  // POST returns the compositionId of this run — poll that exact one, not "latest"
  const { compositionId } = await api(`/api/project/${projectId}/compose`, { method: "POST", body });
  const composition = await pollCompose(projectId, { compositionId });

  return {
    ok: true,
    projectId,
    topic,
    voice: usedVoice,
    aspectRatio: ASPECT_RATIOS.includes(flags.aspect) ? flags.aspect : "9:16",
    shots: shots.length,
    footageFilled: `${fill.filled}/${fill.total}`,
    videoUrl: absVideoUrl(composition),
    status: composition.status,
  };
}

async function cmdCompose(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  if (flags["no-fill"] !== true) {
    step("自动配缺失画面…");
    await api(`/api/project/${projectId}/stock-fill`, {
      method: "POST",
      body: { source: "all", mediaType: FOOTAGE_KINDS.includes(flags.footage) ? flags.footage : "auto", apiKeys: STOCK_KEYS },
    }).catch(() => {});
  }
  const body = composeBodyFromFlags(flags);
  if (!body.freeTts.voice) {
    const proj = await api(`/api/project/${projectId}`).catch(() => null);
    const v = proj?.topic ? defaultVoiceForTopic(String(proj.topic)) : null;
    if (v) body.freeTts.voice = v;
  }
  step("合成中…");
  // POST returns the compositionId of this run — poll that exact one, not "latest"
  const { compositionId } = await api(`/api/project/${projectId}/compose`, { method: "POST", body });
  const composition = await pollCompose(projectId, { compositionId });
  return { ok: true, projectId, voice: body.freeTts.voice || "zh-CN-XiaoxiaoNeural", videoUrl: absVideoUrl(composition), status: composition.status };
}

async function cmdList() {
  const rows = await api("/api/project");
  const projects = (Array.isArray(rows) ? rows : []).map((p) => ({ id: p.id, name: p.name, contentType: p.contentType, status: p.status }));
  return { ok: true, count: projects.length, projects };
}

async function cmdVoices() {
  const res = await api("/api/tts/free");
  return { ok: true, default: res.default, voices: res.voices ?? [] };
}

// Cover/thumbnail: render a cover image from the latest composed video with a bold title overlay
async function cmdCover(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const title = String(flags.title || "").trim();
  if (!title) throw new Error('--title 不能为空（如 --title "手冲咖啡 三步搞定"）');
  const body = { title };
  if (["center", "lower", "upper"].includes(flags.position)) body.position = flags.position;
  if (flags.frame && Number.isFinite(Number(flags.frame))) body.frameAt = Number(flags.frame);
  const res = await api(`/api/project/${projectId}/cover`, { method: "POST", body });
  step(`封面已生成：${res.cover}`);
  return { ok: true, projectId, cover: res.cover };
}

// Shop QR: generate a scannable "scan to buy" QR for the project's shop link (UTM-tagged)
async function cmdQr(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (typeof flags.url === "string" && flags.url.trim()) body.url = flags.url.trim();
  if (typeof flags.platform === "string" && flags.platform.trim()) body.platform = flags.platform.trim();
  if (flags.size && Number.isFinite(Number(flags.size))) body.size = Number(flags.size);
  const res = await api(`/api/project/${projectId}/shop-qr`, { method: "POST", body });
  step(`商品二维码已生成：${res.qr}`);
  if (res.shopLink) step(`追踪链接：${res.shopLink}`);
  return { ok: true, projectId, qr: res.qr, shopLink: res.shopLink };
}

// End-card: burn a "scan to buy" QR onto the last few seconds of the composed video
async function cmdEndcard(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (typeof flags.url === "string" && flags.url.trim()) body.url = flags.url.trim();
  if (typeof flags.platform === "string" && flags.platform.trim()) body.platform = flags.platform.trim();
  if (flags.seconds && Number.isFinite(Number(flags.seconds))) body.seconds = Number(flags.seconds);
  if (typeof flags.cta === "string" && flags.cta.trim()) body.ctaText = flags.cta.trim();
  const res = await api(`/api/project/${projectId}/end-card`, { method: "POST", body });
  step(`片尾扫码购买成片已生成：${res.video}`);
  return { ok: true, projectId, video: res.video, shopLink: res.shopLink };
}

// GIF preview: turn a slice of the latest composed video into a shareable looping GIF
async function cmdPreview(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (flags.start && Number.isFinite(Number(flags.start))) body.startSec = Number(flags.start);
  if (flags.duration && Number.isFinite(Number(flags.duration))) body.durationSec = Number(flags.duration);
  if (flags.width && Number.isFinite(Number(flags.width))) body.width = Number(flags.width);
  const res = await api(`/api/project/${projectId}/preview-gif`, { method: "POST", body });
  step(`预览 GIF 已生成：${res.gif}`);
  return { ok: true, projectId, gif: res.gif };
}

// Carousel: render image cards (title + key lines) from the script for image-first platforms (Xiaohongshu)
async function cmdCarousel(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (flags.width && Number.isFinite(Number(flags.width))) body.width = Number(flags.width);
  if (flags.height && Number.isFinite(Number(flags.height))) body.height = Number(flags.height);
  if (typeof flags.theme === "string") body.theme = flags.theme;
  const res = await api(`/api/project/${projectId}/carousel`, { method: "POST", body });
  step(`图文卡片已生成 ${res.count} 张：`);
  (res.cards || []).forEach((c, i) => process.stderr.write(`  ${i}. ${c}\n`));
  return { ok: true, projectId, count: res.count, cards: res.cards };
}

// Trending topics: fetch daily trending searches for a region and suggest what topic to produce next (then use create --topic)
async function cmdTrends(flags) {
  const geo = typeof flags.geo === "string" ? flags.geo : "US";
  const res = await api(`/api/trends?geo=${encodeURIComponent(geo)}`);
  const topics = res.topics || [];
  step(`${res.geo} 热搜选题 ${topics.length} 条：`);
  topics.forEach((t, i) => process.stderr.write(`  ${i + 1}. ${t.title}${t.traffic ? ` (${t.traffic})` : ""}\n`));
  return { ok: true, geo: res.geo, count: topics.length, topics };
}

async function cmdGet(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const { composition } = await api(`/api/project/${projectId}/compose`);
  if (!composition) return { ok: true, projectId, status: "none", videoUrl: null };
  return { ok: true, projectId, status: composition.status, videoUrl: absVideoUrl(composition) };
}

// Import your own script: split a pre-written script into shots and save as the current script, then use compose to render (combine with local assets for a fully self-sufficient pipeline)
async function cmdImport(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  let script = typeof flags.text === "string" ? flags.text : "";
  if (!script && flags.file) script = readFileSync(String(flags.file), "utf8");
  if (!script.trim()) throw new Error('用 --file <路径> 或 --text "你的脚本文案" 提供稿子');
  const res = await api(`/api/project/${projectId}/import-script`, {
    method: "POST",
    body: { script, title: typeof flags.title === "string" ? flags.title : undefined },
  });
  step(`已导入 ${res.shots} 个分镜（约 ${res.totalDuration}s）。下一步：clipforge compose --project ${projectId}`);
  return { ok: true, projectId, ...res };
}

// Dubbing / localization: translate the current script into the target language and save as a dubbed version; compose with the recommended voice to produce a localized voiceover (for international distribution)
async function cmdDub(flags) {
  requireLlm();
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const lang = String(flags.lang || "").trim();
  if (!lang) throw new Error('--lang 不能为空（如 --lang en）');
  const res = await api(`/api/project/${projectId}/dub`, { method: "POST", body: { targetLang: lang, llmConfig: LLM } });
  step(`已生成 ${lang} 译制脚本（${res.shots} 镜）。下一步：clipforge compose --project ${projectId} --voice ${res.recommendedVoice || "<目标语种音色>"}`);
  return { ok: true, projectId, ...res };
}

const HELP = `ClipForge CLI · 命令行一句话出片

用法：
  clipforge create --topic "在家手冲咖啡" [--duration 25] [--style knowledge]
                   [--footage auto|image|video] [--voice <id>] [--aspect 9:16|16:9|1:1]
                   [--quality fast|standard|hd] [--bgm] [--bgm-mood upbeat] [--karaoke] [--cta "..."] [--json]
  clipforge import --project <id> (--file <路径> | --text "你的脚本") [--title "..."]   自带脚本出片
  clipforge dub --project <id> --lang en                                              配音译制(换语种,出海)
  clipforge compose --project <id> [同款成片选项] [--no-fill]
  clipforge trends [--geo US]   拉热搜选题(不知道做什么时)
  clipforge list                列出项目
  clipforge voices              列出免费 Edge TTS 音色
  clipforge cover --project <id> --title "手冲咖啡 三步搞定" [--position center|lower|upper]   生成封面图
  clipforge qr --project <id> [--platform douyin --url <shopUrl> --size 512]   生成商品「扫码购买」二维码(UTM追踪)
  clipforge endcard --project <id> [--platform douyin --seconds 3 --cta "扫码购买"]   把扫码购买二维码烧进成片片尾(需先合成)
  clipforge preview --project <id> [--start 0 --duration 4 --width 360]   生成预览 GIF
  clipforge carousel --project <id> [--theme night|warm|mint|mono|rose]   生成小红书图文卡片(标题+逐条要点)
  clipforge get --project <id>  查最新成片地址
  clipforge --help | --version

环境变量：
  CLIPFORGE_BASE_URL（默认 http://localhost:3000，需先 pnpm dev/start）
  CLIPFORGE_LLM_BASE_URL / CLIPFORGE_LLM_API_KEY / CLIPFORGE_LLM_MODEL（create 必需）
  CLIPFORGE_PEXELS_KEY / CLIPFORGE_PIXABAY_KEY（可选）

进度打印到 stderr，最终结果（含 videoUrl）打印到 stdout，便于管道取值。`;

const COMMANDS = { create: cmdCreate, import: cmdImport, dub: cmdDub, compose: cmdCompose, cover: cmdCover, qr: cmdQr, endcard: cmdEndcard, preview: cmdPreview, carousel: cmdCarousel, list: cmdList, voices: cmdVoices, get: cmdGet, trends: cmdTrends };

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  if (flags.version || flags.v) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }
  const cmd = _[0];
  if (!cmd || flags.help || flags.h || cmd === "help") {
    process.stdout.write(HELP + "\n");
    return cmd && !COMMANDS[cmd] ? 1 : 0;
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`未知命令：${cmd}\n\n${HELP}\n`);
    return 1;
  }
  const result = await handler(flags);
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.videoUrl) {
      step("完成 ✓");
      process.stdout.write(result.videoUrl + "\n");
    } else {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    }
  }
  return 0;
}

// Only run when executed as an entry point (not when imported by unit tests)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((e) => {
      process.stderr.write(`✗ ${e?.message || e}\n`);
      process.exit(1);
    });
}
