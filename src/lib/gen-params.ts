/**
 * Pure logic layer for image/video generation "custom parameters" + "custom model endpoints"
 * (shared between frontend and backend, no server-only dependencies).
 *
 * - Custom models: users can attach any model id on an existing platform (atlas-cloud / fal-ai / replicate…).
 *   The backend /api/ai/image|video already forwards the model to the provider as-is, so adding one entry
 *   makes it immediately selectable from the dropdown.
 * - Custom parameters: maps global defaults from Settings (aspect ratio / resolution / steps / guidance /
 *   duration / fps / seed / negative prompt) into the ImageOptions/VideoOptions fields that providers understand,
 *   and attaches them to generation request options.
 */

export type GenAspectRatio = "9:16" | "16:9" | "1:1";
export type GenResolution = "720p" | "1080p";
export type GenMediaType = "image" | "video";

/** User-defined custom model (any model id mounted on an existing platform) */
export interface CustomModel {
  /** Locally unique id */
  id: string;
  /** Owning platform identifier (matches the key in settings.providers, e.g. "fal-ai") */
  provider: string;
  /** Real model id (forwarded as-is to the backend / provider) */
  modelId: string;
  /** Display name */
  name: string;
  mediaType: GenMediaType;
  /** Whether the video model natively includes audio (saves TTS for commerce videos) */
  supportsAudio?: boolean;
}

/** Global default parameters for image generation */
export interface ImageGenParams {
  aspectRatio: GenAspectRatio;
  /** Number of images to generate */
  count: number;
  /** Inference steps (leave empty to use the platform default) */
  steps?: number;
  /** Guidance scale (leave empty to use the platform default) */
  guidanceScale?: number;
  /** Random seed (leave empty to randomize each time) */
  seed?: number;
  /** Negative prompt */
  negativePrompt?: string;
}

/** Global default parameters for video generation */
export interface VideoGenParams {
  /** Optional free-form size for OpenAI-compatible video models. */
  openaiSize?: string;
  aspectRatio: GenAspectRatio;
  resolution: GenResolution;
  /** Duration in seconds (leave empty to use the platform default) */
  duration?: number;
  /** Frame rate (leave empty to use the platform default) */
  fps?: number;
  /** Motion strength 0~1 (leave empty to use the platform default) */
  motionStrength?: number;
  /** Random seed (leave empty to randomize each time) */
  seed?: number;
  /** Negative prompt */
  negativePrompt?: string;
}

export const DEFAULT_IMAGE_PARAMS: ImageGenParams = {
  aspectRatio: "9:16",
  count: 1,
};

