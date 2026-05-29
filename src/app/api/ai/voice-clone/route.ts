// @ts-nocheck
/**
 * 声音克隆 API 路由
 * POST /api/ai/voice-clone - 克隆声音
 * GET  /api/ai/voice-clone - 查询已克隆音色
 */

import { NextRequest, NextResponse } from 'next/server';
import { SiliconFlowVoiceClone } from '@/lib/providers/voice-clone';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { referenceAudioUrl, referenceAudioBase64, voiceName, sampleText, apiKey } = body;

    if (!referenceAudioUrl && !referenceAudioBase64) {
      return NextResponse.json({ error: '请提供参考音频（URL 或 base64）' }, { status: 400 });
    }
    if (!voiceName) {
      return NextResponse.json({ error: '请提供音色名称' }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: '请先配置 API Key' }, { status: 400 });
    }

    const vc = new SiliconFlowVoiceClone({ apiKey });
    const result = await vc.cloneVoice({
      referenceAudioUrl,
      referenceAudioBase64,
      voiceName,
      sampleText,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '声音克隆失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  // 返回 localStorage 中的已克隆音色（前端自行管理）
  return NextResponse.json({ voices: [] });
}
