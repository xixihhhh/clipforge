import { NextRequest, NextResponse } from "next/server";
import { generateSpeech, type TTSConfig } from "@/lib/tts";

// TTS 配音试听：返回 mp3 音频字节，供前端预览音色
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, ttsConfig } = body as { text?: string; ttsConfig?: TTSConfig };

    if (!text) {
      return NextResponse.json({ error: "缺少配音文本" }, { status: 400 });
    }
    if (!ttsConfig?.baseUrl || !ttsConfig?.apiKey || !ttsConfig?.model || !ttsConfig?.voice) {
      return NextResponse.json(
        { error: "请先在设置中配置 TTS（baseUrl、apiKey、model、voice）" },
        { status: 400 }
      );
    }

    const audio = await generateSpeech(text, ttsConfig);
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("TTS 失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TTS 失败" },
      { status: 500 }
    );
  }
}
