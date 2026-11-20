/**
 * Paid TTS platform presets (pure data, shared between client and server, no server-only dependencies).
 *
 * Unified "platform" dropdown: OpenAI-compatible / Atlas Cloud / MiniMax / fal.ai.
 * Atlas and fal reuse the API key already entered under the same provider in the "AI Platform" tab;
 * MiniMax has its own separate key (plus an optional GroupId).
 * Each platform provides default baseUrl/model/voice so the UI can conditionally render fields
 * and offer voice suggestions accordingly.
 */

export type TTSProvider = "openai" | "atlas" | "minimax" | "falai" | "kitten";

export interface TTSVoiceOption {
  value: string;
  label: string;
}

export interface TTSProviderMeta {
  value: TTSProvider;
  label: string;
  /** Default baseUrl for this platform's TTS endpoint */
  baseUrl: string;
  /** Default model id */
  defaultModel: string;
  /** Available models (empty means free-form input, e.g. OpenAI-compatible) */
  models: TTSVoiceOption[];
  /** Default voice id */
  defaultVoice: string;
  /** Suggested voice list */
  voices: TTSVoiceOption[];
  /**
   * Key source:
   * - "tts": use the apiKey stored in the TTS config itself (OpenAI-compatible / MiniMax)
   * - others: reuse the apiKey of the matching provider in the "AI Platform" store (atlas-cloud / fal-ai)
   */
  keySource: "tts" | "atlas-cloud" | "fal-ai" | "local";
  /** Whether a GroupId is required (needed for the MiniMax domestic endpoint api.minimax.chat) */
  needsGroupId?: boolean;
  /** Whether to expose a baseUrl input field (OpenAI-compatible and MiniMax support switching regional endpoints) */
  editableBaseUrl?: boolean;
  /** Configuration hint shown in the UI */
  hint?: string;
}

/** OpenAI-compatible quick presets (one click populates baseUrl + model + voice) */
export const OPENAI_TTS_PRESETS = [
  { label: "硅基流动 CosyVoice", baseUrl: "https://api.siliconflow.cn/v1", model: "FunAudioLLM/CosyVoice2-0.5B", voice: "FunAudioLLM/CosyVoice2-0.5B:alex" },
  { label: "OpenAI tts-1", baseUrl: "https://api.openai.com/v1", model: "tts-1", voice: "alloy" },
  { label: "火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-tts", voice: "zh_female_cancan" },
];

export const KITTEN_TTS_URL = "http://127.0.0.1:9882/v1";

export const TTS_PROVIDERS: TTSProviderMeta[] = [
  {
    value: "openai",
    label: "OpenAI 兼容 (/audio/speech)",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "FunAudioLLM/CosyVoice2-0.5B",
    models: [],
    defaultVoice: "FunAudioLLM/CosyVoice2-0.5B:alex",
    voices: [],
    keySource: "tts",
    editableBaseUrl: true,
    hint: "兼容 OpenAI tts-1、硅基流动 CosyVoice、火山方舟等所有 /audio/speech 端点。",
  },
  {
    value: "atlas",
    label: "Atlas Cloud (xAI TTS)",
    baseUrl: "https://api.atlascloud.ai/api/v1",
    defaultModel: "xai/tts-v1",
    models: [{ value: "xai/tts-v1", label: "xAI TTS v1（多语高保真）" }],
    defaultVoice: "eve",
    voices: [
      { value: "eve", label: "Eve · 多语女声（默认）" },
      { value: "leo", label: "Leo · 多语男声" },
      { value: "rex", label: "Rex · 多语男声" },
      { value: "ara", label: "Ara · 多语女声" },
      { value: "sal", label: "Sal · 多语男声" },
    ],
    keySource: "atlas-cloud",
    hint: "复用「AI 平台」里 Atlas Cloud 的 Key（与生图/生视频同一个）。",
  },
  {
    value: "minimax",
    label: "MiniMax 海螺 (T2A v2)",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "speech-2.6-hd",
    models: [
      { value: "speech-2.6-hd", label: "speech-2.6-hd（高保真）" },
      { value: "speech-2.6-turbo", label: "speech-2.6-turbo（快速）" },
      { value: "speech-2.5-hd", label: "speech-2.5-hd" },
    ],
    defaultVoice: "female-tianmei",
    voices: [
      { value: "female-tianmei", label: "甜美女声（默认）" },
      { value: "female-shaonv", label: "少女音" },
      { value: "female-yujie", label: "御姐音" },
      { value: "female-chengshu", label: "成熟女声" },
      { value: "presenter_female", label: "女主持人" },
      { value: "presenter_male", label: "男主持人" },
      { value: "male-qn-qingse", label: "青涩青年（男）" },
      { value: "male-qn-jingying", label: "精英青年（男）" },
      { value: "audiobook_female_1", label: "有声书女声" },
    ],
    keySource: "tts",
    needsGroupId: true,
    editableBaseUrl: true,
    hint: "海螺开放平台的 API Key + GroupId。国际版改 baseUrl 为 https://api.minimax.io/v1（可不填 GroupId）。",
  },
  {
    value: "falai",
    label: "fal.ai (MiniMax Speech-02)",
    baseUrl: "https://queue.fal.run",
    defaultModel: "fal-ai/minimax/speech-02-hd",
    models: [
      { value: "fal-ai/minimax/speech-02-hd", label: "MiniMax Speech-02 HD" },
      { value: "fal-ai/minimax/speech-02-turbo", label: "MiniMax Speech-02 Turbo" },
    ],
    defaultVoice: "Wise_Woman",
    voices: [
      { value: "Wise_Woman", label: "睿智女声（默认）" },
      { value: "Calm_Woman", label: "沉稳女声" },
      { value: "Lively_Girl", label: "活力女声" },
      { value: "Sweet_Girl_2", label: "甜美女声" },
      { value: "Friendly_Person", label: "亲和声线" },
      { value: "Deep_Voice_Man", label: "低沉男声" },
      { value: "Casual_Guy", label: "随性男声" },
      { value: "Patient_Man", label: "沉稳男声" },
    ],
    keySource: "fal-ai",
    hint: "复用「AI 平台」里 fal.ai 的 Key（FAL_KEY）。",
  },
  {
    value: "kitten",
    label: "KittenTTS 2 Mini (CPU)",
    baseUrl: KITTEN_TTS_URL,
    defaultModel: "kitten-tts-2-mini",
    models: [],
    defaultVoice: "fr",
    voices: [{ value: "fr", label: "Français" }, { value: "de", label: "Deutsch" }],
    keySource: "local",
  },
];

