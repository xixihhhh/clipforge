import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { DEFAULT_TTS_PROVIDER, type TTSProvider } from "@/lib/tts-presets";
import {
  DEFAULT_IMAGE_PARAMS,
  DEFAULT_VIDEO_PARAMS,
  type CustomModel,
  type ImageGenParams,
  type VideoGenParams,
} from "@/lib/gen-params";
import { ATLAS_BASE_URL, ATLAS_ONEKEY_MODELS, fillAtlasModelDefaults } from "@/lib/atlas-onekey";

// AI Provider 配置
export interface ProviderSetting {
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
}

// LLM 配置
export interface LLMSetting {
  provider: string; // 自定义名称
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel?: string; // 视觉分析模型
}

// TTS 配音配置（多平台：OpenAI 兼容 / Atlas / MiniMax / fal.ai）
export interface TTSSetting {
  enabled: boolean;
  /** 平台，缺省 "openai"（旧配置无此字段时按 openai 处理） */
  provider?: TTSProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  speed?: number;
  /** MiniMax 国内端点的 GroupId（可选） */
  groupId?: string;
}

interface SettingsState {
  // AI 平台配置
  providers: Record<string, ProviderSetting>;
  // LLM 配置
  llm: LLMSetting;
  // TTS 配音配置
  tts: TTSSetting;
  // 默认生图模型
  defaultImageModel: string;
  // 默认生视频模型
  defaultVideoModel: string;
  // 默认分辨率
  defaultResolution: "720p" | "1080p";
  // 默认画面比例
  defaultAspectRatio: "9:16" | "16:9" | "1:1";
  // 用户自定义模型（挂在已有平台上的任意 model id）
  customModels: CustomModel[];
  // 图片生成全局默认参数
  imageParams: ImageGenParams;
  // 视频生成全局默认参数
  videoParams: VideoGenParams;
  // 界面语言（首次按系统语言自动判定，可手动切换）
  locale: Locale;
  // 语言来源：auto=跟随系统语言自动判定，user=用户手动选过（不再自动覆盖）
  localeSource: "auto" | "user";

