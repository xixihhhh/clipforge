/**
 * TTS dubbing — unified entry point for multiple platforms.
 *
 * Supports four paid TTS providers, dispatched by config.provider
 * (defaults to "openai" for backward compatibility with legacy configs):
 * - openai: OpenAI-compatible /audio/speech (tts-1 / SiliconFlow CosyVoice / Volcengine Ark…), synchronous mp3.
 * - atlas: Atlas Cloud generateAudio (xai/tts-v1), async — submit, get prediction id, then poll for audio URL.
 * - minimax: MiniMax Hailuo T2A v2, synchronous hex-encoded mp3 (domestic endpoint requires GroupId).
 * - falai: fal.ai (MiniMax Speech-02), queue async — submit, poll status, fetch audio.url on completion.
 *
 * All providers produce mp3 bytes (Buffer); callers (compose/preview) need not handle provider differences.
 */

import type { TTSProvider } from "./tts-presets";
import { CircuitBreaker } from "@/lib/circuit-breaker";
import { ttsCacheKey, readTtsCache, writeTtsCache } from "@/lib/tts-cache";

export interface TTSConfig {
  /** Platform; defaults to "openai" */
  provider?: TTSProvider;
  /** baseUrl (meaning varies by platform: root for OpenAI-compatible, service root for Atlas/MiniMax/fal) */
  baseUrl: string;
  apiKey: string;
  /** Model id */
  model: string;
  /** Voice / voice_id */
  voice: string;
  /** Playback speed multiplier, 0.5–2 (each platform clamps to its own valid range); defaults to 1 */
  speed?: number;
  /** GroupId for MiniMax domestic endpoint (optional) */
  groupId?: string;
}

/** Generate TTS audio, returns mp3 bytes. Throws on failure; caller decides on fallback. */
// Circuit breaker: after 2 consecutive failures for the same provider (most likely an invalid key
// or downed service), fail-fast all subsequent TTS calls so a bad key doesn't let every shot in a
// batch time out individually and stall the whole compose pipeline; auto half-opens after 30s.
const ttsBreakers = new Map<string, CircuitBreaker>();
function ttsBreaker(provider: string): CircuitBreaker {
  let b = ttsBreakers.get(provider);
  if (!b) {
    b = new CircuitBreaker(2, 30_000);
    ttsBreakers.set(provider, b);
  }
  return b;
}

export async function generateSpeech(text: string, config: TTSConfig): Promise<Buffer> {
  const clean = (text || "").trim();
  if (!clean) throw new Error("配音文本为空");
  const provider = config.provider || "openai";
  // Content-addressed cache: identical text + voice params reuse the previously synthesized
  // audio, so a re-compose (e.g. after a BGM tweak) doesn't re-bill the paid TTS provider.
  // baseUrl is part of the identity — the same model/voice names on different endpoints
  // (OpenAI vs SiliconFlow vs Ark…) are different engines producing different audio.
  // apiKey/groupId are deliberately excluded: they select the account, not the sound.
  // Checked before the circuit breaker so cached audio still works while the breaker is open.
  const cacheKey = ttsCacheKey({
    provider,
    baseUrl: config.baseUrl,
    model: config.model,
    voice: config.voice,
    speed: config.speed,
    text: clean,
  });
  const cached = await readTtsCache(cacheKey);
  if (cached) return cached;
  const breaker = ttsBreaker(provider);
  if (breaker.isOpen()) {
    throw new Error(`配音服务(${provider})连续失败已暂时熔断——请检查对应平台 Key/服务，约 30 秒后自动重试`);
  }
  try {
    const buf = await dispatchTTS(clean, config);
    breaker.recordSuccess();
    // Write-through on success only (failures are never cached); cache errors degrade silently
    await writeTtsCache(cacheKey, buf);
    return buf;
  } catch (e) {
    breaker.recordFailure();
    throw e;
  }
}

/**
 * Rough speech-duration estimate in seconds, used when ffprobe cannot report the length
 * of a synthesized audio file (issue #14: a failed probe fell back to the script's guessed
 * shot duration, hard-trimming the narration mid-sentence).
 * Calibrated for zh narration voices at 1.0x speed (~4.2 CJK chars/sec, ~2.8 Latin
 * words/sec, plus punctuation pauses) and deliberately errs long by 15%: extra tail
 * silence is harmless, while an under-estimate cuts speech.
 */
