import { NextRequest, NextResponse } from "next/server";
import { generateSpeechFree, FREE_TTS_VOICES, DEFAULT_FREE_VOICE } from "@/lib/edge-tts";

// GET /api/tts/free —— 列出可用的免费音色（无需任何 Key）
export async function GET() {
  return NextResponse.json({ voices: FREE_TTS_VOICES, default: DEFAULT_FREE_VOICE });
}

// POST /api/tts/free —— 试听：用微软 Edge keyless TTS 合成一小段语音，直接返回 mp3
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* 允许空 body，用默认试听词 */
  }
  const text = (typeof body.text === "string" && body.text.trim()) || "你好，这是免费配音的试听效果。";
  // 校验音色名只含安全字符（Edge 音色形如 en-US-AriaNeural；保留连字符，兼容任意合法 Edge 音色而非仅白名单）——非法落默认，防 SSML 注入
  const voice = typeof body.voice === "string" && /^[A-Za-z0-9-]{1,40}$/.test(body.voice) ? body.voice : DEFAULT_FREE_VOICE;
  // 语速须是 SSML prosody rate 格式（如 +10% / -5%）——非法则不传，防 SSML 注入
  const rate = typeof body.rate === "string" && /^[+-]?\d{1,3}%$/.test(body.rate) ? body.rate : undefined;

  try {
    const audio = await generateSpeechFree(text.slice(0, 200), { voice, rate });
    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "免费配音生成失败" },
      { status: 502 }
    );
  }
}