  // Actions
  setLocale: (locale: Locale) => void;
  // 自动判定结果应用（仅在 localeSource==="auto" 时由初始化器调用，不改变 source）
  applyAutoLocale: (locale: Locale) => void;
  setProvider: (name: string, setting: ProviderSetting) => void;
  setLLM: (llm: LLMSetting) => void;
  setTTS: (tts: TTSSetting) => void;
  setDefaultImageModel: (model: string) => void;
  setDefaultVideoModel: (model: string) => void;
  setDefaultResolution: (resolution: "720p" | "1080p") => void;
  setDefaultAspectRatio: (ratio: "9:16" | "16:9" | "1:1") => void;
  addCustomModel: (model: CustomModel) => void;
  removeCustomModel: (id: string) => void;
  setImageParams: (params: ImageGenParams) => void;
  setVideoParams: (params: VideoGenParams) => void;
  /** 一个 Atlas Key 一键接入：脚本+看图+生图+生视频+配音全配好（不覆盖用户已选模型/已开的配音） */
  applyAtlasOneKey: (apiKey: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      providers: {
        "atlas-cloud": { enabled: false, apiKey: "" },
        "fal-ai": { enabled: false, apiKey: "" },
        replicate: { enabled: false, apiKey: "" },
        volcengine: { enabled: false, apiKey: "" },
        alibaba: { enabled: false, apiKey: "" },
        siliconflow: { enabled: false, apiKey: "" },
      },
      llm: {
        provider: "",
        baseUrl: "",
        apiKey: "",
        model: "",
        visionModel: "",
      },
      tts: {
        enabled: false,
        provider: DEFAULT_TTS_PROVIDER,
        baseUrl: "",
        apiKey: "",
        model: "",
        voice: "",
        speed: 1,
      },
      defaultImageModel: "",
      defaultVideoModel: "",
      defaultResolution: "1080p",
      defaultAspectRatio: "9:16",
      customModels: [],
      imageParams: DEFAULT_IMAGE_PARAMS,
      videoParams: DEFAULT_VIDEO_PARAMS,
      locale: DEFAULT_LOCALE,
      localeSource: "auto",

      // 用户手动切换：记为 user，之后不再被自动判定覆盖
      setLocale: (locale) => set({ locale, localeSource: "user" }),
      // 自动判定应用：保持 source=auto，跟随系统语言
      applyAutoLocale: (locale) => set({ locale }),
      setProvider: (name, setting) =>
        set((state) => ({
          providers: { ...state.providers, [name]: setting },
        })),
      setLLM: (llm) => set({ llm }),
      setTTS: (tts) => set({ tts }),
      setDefaultImageModel: (model) => set({ defaultImageModel: model }),
      setDefaultVideoModel: (model) => set({ defaultVideoModel: model }),
      setDefaultResolution: (resolution) => set({ defaultResolution: resolution }),
      setDefaultAspectRatio: (ratio) => set({ defaultAspectRatio: ratio }),
      addCustomModel: (model) =>
        set((state) => ({ customModels: [...state.customModels, model] })),
      removeCustomModel: (id) =>
        set((state) => ({ customModels: state.customModels.filter((m) => m.id !== id) })),
      setImageParams: (params) => set({ imageParams: params }),
      setVideoParams: (params) => set({ videoParams: params }),
      // 一个 Atlas Key 一键接入全套：LLM 脚本 + Vision 看图 + 生图 + 生视频 + Atlas 配音
      applyAtlasOneKey: (apiKey) =>
        set((state) => {
          const key = apiKey.trim();
          const def = fillAtlasModelDefaults({
            image: state.defaultImageModel,
            video: state.defaultVideoModel,
          });
          return {
            llm: {
              provider: "Atlas Cloud",
              baseUrl: ATLAS_BASE_URL,
              apiKey: key,
              model: ATLAS_ONEKEY_MODELS.llm,
              visionModel: ATLAS_ONEKEY_MODELS.vision,
            },
            providers: {
              ...state.providers,
              "atlas-cloud": { ...state.providers["atlas-cloud"], enabled: true, apiKey: key },
            },
            defaultImageModel: def.image,
            defaultVideoModel: def.video,
            // 配音：之前没开过才默认接 Atlas TTS（复用同一个 Key），已配则保持不动
            tts: state.tts.enabled
              ? state.tts
              : { ...state.tts, enabled: true, provider: "atlas", baseUrl: ATLAS_BASE_URL, model: "", voice: "" },
          };
        }),
    }),
    {
      name: "daihuo-jianshou-settings",
      // v1：清洗历史版本预设写入的失效模型名（旧预设填过不存在的模型 ID，"测试连接"只验 Key
      // 不验模型名所以一直显示正常，直到生成脚本才报 Model Not Exist——issue #12 用户即此场景）。
      // 只在 baseUrl 匹配对应官方端点时改写，避免误伤自建代理上的同名自定义模型。
      version: 1,
      migrate: (persisted) => {
        const state = persisted as SettingsState;
        const llm = state?.llm;
        if (llm?.baseUrl) {
          const fixes: Array<{ hostRe: RegExp; from: string; to: string }> = [
            { hostRe: /api\.deepseek\.com/i, from: "deepseek-v3.2", to: "deepseek-v4-flash" },
            { hostRe: /volces\.com/i, from: "doubao-seed-2.0-pro", to: "doubao-seed-2-0-pro-260215" },
          ];
          for (const f of fixes) {
            if (!f.hostRe.test(llm.baseUrl)) continue;
            if (llm.model === f.from) llm.model = f.to;
            if (llm.visionModel === f.from) llm.visionModel = f.to;
          }
        }
        return state;
      },
    }
  )
);