export function estimateSpeechSeconds(text: string): number {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return 0;
  let cjkChars = 0;
  let pauses = 0;
  let latin = "";
  for (const ch of Array.from(clean)) {
    if (/[⺀-鿿豈-﫿぀-ヿ가-힣]/.test(ch)) cjkChars++;
    else if (/[。！？；，、：…!?;,.]/.test(ch)) pauses++;
    else latin += ch;
  }
  const latinWords = latin.split(/\s+/).filter(Boolean).length;
  const sec = cjkChars / 4.2 + latinWords / 2.8 + pauses * 0.2;
  return Math.max(1, sec * 1.15);
}

function dispatchTTS(clean: string, config: TTSConfig): Promise<Buffer> {
  switch (config.provider) {
    case "atlas":
      return generateSpeechAtlas(clean, config);
    case "minimax":
      return generateSpeechMiniMax(clean, config);
    case "falai":
      return generateSpeechFal(clean, config);
    default:
      return generateSpeechOpenAI(clean, config);
  }
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Truncate error body to 200 characters and explicitly mark the ellipsis, avoiding silent truncation that could be mistaken for a complete error message */
const clipErr = (s: string) => (s.length > 200 ? s.slice(0, 200) + "…(已截断)" : s);

/** Normalize an audio field from a response (URL / data URI / base64 / hex) by downloading or decoding it into a Buffer */
async function audioToBuffer(input: string): Promise<Buffer> {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) {
    // 30s timeout: prevents indefinite blocking when a remote audio server is slow or hung,
    // which would stall the entire TTS → compose pipeline
    const resp = await fetch(s, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`下载音频失败: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }
  if (s.startsWith("data:")) {
    const comma = s.indexOf(",");
    // A well-formed data URI always has a comma before the payload; without it, slice(0) would
    // feed the "data:...;base64" header into the base64 decoder and yield garbage/empty audio.
    if (comma === -1) throw new Error("音频 data URI 格式错误（缺少逗号分隔符）");
    return Buffer.from(s.slice(comma + 1), "base64");
  }
  // Pure hex (only 0-9a-f and even length): decode as hex; otherwise decode as base64
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) return Buffer.from(s, "hex");
  return Buffer.from(s, "base64");
}

// ==================== OpenAI 兼容 /audio/speech ====================

async function generateSpeechOpenAI(text: string, config: TTSConfig): Promise<Buffer> {
  const base = config.baseUrl.replace(/\/$/, "");
  const resp = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: text,
      voice: config.voice,
      response_format: "mp3",
      ...(config.speed != null && { speed: config.speed }),
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`TTS 请求失败: ${resp.status} ${resp.statusText} - ${clipErr(errText)}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

// ==================== Atlas Cloud generateAudio（异步轮询） ====================

interface AtlasPrediction {
  id?: string;
  status?: string;
  outputs?: string[];
  output?: string | { audio?: string; url?: string };
  audio?: string;
  error?: string;
  data?: AtlasPrediction;
}

async function generateSpeechAtlas(text: string, config: TTSConfig): Promise<Buffer> {
  const base = (config.baseUrl || "https://api.atlascloud.ai/api/v1").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" };

  const submit = await fetch(`${base}/model/generateAudio`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model || "xai/tts-v1",
      text,
      language: "auto",
      voice_id: config.voice || "eve",
      codec: "mp3",
      ...(config.speed != null && { speed: clamp(config.speed, 0.7, 1.5) }),
    }),
    signal: AbortSignal.timeout(30000), // 30s timeout on submit to avoid hanging
  });
  if (!submit.ok) {
    const t = await submit.text().catch(() => "");
    throw new Error(`Atlas TTS 提交失败: ${submit.status} - ${clipErr(t)}`);
  }
  const sj = (await submit.json()) as { data?: { id?: string }; id?: string };
  const taskId = sj?.data?.id ?? sj?.id;
  if (!taskId) throw new Error("Atlas TTS 未返回任务 id");

  // Poll for prediction result (TTS usually completes within a few seconds)
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    // 10s timeout per poll; on timeout or network jitter just skip this round and retry next,
    // so a single slow poll doesn't deadlock the entire generation
    let pr: Response;
    try {
      pr = await fetch(`${base}/model/prediction/${taskId}`, { headers, signal: AbortSignal.timeout(10000) });
    } catch {
      continue;
    }
    if (!pr.ok) continue;
    let raw: AtlasPrediction;
    try {
      raw = (await pr.json()) as AtlasPrediction;
    } catch {
      continue; // malformed JSON on a 200 → skip this poll and retry, don't crash the whole generation
    }
    const p: AtlasPrediction = raw.data ?? raw;
    const status = (p.status || "").toLowerCase();
    if (status === "completed" || status === "succeeded") {
      const audio =
        p.outputs?.[0] ??
        (typeof p.output === "string" ? p.output : p.output?.url || p.output?.audio) ??
        p.audio;
      if (!audio) throw new Error("Atlas TTS 完成但未返回音频");
      return audioToBuffer(audio);
    }
    if (status === "failed" || status === "error") {
      throw new Error(`Atlas TTS 失败: ${p.error || status}`);
    }
  }
  throw new Error("Atlas TTS 轮询超时");
}

