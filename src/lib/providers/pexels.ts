/**
 * Pexels 素材源 —— 免费可商用版权视频/图片的检索（多源素材引擎的源之一）
 *
 * 通用类型/下载/工具已抽到 ./stock-types，本文件只放 Pexels 特有的检索与清晰度挑选。
 * 鉴权：HTTP 头 `Authorization: <API_KEY>`（无 Bearer 前缀）。免费 Key：https://www.pexels.com/api/
 * 合规：每个候选保留 pageUrl/author/authorUrl，落库到 assets 表，导出时生成 credits。检索词建议英文。
 */

import {
  type StockCandidate,
  type StockOrientation,
  fetchWithTimeout,
  filterByDuration,
  orientationOf,
} from "./stock-types";

// 向后兼容：早期从 ./pexels 引入这些符号的模块（route/test）继续可用
export {
  downloadStockFile,
  filterByDuration,
  orientationOf,
  inferExtension,
} from "./stock-types";
export type { StockCandidate, StockOrientation, DownloadResult } from "./stock-types";

const PEXELS_API = "https://api.pexels.com";

// ==================== Pexels 原始响应类型 ====================

/** Pexels 视频的单个清晰度文件 */
export interface PexelsVideoFile {
  id: number;
  quality: string | null; // "hd" | "sd" | null
  file_type: string; // "video/mp4"
  width: number;
  height: number;
  fps: number;
  link: string;
  size: number; // 字节
}

/** Pexels 视频条目 */
export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number; // 秒
  url: string; // 视频详情页（归属链接）
  image: string; // 预览图
  user: { id: number; name: string; url: string };
  video_files: PexelsVideoFile[];
}

/** Pexels 图片条目 */
export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string; // 图片详情页（归属链接）
  photographer: string;
  photographer_url: string;
  alt: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    portrait: string;
    landscape: string;
    tiny: string;
  };
}

// ==================== 纯函数（可单测） ====================

/**
 * 从一个 Pexels 视频的多个清晰度里挑「最合适」的文件：
 * 1. 只要 mp4；2. 优先目标方向；3. 在满足方向的里挑「短边 >= minShortSide 的最小体积」；
 * 4. 若无达标者，取分辨率最高的一条。纯函数。
 */
export function pickBestVideoFile(
  files: PexelsVideoFile[],
  opts: { orientation?: StockOrientation; minShortSide?: number } = {}
): PexelsVideoFile | null {
  const { orientation = "portrait", minShortSide = 720 } = opts;
  const mp4 = files.filter((f) => f.file_type === "video/mp4" && f.link);
  if (mp4.length === 0) return null;

  const dirMatched = mp4.filter((f) => orientationOf(f.width, f.height) === orientation);
  const pool = dirMatched.length > 0 ? dirMatched : mp4;

  const shortSide = (f: PexelsVideoFile) => Math.min(f.width, f.height);

  const qualified = pool.filter((f) => shortSide(f) >= minShortSide);
  if (qualified.length > 0) {
    return qualified.reduce((best, f) => (f.size < best.size ? f : best));
  }
  return pool.reduce((best, f) => (shortSide(f) > shortSide(best) ? f : best));
}

/** 把一个 Pexels 视频归一化为候选；挑不出文件则返回 null */
export function toVideoCandidate(
  video: PexelsVideo,
  opts: { orientation?: StockOrientation; minShortSide?: number } = {}
): StockCandidate | null {
  const file = pickBestVideoFile(video.video_files, opts);
  if (!file) return null;
  return {
    source: "pexels",
    mediaType: "video",
    id: video.id,
    downloadUrl: file.link,
    pageUrl: video.url,
    author: video.user?.name ?? "Pexels",
    authorUrl: video.user?.url ?? "https://www.pexels.com",
    license: "Pexels",
    width: file.width,
    height: file.height,
    durationSec: video.duration,
    previewImage: video.image,
  };
}

/** 按目标方向挑图片的最佳尺寸链接 */
export function pickPhotoSrc(photo: PexelsPhoto, orientation: StockOrientation): string {
  if (orientation === "portrait") return photo.src.portrait || photo.src.large2x || photo.src.original;
  if (orientation === "landscape") return photo.src.landscape || photo.src.large2x || photo.src.original;
  return photo.src.large2x || photo.src.original;
}

/** 把一个 Pexels 图片归一化为候选 */
export function toPhotoCandidate(photo: PexelsPhoto, orientation: StockOrientation = "portrait"): StockCandidate {
  return {
    source: "pexels",
    mediaType: "image",
    id: photo.id,
    downloadUrl: pickPhotoSrc(photo, orientation),
    pageUrl: photo.url,
    author: photo.photographer ?? "Pexels",
    authorUrl: photo.photographer_url ?? "https://www.pexels.com",
    license: "Pexels",
    width: photo.width,
    height: photo.height,
    previewImage: photo.src?.tiny,
  };
}

// ==================== 网络函数 ====================

/** 搜索 Pexels 视频 */
export async function searchPexelsVideos(
  query: string,
  opts: {
    apiKey: string;
    perPage?: number;
    orientation?: StockOrientation;
    minShortSide?: number;
    minSec?: number;
    maxSec?: number;
  }
): Promise<StockCandidate[]> {
  const { apiKey, perPage = 10, orientation = "portrait", minShortSide, minSec, maxSec } = opts;
  if (!apiKey) throw new Error("缺少 Pexels API Key");
  if (!query?.trim()) throw new Error("检索词为空");

  const params = new URLSearchParams({ query: query.trim(), per_page: String(perPage), orientation });
  const res = await fetchWithTimeout(`${PEXELS_API}/videos/search?${params}`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pexels 视频检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { videos?: PexelsVideo[] };
  const candidates = (data.videos ?? [])
    .map((v) => toVideoCandidate(v, { orientation, minShortSide }))
    .filter((c): c is StockCandidate => c !== null);
  return filterByDuration(candidates, { minSec, maxSec });
}

/** 搜索 Pexels 图片 */
export async function searchPexelsPhotos(
  query: string,
  opts: { apiKey: string; perPage?: number; orientation?: StockOrientation }
): Promise<StockCandidate[]> {
  const { apiKey, perPage = 10, orientation = "portrait" } = opts;
  if (!apiKey) throw new Error("缺少 Pexels API Key");
  if (!query?.trim()) throw new Error("检索词为空");

  const params = new URLSearchParams({ query: query.trim(), per_page: String(perPage), orientation });
  const res = await fetchWithTimeout(`${PEXELS_API}/v1/search?${params}`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pexels 图片检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { photos?: PexelsPhoto[] };
  return (data.photos ?? []).map((p) => toPhotoCandidate(p, orientation));
}
