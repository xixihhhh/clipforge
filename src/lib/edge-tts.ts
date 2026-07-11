/**
 * Free TTS fallback — Microsoft Edge "Read Aloud" online TTS, no API key required.
 *
 * Uses Node's built-in WebSocket + crypto (zero third-party dependencies, Electron-friendly)
 * to connect directly to the Edge Read Aloud WebSocket service and synthesize Chinese /
 * multilingual speech, returning raw mp3 bytes.
 * This is the key enabler for zero-config voiceovers in "one-sentence topic" videos:
 * users get narration even without a paid TTS configured.
 *
 * Note: the service is provided by Microsoft; the WebSocket handshake requires a dynamic
 * Sec-MS-GEC token plus a Sec-MS-GEC-Version that tracks the current Edge version.
 * Microsoft occasionally rotates the expected version (old values return 403). The version
 * is therefore stored as a constant that can be overridden via the EDGE_TTS_VERSION env var,
 * allowing a fix without a code change.
 */

import { ttsCacheKey, readTtsCache, writeTtsCache } from "@/lib/tts-cache";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
/** Tracks the current Edge/Chromium version; returns 403 when expired — override via EDGE_TTS_VERSION */
const SEC_MS_GEC_VERSION = process.env.EDGE_TTS_VERSION || "1-143.0.3650.75";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

/**
 * Curated free voices (short name + label + language). Defaults to the gentle female voice Xiaoxiao.
 * Global positioning: English/Japanese/Korean/Spanish scripts need native-language voices —
 * using a Chinese voice for foreign-language text produces garbled output.
 * All entries are real Edge keyless-synthesisable voices (server-tested to produce 18–26 KB mp3);
 * generateSpeechFree already accepts any Edge voice name — this list simply makes non-Chinese voices
 * discoverable for international users and agents.
 */
// Voice catalogue lives in the client-safe tts-voices module (this file imports fs via tts-cache,
// which would break browser bundles that only need the list); re-exported here for server callers.
import { DEFAULT_FREE_VOICE } from "./tts-voices";
export { FREE_TTS_VOICES, DEFAULT_FREE_VOICE } from "./tts-voices";

export interface FreeTTSOptions {
  /** Voice short name, defaults to zh-CN-XiaoxiaoNeural */
  voice?: string;
  /** Speech rate, e.g. "+0%" / "-10%" / "+20%", defaults to "+0%" */
  rate?: string;
  /** Pitch, e.g. "+0Hz" / "+2st", defaults to "+0Hz" */
  pitch?: string;
  /** Timeout in milliseconds, defaults to 20000 */
  timeoutMs?: number;
}

/** Escape XML special characters in SSML text to prevent voiceover content containing & < > etc. from corrupting the request */
export function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function sha256Upper(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Generate the Sec-MS-GEC token: .NET ticks (100 ns intervals since 1601) rounded down
 * to the nearest 300-second boundary, concatenated with the trusted client token,
 * then SHA-256 hashed as uppercase hex. Matches the official edge-tts algorithm.
 */
async function secMsGec(): Promise<string> {
  let ticks = (Math.floor(Date.now() / 1000) + 11644473600) * 10_000_000;
  ticks -= ticks % 3_000_000_000; // 300 s = 3e9 × 100 ns
  return sha256Upper(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
}

function uuidNoDash(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function tsString(): string {
  return new Date().toString().replace(/GMT.*$/, "GMT+0000 (Coordinated Universal Time)");
}

/**
 * Synthesize speech using Microsoft Edge's free online TTS and return the mp3 bytes
 * (audio-24khz-48kbitrate-mono-mp3). Throws on failure (network / 403 / timeout / empty audio);
 * callers should catch and gracefully degrade (e.g. produce subtitles only).
 */
export async function generateSpeechFree(text: string, opts: FreeTTSOptions = {}): Promise<Buffer> {
  if (typeof WebSocket === "undefined") {
    throw new Error("当前运行时不支持 WebSocket（需 Node 18+ 的 Node 运行时）");
  }
  const clean = (text || "").trim();
  if (!clean) throw new Error("配音文本为空");

  const voice = opts.voice || DEFAULT_FREE_VOICE;
  const rate = opts.rate || "+0%";
  const pitch = opts.pitch || "+0Hz";
  const timeoutMs = opts.timeoutMs ?? 20000;

  // Content-addressed cache: identical text + voice params reuse the previous audio, sparing
  // the free Edge endpoint (hammering it on every re-compose risks rate-limits / 403).
  // Keyed over the RESOLVED defaults so an omitted rate and an explicit "+0%" share one entry;
  // timeoutMs doesn't affect the audio bytes and is excluded.
  const cacheKey = ttsCacheKey({ provider: "edge", voice, rate, pitch, text: clean });
  const cached = await readTtsCache(cacheKey);
  if (cached) return cached;

  const gec = await secMsGec();
  const url =
    `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${uuidNoDash()}`;

  // Node's global WebSocket (undici) accepts a non-standard headers option; sending UA/Origin/muid improves stability.
  // (The random muid cookie is a cheap safety net against some rate-limiting checks in newer edge-tts endpoints.)
  const muid = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const ws = new WebSocket(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Pragma": "no-cache",
      "Cache-Control": "no-cache",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: `muid=${muid};`,
    },
  } as unknown as string[]);
  ws.binaryType = "arraybuffer";

  const audio = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore close errors */ }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("Edge TTS 超时"))), timeoutMs);

    ws.onopen = () => {
      const cfg =
        `X-Timestamp:${tsString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
      ws.send(cfg);
      // voice/pitch/rate are also escaped: they appear inside single-quoted SSML attributes, so an unescaped ' could break out and inject SSML (defense-in-depth, covers all callers)
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
        `<voice name='${escapeSsml(voice)}'><prosody pitch='${escapeSsml(pitch)}' rate='${escapeSsml(rate)}' volume='+0%'>${escapeSsml(clean)}</prosody></voice></speak>`;
      const msg =
        `X-RequestId:${uuidNoDash()}\r\nContent-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${tsString()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
      ws.send(msg);
    };

    ws.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (typeof data === "string") {
        if (data.includes("Path:turn.end")) {
          finish(() => (chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error("Edge TTS 未返回音频"))));
        }
      } else {
        // Binary frame: first 2 bytes big-endian = header length; payload after header is audio when header contains Path:audio
        const buf = Buffer.from(data as ArrayBuffer);
        if (buf.length < 2) return;
        const headerLen = buf.readUInt16BE(0);
        const header = buf.subarray(2, 2 + headerLen).toString("utf-8");
        if (header.includes("Path:audio")) chunks.push(buf.subarray(2 + headerLen));
      }
    };

    ws.onerror = () => finish(() => reject(new Error("Edge TTS 连接失败（可能是网络或令牌版本过期）")));
    ws.onclose = (ev: CloseEvent) => {
      // On a clean close the promise is usually already resolved at turn.end; this is the fallback
      finish(() => (chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error(`Edge TTS 连接关闭(code=${ev?.code ?? "?"})`))));
    };
  });

  // Write-through on success only (failures throw above and are never cached); cache errors degrade silently
  await writeTtsCache(cacheKey, audio);
  return audio;
}