// ==================== MiniMax 海螺 T2A v2（hex 解码） ====================

async function generateSpeechMiniMax(text: string, config: TTSConfig): Promise<Buffer> {
  const base = (config.baseUrl || "https://api.minimax.chat/v1").replace(/\/$/, "");
  const url = `${base}/t2a_v2` + (config.groupId ? `?GroupId=${encodeURIComponent(config.groupId)}` : "");
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model || "speech-2.6-hd",
      text,
      stream: false,
      output_format: "hex",
      language_boost: "auto",
      voice_setting: {
        voice_id: config.voice || "female-tianmei",
        speed: config.speed != null ? clamp(config.speed, 0.5, 2) : 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`MiniMax TTS 请求失败: ${resp.status} - ${clipErr(t)}`);
  }
  let j: { data?: { audio?: string }; base_resp?: { status_code?: number; status_msg?: string } };
  try {
    j = await resp.json();
  } catch (e) {
    throw new Error(`MiniMax TTS 响应解析失败（非合法 JSON）: ${e instanceof Error ? e.message : String(e)}`);
  }
  const code = j?.base_resp?.status_code;
  if (code != null && code !== 0) {
    throw new Error(`MiniMax TTS 失败: ${j?.base_resp?.status_msg || "未知错误"} (code=${code})`);
  }
  const hex = j?.data?.audio;
  if (!hex) throw new Error("MiniMax TTS 未返回音频（检查 Key / GroupId / 音色 id）");
  return Buffer.from(hex, "hex");
}

// ==================== fal.ai（MiniMax Speech-02，队列异步） ====================

async function generateSpeechFal(text: string, config: TTSConfig): Promise<Buffer> {
  const base = (config.baseUrl || "https://queue.fal.run").replace(/\/$/, "");
  const model = config.model || "fal-ai/minimax/speech-02-hd";
  const headers = { Authorization: `Key ${config.apiKey}`, "Content-Type": "application/json" };

  const submit = await fetch(`${base}/${model}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text,
      output_format: "url",
      voice_setting: {
        voice_id: config.voice || "Wise_Woman",
        speed: config.speed != null ? clamp(config.speed, 0.5, 2) : 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
    }),
  });
  if (!submit.ok) {
    const t = await submit.text().catch(() => "");
    throw new Error(`fal TTS 提交失败: ${submit.status} - ${clipErr(t)}`);
  }
  const sj = (await submit.json()) as { request_id?: string; status_url?: string; response_url?: string };
  if (!sj?.request_id) throw new Error("fal TTS 未返回 request_id");
  // Prefer the returned status_url / response_url (most reliable); fall back to constructing queue URLs by convention
  const statusUrl = sj.status_url || `${base}/${model}/requests/${sj.request_id}/status`;
  const resultUrl = sj.response_url || `${base}/${model}/requests/${sj.request_id}`;

  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    // Network jitter or a malformed status/result response must not crash the whole generation —
    // skip this poll and retry next round (mirrors the Atlas polling loop's resilience).
    let status: string;
    try {
      const st = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (!st.ok) continue;
      const sjson = (await st.json()) as { status?: string };
      status = (sjson.status || "").toUpperCase();
    } catch {
      continue;
    }
    if (status === "COMPLETED") {
      const rr = await fetch(resultUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (!rr.ok) throw new Error(`fal TTS 取结果失败: ${rr.status}`);
      const result = (await rr.json()) as { audio?: { url?: string } };
      const audioUrl = result?.audio?.url;
      if (!audioUrl) throw new Error("fal TTS 完成但未返回音频 URL");
      return audioToBuffer(audioUrl);
    }
    if (status === "FAILED" || status === "ERROR") {
      throw new Error("fal TTS 任务失败");
    }
  }
  throw new Error("fal TTS 轮询超时");
}
