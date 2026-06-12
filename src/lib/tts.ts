/**
 * TTS 配音（OpenAI 兼容 /audio/speech 协议）
 * 兼容 OpenAI(tts-1)、硅基流动(CosyVoice)、火山方舟等所有 OpenAI 风格 TTS 端点。
 */

export interface TTSConfig {
  /** OpenAI 兼容 baseUrl，如 https://api.siliconflow.cn/v1 */
  baseUrl: string;
  apiKey: string;
  /** 模型 ID，如 tts-1 / FunAudioLLM/CosyVoice2-0.5B */
  model: string;
  /** 音色，如 alloy / FunAudioLLM/CosyVoice2-0.5B:alex */
  voice: string;
  /** 语速，0.25~4.0，默认 1 */
  speed?: number;
}

/**
 * 生成配音音频。
 * @returns mp3 音频字节
 */
export async function generateSpeech(text: string, config: TTSConfig): Promise<Buffer> {
  const base = config.baseUrl.replace(/\/$/, "");
  const url = `${base}/audio/speech`;
  const resp = await fetch(url, {
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

  const arrayBuf = await resp.arrayBuffer();
  return Buffer.from(arrayBuf);
}
