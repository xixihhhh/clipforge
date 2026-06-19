/**
 * Pixabay 素材源（pixabay.com/api）—— 多源素材引擎里同时覆盖「视频 + 图片」的免费源
 *
 * 鉴权：query 参数 ?key=<API_KEY>（图片/视频共用一个 key）。免费 Key：https://pixabay.com/api/docs/
 * 限额：100 请求/60s，强制结果缓存 24h；禁图片永久热链（必须下载缓存，与现有 Pexels 流程一致）。
 * 注意：视频端点无 orientation 参数（竖屏需靠 width/height 自筛）；per_page 下限是 3；tags 是逗号分隔字符串。
 */

import { type StockCandidate, type StockOrientation, fetchWithTimeout, orientationOf } from "./stock-types";

const PIXABAY_API = "https://pixabay.com/api";
const LICENSE = "Pixabay Content License";

// ==================== 原始响应类型 ====================

export interface PixabayImageHit {
  id: number;
  pageURL: string;
  tags: string;
  previewURL: string;
  webformatURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
  user_id: number;
}

export interface PixabayVideoFile {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail?: string;
}

export interface PixabayVideoHit {
  id: number;
  pageURL: string;
  tags: string;
  duration: number; // 秒
  videos: {
    large?: PixabayVideoFile;
    medium?: PixabayVideoFile;
    small?: PixabayVideoFile;
    tiny?: PixabayVideoFile;
  };
  user: string;
  user_id: number;
}

// ==================== 纯函数（可单测） ====================

/** 拼作者主页 URL */
export function pixabayAuthorUrl(user: string, userId: number): string {
  return `https://pixabay.com/users/${user}-${userId}/`;
}

/**
 * 从一个 Pixabay 视频的四档清晰度里挑文件：
 * 过滤掉 url 为空/size=0 的档；优先「短边 >= minShortSide 的最小体积」，无达标则取最高分辨率。
 * 纯函数。
 */
export function pickPixabayVideoFile(
  videos: PixabayVideoHit["videos"],
  opts: { minShortSide?: number } = {}
): PixabayVideoFile | null {
  const { minShortSide = 720 } = opts;
  const pool = [videos.large, videos.medium, videos.small, videos.tiny].filter(
    (f): f is PixabayVideoFile => !!f && !!f.url && f.size > 0
  );
  if (pool.length === 0) return null;

  const shortSide = (f: PixabayVideoFile) => Math.min(f.width, f.height);
  const qualified = pool.filter((f) => shortSide(f) >= minShortSide);
  if (qualified.length > 0) return qualified.reduce((best, f) => (f.size < best.size ? f : best));
  return pool.reduce((best, f) => (shortSide(f) > shortSide(best) ? f : best));
}

/** 把一个 Pixabay 视频归一化为候选；挑不出文件则 null */
export function toPixabayVideoCandidate(
  hit: PixabayVideoHit,
  opts: { minShortSide?: number } = {}
): StockCandidate | null {
  const file = pickPixabayVideoFile(hit.videos, opts);
  if (!file) return null;
  // 追加 ?download=1 触发下载（Pixabay 文档建议）
  const dl = file.url.includes("?") ? file.url : `${file.url}?download=1`;
  return {
    source: "pixabay",
    mediaType: "video",
    id: hit.id,
    downloadUrl: dl,
    pageUrl: hit.pageURL,
    author: hit.user || "Pixabay",
    authorUrl: pixabayAuthorUrl(hit.user, hit.user_id),
    license: LICENSE,
    requiresAttribution: false, // 礼节性署名，非强制
    width: file.width,
    height: file.height,
    durationSec: hit.duration,
    previewImage: file.thumbnail,
  };
}

/** 把一个 Pixabay 图片归一化为候选（普通 key 最大可拿 largeImageURL 1280px） */
export function toPixabayImageCandidate(hit: PixabayImageHit): StockCandidate {
  return {
    source: "pixabay",
    mediaType: "image",
    id: hit.id,
    downloadUrl: hit.largeImageURL,
    pageUrl: hit.pageURL,
    author: hit.user || "Pixabay",
    authorUrl: pixabayAuthorUrl(hit.user, hit.user_id),
    license: LICENSE,
    requiresAttribution: false,
    width: hit.imageWidth,
    height: hit.imageHeight,
    previewImage: hit.webformatURL || hit.previewURL,
  };
}

// ==================== 网络函数 ====================

/** clamp per_page 到 Pixabay 合法区间 [3,200] */
function clampPerPage(n: number): number {
  return Math.max(3, Math.min(200, Math.floor(n)));
}

/** 搜索 Pixabay 视频（无 orientation 参数，竖屏靠 width/height 过滤） */
export async function searchPixabayVideos(
  query: string,
  opts: {
    apiKey: string;
    perPage?: number;
    minShortSide?: number;
    orientation?: StockOrientation;
    minSec?: number;
    maxSec?: number;
  }
): Promise<StockCandidate[]> {
  const { apiKey, perPage = 10, minShortSide, orientation, minSec, maxSec } = opts;
  if (!apiKey) throw new Error("缺少 Pixabay API Key");
  if (!query?.trim()) throw new Error("检索词为空");

  const params = new URLSearchParams({
    key: apiKey,
    q: query.trim(),
    per_page: String(clampPerPage(perPage)),
    safesearch: "true",
  });
  const res = await fetchWithTimeout(`${PIXABAY_API}/videos/?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pixabay 视频检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { hits?: PixabayVideoHit[] };
  let candidates = (data.hits ?? [])
    .map((h) => toPixabayVideoCandidate(h, { minShortSide }))
    .filter((c): c is StockCandidate => c !== null);

  if (orientation) {
    candidates = candidates.filter((c) => orientationOf(c.width ?? 1, c.height ?? 1) === orientation);
  }
  if (minSec != null) candidates = candidates.filter((c) => (c.durationSec ?? 0) >= minSec);
  if (maxSec != null) candidates = candidates.filter((c) => (c.durationSec ?? 0) <= maxSec);
  return candidates;
}

/** 搜索 Pixabay 图片 */
export async function searchPixabayImages(
  query: string,
  opts: { apiKey: string; perPage?: number; orientation?: StockOrientation }
): Promise<StockCandidate[]> {
  const { apiKey, perPage = 10, orientation = "portrait" } = opts;
  if (!apiKey) throw new Error("缺少 Pixabay API Key");
  if (!query?.trim()) throw new Error("检索词为空");

  const pixOrientation = orientation === "portrait" ? "vertical" : orientation === "landscape" ? "horizontal" : "all";
  const params = new URLSearchParams({
    key: apiKey,
    q: query.trim(),
    per_page: String(clampPerPage(perPage)),
    image_type: "photo",
    orientation: pixOrientation,
    safesearch: "true",
  });
  const res = await fetchWithTimeout(`${PIXABAY_API}/?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pixabay 图片检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { hits?: PixabayImageHit[] };
  return (data.hits ?? []).map(toPixabayImageCandidate);
}