export const DEFAULT_TTS_PROVIDER: TTSProvider = "openai";

/** Get platform metadata (with fallback: unknown/legacy config falls back to openai) */
export function getTTSProviderMeta(provider?: string | null): TTSProviderMeta {
  return TTS_PROVIDERS.find((p) => p.value === provider) ?? TTS_PROVIDERS[0];
}

/** Minimal input shape required when resolving TTS config (avoids circular dependency with store types) */
interface TTSSettingLike {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
  speed?: number;
  groupId?: string;
}
type ProvidersLike = Record<string, { apiKey?: string; baseUrl?: string } | undefined>;

/** Fully resolved TTS config used for actual requests / preview playback */
export interface ResolvedTTSConfig {
  provider: TTSProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  speed?: number;
  groupId?: string;
}

/**
 * Resolves the "platform selection + reused AI platform key" into a complete TTS config
 * ready to send to the backend.
 * Atlas/fal keys are taken from the providers store; OpenAI-compatible/MiniMax use the TTS's own key.
 */
export function resolveTTSConfig(tts: TTSSettingLike | undefined, providers: ProvidersLike): ResolvedTTSConfig {
  const meta = getTTSProviderMeta(tts?.provider);
  // baseUrl: for editable platforms use the user-provided value (fall back to default if blank); otherwise force the platform default
  const baseUrl = meta.editableBaseUrl ? (tts?.baseUrl || meta.baseUrl) : meta.baseUrl;
  // apiKey: reuse the AI platform key or use the TTS-specific key
  const apiKey = meta.keySource === "local" ? "" : meta.keySource === "tts" ? (tts?.apiKey || "") : (providers?.[meta.keySource]?.apiKey || "");
  return {
    provider: meta.value,
    baseUrl,
    apiKey,
    model: tts?.model || meta.defaultModel,
    voice: tts?.voice || meta.defaultVoice,
    ...(tts?.speed != null && { speed: tts.speed }),
    ...(meta.value === "minimax" && tts?.groupId ? { groupId: tts.groupId } : {}),
  };
}

/** Whether paid TTS is ready (switch enabled + resolved key/model/voice all present) */
export function isPaidTTSReady(tts: TTSSettingLike | undefined, providers: ProvidersLike): boolean {
  if (!tts?.enabled) return false;
  const c = resolveTTSConfig(tts, providers);
  return hasTTSConfig(c);
}

/** The Kitten adapter accepts local requests without credentials. Other providers retain their key requirement. */
export function hasTTSConfig(config?: TTSSettingLike): boolean {
  if (!config?.baseUrl || !config.model || !config.voice) return false;
  if (config.provider === "kitten") {
    return config.baseUrl === KITTEN_TTS_URL && config.model === "kitten-tts-2-mini" && (config.voice === "fr" || config.voice === "de");
  }
  return Boolean(config.apiKey);
}
