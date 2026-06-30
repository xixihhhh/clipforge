/**
 * NASA 图像/视频库素材源 —— images.nasa.gov 公共领域影像（地球/太空/科学实拍），免 Key。
 *
 * 两步取材：search 返回条目列表 + 预览图；每条的 collection.json 再列出真实可下载文件（挑 mp4/大图）。
 * NASA 影像绝大多数为公共领域（少数含标识/可辨识人物有限制），作 B-roll 用足够；署名建议保留 "NASA"。
 */

import { fetchWithTimeout, type StockCandidate, type StockMediaType } from "./stock-types";

const NASA_SEARCH = "https://images-api.nasa.gov/search";

/** 从 collection.json 的文件 URL 列表挑一个合适的 mp4（中等清晰度，避开 ~orig.mov），并升级到 https。纯函数。 */
export function pickNasaVideoUrl(urls: string[]): string | null {
  const mp4 = urls.filter((u) => u.toLowerCase().endsWith(".mp4"));
  const byTag = (tag: string) => mp4.find((u) => u.includes(`~${tag}.mp4`));
  const pick = byTag("medium") || byTag("large") || byTag("mobile") || byTag("small") || mp4[0] || null;
  return pick ? pick.replace(/^http:/, "https:") : null;
}

/** 从 collection.json 的文件 URL 列表挑一张合适大小的图片，并升级到 https。纯函数。 */
export function pickNasaImageUrl(urls: string[]): string | null {
  const img = urls.filter((u) => /\.(jpe?g|png)$/i.test(u));
  const byTag = (tag: string) => img.find((u) => u.includes(`~${tag}.`));
  const pick = byTag("large") || byTag("medium") || byTag("orig") || img[0] || null;
  return pick ? pick.replace(/^http:/, "https:") : null;
}

interface NasaSearchOptions {
  perPage?: number;
}

async function searchNasa(query: string, mediaType: Extract<StockMediaType, "video" | "image">, opts: NasaSearchOptions = {}): Promise<StockCandidate[]> {
  const perPage = Math.max(1, Math.min(12, opts.perPage ?? 6));
  let items: unknown[];
  try {
    const res = await fetchWithTimeout(`${NASA_SEARCH}?q=${encodeURIComponent(query)}&media_type=${mediaType}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { collection?: { items?: unknown[] } };
    items = (data.collection?.items ?? []).slice(0, perPage);
  } catch {
    return [];
  }

  const settled = await Promise.allSettled(
    items.map(async (raw): Promise<StockCandidate | null> => {
      const it = raw as { href?: string; data?: Array<Record<string, unknown>>; links?: Array<Record<string, unknown>> };
      if (typeof it.href !== "string") return null;
      const d = it.data?.[0] ?? {};
      const link = it.links?.[0] ?? {};
      const assetRes = await fetchWithTimeout(it.href);
      if (!assetRes.ok) return null;
      const urls = (await assetRes.json()) as string[];
      if (!Array.isArray(urls)) return null;
      const downloadUrl = mediaType === "video" ? pickNasaVideoUrl(urls) : pickNasaImageUrl(urls);
      if (!downloadUrl) return null;
      const nasaId = typeof d.nasa_id === "string" ? d.nasa_id : "";
      return {
        source: "nasa",
        mediaType,
        id: nasaId,
        downloadUrl,
        pageUrl: nasaId ? `https://images.nasa.gov/details-${nasaId}` : "",
        author: typeof d.center === "string" && d.center ? `NASA / ${d.center}` : "NASA",
        authorUrl: "https://www.nasa.gov",
        license: "Public Domain (NASA)",
        requiresAttribution: false,
        width: Number(link.width) || undefined,
        height: Number(link.height) || undefined,
        previewImage: typeof link.href === "string" ? link.href : undefined,
      };
    }),
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<StockCandidate> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);
}

export function searchNasaVideos(query: string, opts: NasaSearchOptions = {}): Promise<StockCandidate[]> {
  return searchNasa(query, "video", opts);
}
export function searchNasaImages(query: string, opts: NasaSearchOptions = {}): Promise<StockCandidate[]> {
  return searchNasa(query, "image", opts);
}
