/**
 * Atlas Cloud "one key covers everything" preset for quick onboarding.
 *
 * Landing-page "try first, configure later" flow: when a beginner has configured no keys at all,
 * pasting a single Atlas key unlocks script generation (LLM) + product-image analysis (Vision)
 * + image gen + video gen + voiceover (TTS) all at once, with models pre-selected automatically.
 * Model IDs are taken from the Atlas official on-sale catalog (verified via official MCP, 2026-06).
 */

export const ATLAS_BASE_URL = "https://api.atlascloud.ai/api/v1";

/**
 * Deep link to the Atlas Cloud API-key console (verified 2026-07: page titled "API Keys - Atlas Cloud";
 * unauthenticated visitors are routed through login/signup and land back on this page).
 * Used by every "get a free key" CTA — deep-linking here instead of the homepage saves beginners
 * from hunting for the key console on their own.
 */
export const ATLAS_KEYS_URL = "https://www.atlascloud.ai/console/api-keys";

export const ATLAS_ONEKEY_MODELS = {
  /** Script (LLM): DeepSeek V3.2 — high cost-efficiency, strong Chinese e-commerce copy */
  llm: "deepseek-ai/deepseek-v3.2",
  /** Product-image analysis (Vision): Qwen VL multimodal */
  vision: "qwen/qwen3-vl-30b-a3b-instruct",
  /** Image generation: GPT Image 2 — excellent product-image quality */
  image: "openai/gpt-image-2/text-to-image",
  /** Video generation: Seedance 2.0 text-to-video (native audio, safe for both text and image workflows) */
  video: "bytedance/seedance-2.0/text-to-video",
} as const;

/** Default image/video gen models: keep user's existing choice; fall back to Atlas defaults only when nothing is configured (never overwrite user settings). */
export function fillAtlasModelDefaults(current: { image?: string; video?: string }): {
  image: string;
  video: string;
} {
  return {
    image: current.image?.trim() ? current.image : ATLAS_ONEKEY_MODELS.image,
    video: current.video?.trim() ? current.video : ATLAS_ONEKEY_MODELS.video,
  };
}
