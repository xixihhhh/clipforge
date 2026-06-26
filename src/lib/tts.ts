/**
 * TTS 配音 —— 多平台统一入口。
 *
 * 支持四类付费 TTS，按 config.provider 分发（缺省 "openai" 向后兼容旧配置）：
 * - openai：OpenAI 兼容 /audio/speech（tts-1 / 硅基流动 CosyVoice / 火山方舟…），同步返回 mp3。
 * - atlas：Atlas Cloud generateAudio（xai/tts-v1），异步——提交拿 prediction id 后轮询取音频 URL。
 * - minimax：MiniMax 海螺 T2A v2，同步返回 hex 编码 mp3（国内端点需 GroupId）。
 * - falai：fal.ai（MiniMax Speech-02），队列异步——提交后轮询 status，完成取 audio.url。
 *
 * 所有 provider 统一产出 mp3 字节（Buffer），上层（合成/试听）无需关心差异。
 */

import type { TTSProvider } from "./tts-presets";

export interface TTSConfig {
  /** 平台，缺省 "openai" */
  provider?: TTSProvider;
  /** baseUrl（按平台含义不同：OpenAI 兼容根、Atlas/MiniMax/fal 的服务根） */
  baseUrl: string;
  apiKey: string;
  /** 模型 id */
  model: string;
  /** 音色 / voice_id */
  voice: string;
  /** 语速倍率，0.5~2（各平台会各自夹取到合法区间），默认 1 */
  speed?: number;
  /** MiniMax 国内端点的 GroupId（可选） */
  groupId?: string;
}

/** 生成配音音频，返回 mp3 字节。失败抛错，由调用方决定降级。 */
export async function generateSpeech(text: string, config: TTSConfig): Promise<Buffer> {
  const clean = (text || "").trim();
  if (!clean) throw new Error("配音文本为空");
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

/** 把响应里的音频字段（URL / data URI / base64 / hex）统一下载或解码成 Buffer */
async function audioToBuffer(input: string): Promise<Buffer> {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) {
    // 加 30s 超时：远端音频服务器慢/挂起时不会无限阻塞、连累整个 TTS→合成流程
    const resp = await fetch(s, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`下载音频失败: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }
  if (s.startsWith("data:")) {
    const comma = s.indexOf(",");
    return Buffer.from(s.slice(comma + 1), "base64");
  }
  // 纯 hex（仅 0-9a-f 且偶数长度）按 hex 解，否则按 base64
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
    throw new Error(`TTS 请求失败: ${resp.status} ${resp.statusText} - ${errText.slice(0, 200)}`);
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
    signal: AbortSignal.timeout(30000), // 提交加 30s 超时，避免挂起
  });
  if (!submit.ok) {
    const t = await submit.text().catch(() => "");
    throw new Error(`Atlas TTS 提交失败: ${submit.status} - ${t.slice(0, 200)}`);
  }
  const sj = (await submit.json()) as { data?: { id?: string }; id?: string };
  const taskId = sj?.data?.id ?? sj?.id;
  if (!taskId) throw new Error("Atlas TTS 未返回任务 id");

  // 轮询 prediction（TTS 通常数秒内完成）
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    // 每次轮询加 10s 超时，且超时/网络抖动只跳过本轮（下轮再试），避免一次卡顿挂死整个生成
    let pr: Response;
    try {
      pr = await fetch(`${base}/model/prediction/${taskId}`, { headers, signal: AbortSignal.timeout(10000) });
    } catch {
      continue;
    }
    if (!pr.ok) continue;
    const raw = (await pr.json()) as AtlasPrediction;
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
    throw new Error(`MiniMax TTS 请求失败: ${resp.status} - ${t.slice(0, 200)}`);
  }
  const j = (await resp.json()) as {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };
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
    throw new Error(`fal TTS 提交失败: ${submit.status} - ${t.slice(0, 200)}`);
  }
  const sj = (await submit.json()) as { request_id?: string; status_url?: string; response_url?: string };
  if (!sj?.request_id) throw new Error("fal TTS 未返回 request_id");
  // 优先用返回的 status_url / response_url（最稳），否则按队列约定拼接
  const statusUrl = sj.status_url || `${base}/${model}/requests/${sj.request_id}/status`;
  const resultUrl = sj.response_url || `${base}/${model}/requests/${sj.request_id}`;

  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const st = await fetch(statusUrl, { headers });
    if (!st.ok) continue;
    const sjson = (await st.json()) as { status?: string };
    const status = (sjson.status || "").toUpperCase();
    if (status === "COMPLETED") {
      const rr = await fetch(resultUrl, { headers });
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
