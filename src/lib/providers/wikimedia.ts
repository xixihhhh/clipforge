/**
 * Wikimedia Commons 素材源（commons.wikimedia.org/w/api.php）—— 多源素材引擎的「免 Key」源
 *
 * 最大价值：检索完全免 Key，覆盖 CC/公共领域的「图片 + 视频」，是目前**唯一免 Key 的视频源**——
 *           没有 Pexels/Pixabay Key 也能给分镜配实拍 B-roll（webm/ogv）。
 * 合规：Commons 全为自由许可，但具体授权不一（PD / CC0 / CC-BY / CC-BY-SA…）；
 *       归一化保留 license/licenseUrl，BY 系标记 requiresAttribution，导出生成 credits。
 * 注意：Wikimedia API 要求带描述性 User-Agent，否则可能被拒。
 */

import { type StockCandidate, type StockMediaType, fetchWithTimeout } from "./stock-types";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "clipforge/1.0 (https://github.com/xixihhhh/clipforge; stock media search)";

// ==================== 原始响应类型 ====================

interface CommonsExtMeta {
  LicenseShortName?: { value?: string };
  LicenseUrl?: { value?: string };
  Artist?: { value?: string };
}
export interface CommonsImageInfo {
  url?: string; // 文件直链
  thumburl?: string; // 缩略图（设了 iiurlwidth 才有）
  width?: number;
  height?: number;
  mime?: string;
  duration?: number; // 视频/音频时长（秒）
  user?: string; // 上传者
  extmetadata?: CommonsExtMeta;
}
export interface CommonsPage {
  pageid: number;
  title: string; // 形如 "File:Foo.webm"
  imageinfo?: CommonsImageInfo[];
}

// ==================== 纯函数（可单测） ====================

/** 去掉 Wikimedia 字段里常见的 HTML 标签（Artist/License 常带 <a>） */
export function stripHtml(s?: string): string {
  return (s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** 公共领域 / CC0 无需署名；其余（BY/BY-SA 等）需署名 */
export function wikimediaRequiresAttribution(licenseShort?: string): boolean {
  const l = (licenseShort ?? "").toLowerCase();
  return !(l.includes("public domain") || l.includes("pd-") || l === "cc0" || l.includes("cc0"));
}

/** 把 Commons 文件页归一化为候选；无直链则返回 null */
export function toWikimediaCandidate(page: CommonsPage, requested: StockMediaType): StockCandidate | null {
  const ii = page.imageinfo?.[0];
  if (!ii?.url) return null;
  const ext = ii.extmetadata ?? {};
  const license = stripHtml(ext.LicenseShortName?.value) || "Unknown";
  const isVideo = /^video\//.test(ii.mime ?? "") || requested === "video";
  const commonsPageUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`;
  return {
    source: "wikimedia",
    mediaType: isVideo ? "video" : "image",
    id: page.pageid,
    downloadUrl: ii.url,
    pageUrl: commonsPageUrl,
    author: stripHtml(ext.Artist?.value) || ii.user || "Unknown",
    authorUrl: commonsPageUrl,
    license,
    licenseUrl: ext.LicenseUrl?.value,
    requiresAttribution: wikimediaRequiresAttribution(license),
    width: ii.width,
    height: ii.height,
    durationSec: ii.duration != null ? Math.round(ii.duration) : undefined,
    previewImage: ii.thumburl,
  };
}

// ==================== 网络函数 ====================

/** 检索 Commons 媒体：generator=search + namespace=6(File)；filetype 过滤图片/视频 */
async function searchWikimedia(
  query: string,
  mediaType: StockMediaType,
  opts: { perPage?: number } = {}
): Promise<StockCandidate[]> {
  if (!query?.trim()) throw new Error("检索词为空");
  const { perPage = 10 } = opts;
  // Commons 全文检索支持 filetype:bitmap / filetype:video 缩小媒体类型
  const filetype = mediaType === "video" ? "filetype:video" : "filetype:bitmap";
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query.trim()} ${filetype}`,
    gsrnamespace: "6",
    gsrlimit: String(perPage),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata|user",
    iiurlwidth: "640",
  });

  const res = await fetchWithTimeout(`${COMMONS_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Wikimedia 检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = data.query?.pages ? Object.values(data.query.pages) : [];
  return pages
    .map((p) => toWikimediaCandidate(p, mediaType))
    .filter((c): c is StockCandidate => c !== null);
}

/** 检索 Commons 图片（CC/PD） */
export function searchWikimediaImages(query: string, opts: { perPage?: number } = {}): Promise<StockCandidate[]> {
  return searchWikimedia(query, "image", opts);
}

/** 检索 Commons 视频（webm/ogv，免 Key 的实拍 B-roll） */
export function searchWikimediaVideos(query: string, opts: { perPage?: number } = {}): Promise<StockCandidate[]> {
  return searchWikimedia(query, "video", opts);
}
