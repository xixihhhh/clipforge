/**
 * Final video specs for each e-commerce platform — single source of truth for multi-platform export (re-encode to target aspect ratio).
 * Douyin / Kuaishou / TikTok Shop / Instagram Reels / YouTube Shorts use 9:16 portrait; Xiaohongshu prefers 3:4. Pure data + accessor, unit-testable.
 * Overseas short-video destinations (reels/shorts) share TikTok's 9:16 1080×1920 spec — same pixels, but exposed as named
 * export targets so a creator cross-posting one clip to TikTok + Reels + Shorts (the 2026 standard) gets correctly-labeled files.
 */

export interface PlatformSpec {
  name: string;
  w: number;
  h: number;
  ratio: string;
}

export const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  douyin: { name: "抖音", w: 1080, h: 1920, ratio: "9:16" },
  kuaishou: { name: "快手", w: 1080, h: 1920, ratio: "9:16" },
  xiaohongshu: { name: "小红书", w: 1080, h: 1440, ratio: "3:4" },
  shipinhao: { name: "视频号", w: 1080, h: 1920, ratio: "9:16" },
  tiktok: { name: "TikTok Shop", w: 1080, h: 1920, ratio: "9:16" },
  reels: { name: "Instagram Reels", w: 1080, h: 1920, ratio: "9:16" },
  shorts: { name: "YouTube Shorts", w: 1080, h: 1920, ratio: "9:16" },
};

/** Get the spec for a given platform; returns undefined for unknown platforms. */
export function getPlatformSpec(platform: string): PlatformSpec | undefined {
  return PLATFORM_SPECS[platform];
}
