/**
 * 图/视频生成的「自定义参数」+「自定义模型接入点」纯逻辑层（前后端通用，无 server-only 依赖）。
 *
 * - 自定义模型：用户在已有平台（atlas-cloud / fal-ai / replicate…）上挂任意 model id，
 *   后端 /api/ai/image|video 本就把 model 透传给 provider，所以加一条就能立刻在下拉里选用。
 * - 自定义参数：把设置里的全局默认（比例/分辨率/步数/引导/时长/帧率/种子/反向词）映射成
 *   provider 认识的 ImageOptions/VideoOptions 字段，由生成请求的 options 带上。
 */

export type GenAspectRatio = "9:16" | "16:9" | "1:1";
export type GenResolution = "720p" | "1080p";
export type GenMediaType = "image" | "video";

/** 用户自定义模型（挂在某个已有平台上的任意 model id） */
export interface CustomModel {
  /** 本地唯一 id */
  id: string;
  /** 归属平台标识（与 settings.providers 的 key 一致，如 "fal-ai"） */
  provider: string;
  /** 真实 model id（透传给后端 / provider） */
  modelId: string;
  /** 显示名 */
  name: string;
  mediaType: GenMediaType;
  /** 视频模型是否原生带音频（带货可省 TTS） */
  supportsAudio?: boolean;
}

/** 图片生成全局默认参数 */
export interface ImageGenParams {
  aspectRatio: GenAspectRatio;
  /** 生成数量 */
  count: number;
  /** 推理步数（留空=用平台默认） */
  steps?: number;
  /** 引导系数（留空=用平台默认） */
  guidanceScale?: number;
  /** 随机种子（留空=每次随机） */
  seed?: number;
  /** 反向提示词 */
  negativePrompt?: string;
}

/** 视频生成全局默认参数 */
export interface VideoGenParams {
  aspectRatio: GenAspectRatio;
  resolution: GenResolution;
  /** 时长（秒，留空=用平台默认） */
  duration?: number;
  /** 帧率（留空=用平台默认） */
  fps?: number;
  /** 运动强度 0~1（留空=用平台默认） */
  motionStrength?: number;
  /** 随机种子（留空=每次随机） */
  seed?: number;
  /** 反向提示词 */
  negativePrompt?: string;
}

export const DEFAULT_IMAGE_PARAMS: ImageGenParams = {
  aspectRatio: "9:16",
  count: 1,
};

export const DEFAULT_VIDEO_PARAMS: VideoGenParams = {
  aspectRatio: "9:16",
  resolution: "1080p",
  duration: 5,
};

export const ASPECT_RATIO_OPTIONS: { value: GenAspectRatio; label: string }[] = [
  { value: "9:16", label: "9:16 竖屏" },
  { value: "16:9", label: "16:9 横屏" },
  { value: "1:1", label: "1:1 方形" },
];

export const RESOLUTION_OPTIONS: { value: GenResolution; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];

/** 比例 → 图片宽高（竖屏带货默认更高分辨率） */
export function imageSize(aspect: GenAspectRatio): { width: number; height: number } {
  switch (aspect) {
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1024, height: 1024 };
    case "9:16":
    default:
      return { width: 1080, height: 1920 };
  }
}

/** 分辨率 + 比例 → 视频宽高 */
export function videoSize(resolution: GenResolution, aspect: GenAspectRatio): { width: number; height: number } {
  const long = resolution === "1080p" ? 1920 : 1280;
  const short = resolution === "1080p" ? 1080 : 720;
  switch (aspect) {
    case "16:9":
      return { width: long, height: short };
    case "1:1":
      return { width: short, height: short };
    case "9:16":
    default:
      return { width: short, height: long };
  }
}

/** 把图片参数映射成 /api/ai/image 的 options（字段名对齐 ImageOptions） */
export function buildImageOptions(p: ImageGenParams | undefined): Record<string, unknown> {
  const params = p ?? DEFAULT_IMAGE_PARAMS;
  const { width, height } = imageSize(params.aspectRatio);
  return {
    width,
    height,
    count: params.count ?? 1,
    ...(params.steps != null && { steps: params.steps }),
    ...(params.guidanceScale != null && { guidanceScale: params.guidanceScale }),
    ...(params.seed != null && { seed: params.seed }),
    ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
  };
}

/** 把视频参数映射成 /api/ai/video 的 options（字段名对齐 VideoOptions） */
export function buildVideoOptions(p: VideoGenParams | undefined): Record<string, unknown> {
  const params = p ?? DEFAULT_VIDEO_PARAMS;
  const { width, height } = videoSize(params.resolution, params.aspectRatio);
  return {
    width,
    height,
    ...(params.duration != null && { duration: params.duration }),
    ...(params.fps != null && { fps: params.fps }),
    ...(params.motionStrength != null && { motionStrength: params.motionStrength }),
    ...(params.seed != null && { seed: params.seed }),
    ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
  };
}

/** 模型列表项（与 /api/ai/models 返回的 Model 字段对齐的子集；mediaType 对官方列表项可缺省） */
export interface ModelLike {
  id: string;
  name: string;
  provider: string;
  mediaType?: GenMediaType;
  modes?: string[];
  supportsAudio?: boolean;
  /** 标记为用户自定义（UI 可加徽标 / 区分来源） */
  custom?: boolean;
}

/** 自定义模型 → 模型列表项（供下拉与生成解析复用平台 Key/baseUrl） */
export function customModelToModelLike(cm: CustomModel): ModelLike {
  return {
    id: cm.modelId,
    name: cm.name,
    provider: cm.provider,
    mediaType: cm.mediaType,
    modes: cm.mediaType === "image" ? ["text-to-image", "image-to-image"] : ["text-to-video", "image-to-video"],
    supportsAudio: cm.supportsAudio,
    custom: true,
  };
}

/**
 * 把自定义模型并入从 /api/ai/models 拉到的模型列表（按 mediaType 过滤、去重）。
 * 仅保留 provider 已启用的自定义模型，避免选了没 Key 的平台。
 * fetched 用结构化最小类型，兼容各处 { id, name, provider } 形态的官方列表。
 */
export function mergeCustomModels(
  fetched: ReadonlyArray<{ id: string; name: string; provider: string }>,
  customModels: CustomModel[] | undefined,
  mediaType: GenMediaType,
  enabledProviders?: Set<string>
): ModelLike[] {
  const extras = (customModels ?? [])
    .filter((cm) => cm.mediaType === mediaType)
    .filter((cm) => !enabledProviders || enabledProviders.has(cm.provider))
    .map(customModelToModelLike)
    // 去掉与官方列表 id 重复的
    .filter((cm) => !fetched.some((m) => m.id === cm.id));
  return [...fetched, ...extras];
}
