/**
 * 免费配音兜底 —— 微软 Edge「大声朗读」在线 TTS，无需任何 API Key。
 *
 * 用 Node 内置 WebSocket + crypto（不引入任何第三方依赖，便于 Electron 打包），
 * 直连 Edge 朗读服务的 websocket 合成中文/多语种语音，产出 mp3 字节。
 * 这是「一句话主题成片」零配置出声的关键：用户没配付费 TTS 时也能有人声旁白。
 *
 * 注意：该服务由微软提供，握手需要带 Sec-MS-GEC 动态令牌 + 一个跟随 Edge 版本号的
 * Sec-MS-GEC-Version。微软偶尔会要求更新版本号（旧版本号会 403）。这里把版本号设为
 * 常量并支持用环境变量 EDGE_TTS_VERSION 覆盖，免改代码即可在线修复。
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
/** 跟随当前 Edge/Chromium 版本，过期会 403；可用 EDGE_TTS_VERSION 覆盖 */
const SEC_MS_GEC_VERSION = process.env.EDGE_TTS_VERSION || "1-143.0.3650.75";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

/**
 * 精选免费音色（短名 + 标签 + 语言），默认温柔女声小晓。
 * 全球化定位：英文/日/韩/西脚本需对应语言原生发音，不能用中文音色读外文（发音错乱）。
 * 这些都是 Edge keyless 真实可合成的音色（已 server 实测出 18~26KB mp3）；generateSpeechFree
 * 本就接受任意 Edge 音色名，此处只是把非中文音色「列出来」让全球用户/agent 能发现选用。
 */
export const FREE_TTS_VOICES: { value: string; label: string; gender: "female" | "male"; lang: string }[] = [
  // 中文（默认市场）
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 温柔女声", gender: "female", lang: "zh-CN" },
  { value: "zh-CN-XiaoyiNeural", label: "晓伊 · 活泼女声", gender: "female", lang: "zh-CN" },
  { value: "zh-CN-YunxiNeural", label: "云希 · 阳光男声", gender: "male", lang: "zh-CN" },
  { value: "zh-CN-YunyangNeural", label: "云扬 · 专业播报男声", gender: "male", lang: "zh-CN" },
  { value: "zh-CN-YunjianNeural", label: "云健 · 沉稳解说男声", gender: "male", lang: "zh-CN" },
  // English（出海主力）
  { value: "en-US-AriaNeural", label: "Aria · US English (female)", gender: "female", lang: "en-US" },
  { value: "en-US-GuyNeural", label: "Guy · US English (male)", gender: "male", lang: "en-US" },
  { value: "en-GB-SoniaNeural", label: "Sonia · UK English (female)", gender: "female", lang: "en-GB" },
  // 日/韩市场（内置 Noto CJK 字幕字体 public/fonts/subtitle.otf 覆盖假名+谚文，字幕能正常渲染）
  { value: "ja-JP-NanamiNeural", label: "Nanami · 日本語 (female)", gender: "female", lang: "ja-JP" },
  { value: "ko-KR-SunHiNeural", label: "SunHi · 한국어 (female)", gender: "female", lang: "ko-KR" },
  // 西语市场（拉丁字形在中文字体覆盖内）
  { value: "es-ES-ElviraNeural", label: "Elvira · Español (female)", gender: "female", lang: "es-ES" },
];

export const DEFAULT_FREE_VOICE = "zh-CN-XiaoxiaoNeural";

export interface FreeTTSOptions {
  /** 音色短名，默认 zh-CN-XiaoxiaoNeural */
  voice?: string;
  /** 语速，如 "+0%" / "-10%" / "+20%"，默认 "+0%" */
  rate?: string;
  /** 音调，如 "+0Hz" / "+2st"，默认 "+0Hz" */
  pitch?: string;
  /** 超时毫秒，默认 20000 */
  timeoutMs?: number;
}

/** 转义 SSML 文本中的 XML 特殊字符，避免旁白含 & < > 等字符破坏请求 */
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
 * 生成 Sec-MS-GEC 令牌：.NET ticks（自 1601 的 100ns 间隔）向下取整到最近 300 秒，
 * 拼上信任令牌后做 SHA-256 大写十六进制。与 edge-tts 官方算法一致。
 */
async function secMsGec(): Promise<string> {
  let ticks = (Math.floor(Date.now() / 1000) + 11644473600) * 10_000_000;
  ticks -= ticks % 3_000_000_000; // 300s = 3e9 个 100ns
  return sha256Upper(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
}

function uuidNoDash(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function tsString(): string {
  return new Date().toString().replace(/GMT.*$/, "GMT+0000 (Coordinated Universal Time)");
}

/**
 * 用微软 Edge 免费在线 TTS 合成一段语音，返回 mp3 字节（audio-24khz-48kbitrate-mono-mp3）。
 * 失败（网络/403/超时/空音频）会抛错；调用方应捕获后优雅降级（合成可只留字幕）。
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

  const gec = await secMsGec();
  const url =
    `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${uuidNoDash()}`;

  // Node 的全局 WebSocket(undici) 支持非标准 headers 选项；带上 UA/Origin/muid 更稳
  // （muid 随机 cookie 是新版 edge-tts 端口对部分风控的兜底，便宜的保险）
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

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* 忽略关闭异常 */ }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("Edge TTS 超时"))), timeoutMs);

    ws.onopen = () => {
      const cfg =
        `X-Timestamp:${tsString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
      ws.send(cfg);
      // voice/pitch/rate 同样转义：它们落在单引号 SSML 属性里，未转义的 ' 可越界注入 SSML（防御纵深，兜底所有调用方）
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
        // 二进制帧：前 2 字节大端 = header 长度；header 含 Path:audio 时其后为音频
        const buf = Buffer.from(data as ArrayBuffer);
        if (buf.length < 2) return;
        const headerLen = buf.readUInt16BE(0);
        const header = buf.subarray(2, 2 + headerLen).toString("utf-8");
        if (header.includes("Path:audio")) chunks.push(buf.subarray(2 + headerLen));
      }
    };

    ws.onerror = () => finish(() => reject(new Error("Edge TTS 连接失败（可能是网络或令牌版本过期）")));
    ws.onclose = (ev: CloseEvent) => {
      // 正常结束时一般已在 turn.end 处 resolve；此处兜底
      finish(() => (chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error(`Edge TTS 连接关闭(code=${ev?.code ?? "?"})`))));
    };
  });
}
