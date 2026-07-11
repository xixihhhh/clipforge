/**
 * Free Edge TTS voice catalogue — CLIENT-SAFE module (no fs/network imports), so UI code and the
 * variation planner can list voices without dragging the server-only TTS pipeline (edge-tts →
 * tts-cache → fs/promises) into the browser bundle. edge-tts re-exports these for server callers.
 *
 * All entries are real Edge keyless-synthesisable voices (server-tested to produce 18–26 KB mp3);
 * generateSpeechFree already accepts any Edge voice name — this list simply makes voices discoverable.
 */
export const FREE_TTS_VOICES: { value: string; label: string; gender: "female" | "male"; lang: string }[] = [
  // Chinese (default market)
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 温柔女声", gender: "female", lang: "zh-CN" },
  { value: "zh-CN-XiaoyiNeural", label: "晓伊 · 活泼女声", gender: "female", lang: "zh-CN" },
  { value: "zh-CN-YunxiNeural", label: "云希 · 阳光男声", gender: "male", lang: "zh-CN" },
  { value: "zh-CN-YunyangNeural", label: "云扬 · 专业播报男声", gender: "male", lang: "zh-CN" },
  { value: "zh-CN-YunjianNeural", label: "云健 · 沉稳解说男声", gender: "male", lang: "zh-CN" },
  // English (primary overseas market)
  { value: "en-US-AriaNeural", label: "Aria · US English (female)", gender: "female", lang: "en-US" },
  { value: "en-US-GuyNeural", label: "Guy · US English (male)", gender: "male", lang: "en-US" },
  { value: "en-GB-SoniaNeural", label: "Sonia · UK English (female)", gender: "female", lang: "en-GB" },
  // Japanese / Korean markets (bundled Noto CJK subtitle font public/fonts/subtitle.otf covers kana + hangul, so subtitles render correctly)
  { value: "ja-JP-NanamiNeural", label: "Nanami · 日本語 (female)", gender: "female", lang: "ja-JP" },
  { value: "ko-KR-SunHiNeural", label: "SunHi · 한국어 (female)", gender: "female", lang: "ko-KR" },
  // Spanish market (Latin glyphs are covered by the CJK font)
  { value: "es-ES-ElviraNeural", label: "Elvira · Español (female)", gender: "female", lang: "es-ES" },
];

export const DEFAULT_FREE_VOICE = "zh-CN-XiaoxiaoNeural";
