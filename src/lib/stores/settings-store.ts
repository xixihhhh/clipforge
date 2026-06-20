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
  // 界面语言（中文默认，可切 English）
  locale: Locale;

  // Actions
  setLocale: (locale: Locale) => void;
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

      setLocale: (locale) => set({ locale }),
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
    }),
    {
      name: "daihuo-jianshou-settings",
    }
  )
);
