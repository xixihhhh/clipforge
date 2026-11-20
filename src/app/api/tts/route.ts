import { NextRequest, NextResponse } from "next/server";
import { generateSpeech, type TTSConfig } from "@/lib/tts";
import { hasTTSConfig } from "@/lib/tts-presets";
import { apiError, errText } from "@/lib/api-error";

// TTS voice preview: return mp3 audio bytes for the frontend to preview a voice
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, ttsConfig } = body as { text?: string; ttsConfig?: TTSConfig };

    if (!text) {
      return apiError(req, "缺少配音文本", "Missing voiceover text");
    }
    if (!ttsConfig || !hasTTSConfig(ttsConfig)) {
      return apiError(
        req,
        "请先在设置中配置 TTS（baseUrl、apiKey、model、voice）",
        "Please configure TTS in settings first (baseUrl, apiKey, model, voice)"
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
    console.error("TTS failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "TTS 失败", "TTS failed") },
      { status: 500 }
    );
  }
}
