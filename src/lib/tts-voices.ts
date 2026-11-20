/**
 * Free Edge TTS voice catalogue — CLIENT-SAFE module (no fs/network imports), so UI code and the
 * variation planner can list voices without dragging the server-only TTS pipeline (edge-tts →
 * tts-cache → fs/promises) into the browser bundle. edge-tts re-exports these for server callers.
 *
 * These are Edge Read Aloud voice IDs;
 * generateSpeechFree already accepts any Edge voice name — this list simply makes voices discoverable.
 */
export const FREE_TTS_VOICES: { value: string; label: string; gender: "female" | "male"; lang: string; labelKey?: string }[] = [
  // Chinese (default market)
  { value: "zh-CN-XiaoxiaoNeural", labelKey: "freeVoiceXiaoxiao", label: "晓晓 · 温柔女声", gender: "female", lang: "zh-CN" },
  { value: "zh-CN-XiaoyiNeural", labelKey: "freeVoiceXiaoyi", label: "晓伊 · 活泼女声", gender: "female", lang: "zh-CN" },
  { value: "zh-CN-YunxiNeural", labelKey: "freeVoiceYunxi", label: "云希 · 阳光男声", gender: "male", lang: "zh-CN" },
  { value: "zh-CN-YunyangNeural", labelKey: "freeVoiceYunyang", label: "云扬 · 专业播报男声", gender: "male", lang: "zh-CN" },
  { value: "zh-CN-YunjianNeural", labelKey: "freeVoiceYunjian", label: "云健 · 沉稳解说男声", gender: "male", lang: "zh-CN" },
  // English (primary overseas market)
  { value: "en-US-AriaNeural", label: "Aria · US English (female)", gender: "female", lang: "en-US" },
  { value: "en-US-GuyNeural", label: "Guy · US English (male)", gender: "male", lang: "en-US" },
  { value: "en-GB-SoniaNeural", label: "Sonia · UK English (female)", gender: "female", lang: "en-GB" },
  // Japanese / Korean markets (bundled Noto CJK subtitle font public/fonts/subtitle.otf covers kana + hangul, so subtitles render correctly)
  { value: "ja-JP-NanamiNeural", label: "Nanami · 日本語 (female)", gender: "female", lang: "ja-JP" },
  { value: "ko-KR-SunHiNeural", label: "SunHi · 한국어 (female)", gender: "female", lang: "ko-KR" },
  // Spanish market (Latin glyphs are covered by the CJK font)
  { value: "es-ES-ElviraNeural", label: "Elvira · Español (female)", gender: "female", lang: "es-ES" },
  { value: "fr-FR-DeniseNeural", label: "Denise · Français", gender: "female", lang: "fr-FR" },
  { value: "de-DE-KatjaNeural", label: "Katja · Deutsch", gender: "female", lang: "de-DE" },
];

export const DEFAULT_FREE_VOICE = "zh-CN-XiaoxiaoNeural";

export const DUB_LANGUAGES = [...new Set(FREE_TTS_VOICES.map((voice) => voice.lang.split("-")[0]))];

export function defaultVoiceForLang(code: string): string | null {
  const locale = (code || "").trim().toLowerCase();
  const language = locale.split("-")[0];
  return (FREE_TTS_VOICES.find((voice) => voice.lang.toLowerCase() === locale) ??
    FREE_TTS_VOICES.find((voice) => voice.lang.split("-")[0] === language))?.value ?? null;
}