export const DEFAULT_VIDEO_PARAMS: VideoGenParams = {
  aspectRatio: "9:16",
  // 720p, not 1080p: vertical short video is delivered at phone scale and every platform
  // re-encodes on upload, so the higher tier mostly buys a bigger invoice. Providers price
  // resolution tiers separately, and 1080p is a deliberate opt-in rather than the default.
  resolution: "720p",
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

/** Aspect ratio → image dimensions (portrait commerce mode defaults to higher resolution) */
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

/** Resolution + aspect ratio → video dimensions */
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

/** Maps image parameters to the options object expected by /api/ai/image (field names aligned with ImageOptions) */
export function buildImageOptions(p: ImageGenParams | undefined): Record<string, unknown> {
  const params = p ?? DEFAULT_IMAGE_PARAMS;
  const { width, height } = imageSize(params.aspectRatio);
  const count = finiteInteger(params.count, 1, 1, 15);
  const steps = finiteInteger(params.steps, undefined, 1);
  const guidanceScale = finiteNumber(params.guidanceScale);
  const seed = finiteInteger(params.seed, undefined);
  return {
    width,
    height,
    count,
    ...(steps != null && { steps }),
    ...(guidanceScale != null && { guidanceScale }),
    ...(seed != null && { seed }),
    ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
  };
}

/** Persisted settings can come from older versions or hand-edited local storage. Never send
 * an empty string / NaN where an upstream provider expects an integer or float. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteInteger(value: unknown, fallback?: number, min?: number, max?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return fallback;
  const clampedMin = min == null ? value : Math.max(min, value);
  return max == null ? clampedMin : Math.min(max, clampedMin);
}

/** Maps video parameters to the options object expected by /api/ai/video (field names aligned with VideoOptions) */
export function buildVideoOptions(p: VideoGenParams | undefined): Record<string, unknown> {
  const params = p ?? DEFAULT_VIDEO_PARAMS;
  const { width, height } = videoSize(params.resolution, params.aspectRatio);
  const duration = finiteNumber(params.duration);
  const fps = finiteNumber(params.fps);
  const motionStrength = finiteNumber(params.motionStrength);
  const seed = finiteInteger(params.seed, undefined);
  return {
    ...(params.openaiSize?.trim() && { openaiSize: params.openaiSize.trim() }),
    width,
    height,
    ...(duration != null && { duration }),
    ...(fps != null && { fps }),
    ...(motionStrength != null && { motionStrength }),
    ...(seed != null && { seed }),
    ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
  };
}

/** Map a text-to-image model to its edit / image-to-image variant (product-fidelity redraw with reference images) */
export function toEditVariant(modelId: string): string {
  if (modelId === "openai/gpt-image-2") return "openai/gpt-image-2/image-to-image";
  if (modelId === "fal-ai/gpt-image-1.5") return "fal-ai/gpt-image-1.5/edit";
  // Replicate FLUX text-to-image → Kontext edit model
  if (modelId.startsWith("black-forest-labs/flux") && !modelId.includes("kontext")) {
    return "black-forest-labs/flux-kontext-pro";
  }
  // other models (Seedream / Tongyi Wanxiang, etc.) mostly support reference-image image-to-image natively, keep the original model
  return modelId;
}

/** A resolved generation target: which provider (with key) serves the chosen model */
export interface GenModelTarget {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * Resolve the configured default model to its provider + key by asking
 * /api/ai/models (same flow the assets page uses). Returns null when nothing
 * is configured — callers surface their own "configure a provider" message.
 */
export async function resolveDefaultModelTarget(
  providers: Record<string, { enabled?: boolean; apiKey?: string; baseUrl?: string }>,
  defaultModel: string | undefined,
  customModels: CustomModel[],
  mediaType: GenMediaType
): Promise<GenModelTarget | null> {
  const enabled = Object.entries(providers)
    .filter(([, p]) => p.enabled && p.apiKey)
    .map(([name, p]) => ({ name, apiKey: p.apiKey!, baseUrl: p.baseUrl }));
  if (enabled.length === 0 || !defaultModel) return null;
  try {
    const res = await fetch("/api/ai/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers: enabled, mediaType }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const merged = mergeCustomModels(data.models ?? [], customModels, mediaType, new Set(enabled.map((e) => e.name)));
    const model = merged.find((m) => m.id === defaultModel);
    if (!model) return null;
    const prov = enabled.find((e) => e.name === model.provider);
    return prov ? { provider: prov.name, model: defaultModel, apiKey: prov.apiKey, baseUrl: prov.baseUrl } : null;
  } catch {
    return null;
  }
}

/** Model list entry (a subset of fields aligned with the Model returned by /api/ai/models; mediaType may be omitted for official list items) */
export interface ModelLike {
  id: string;
  name: string;
  provider: string;
  mediaType?: GenMediaType;
  modes?: string[];
  supportsAudio?: boolean;
  /** Marked as user-defined (UI may add a badge / distinguish the source) */
  custom?: boolean;
}

/** Custom model → model list entry (reused by the dropdown and generation logic to resolve the platform Key/baseUrl) */
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
 * Merges custom models into the model list fetched from /api/ai/models (filtered by mediaType, deduplicated).
 * Only retains custom models whose provider is enabled, to avoid selecting a platform with no API key configured.
 * fetched uses a minimal structured type, compatible with the { id, name, provider } shape of official lists everywhere.
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
    // Remove entries whose id already exists in the official list
    .filter((cm) => !fetched.some((m) => m.id === cm.id));
  return [...fetched, ...extras];
}
