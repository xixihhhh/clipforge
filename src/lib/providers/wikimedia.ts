/**
 * Wikimedia Commons 素材源（commons.wikimedia.org/w/api.php）—— 多源素材引擎的「免 Key」源
 *
 * 最大价值：检索完全免 Key，覆盖 CC/公共领域的「图片 + 视频」，是目前**唯一免 Key 的视频源**——
 *           没有 Pexels/Pixabay Key 也能给分镜配实拍 B-roll。
 * 视频取转码版：Commons 原始视频多为大体积 .ogv(theora)，优先取 ≤720p 的 .webm(vp9) 转码——
 *           更小（稳过 80MB 下载上限）、更标准（FFmpeg/合成更友好）。
 * 合规：Commons 全为自由许可，但具体授权不一（PD / CC0 / CC-BY / CC-BY-SA…）；
 *           归一化保留 license/licenseUrl，BY 系标记 requiresAttribution，导出生成 credits。
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
/** 视频转码版（TimedMediaHandler derivatives） */
export interface CommonsDerivative {
  src?: string;
  type?: string;
  transcodekey?: string; // 如 "480p.vp9.webm"
  width?: number;
  height?: number;
}
export interface CommonsMediaInfo {
  url?: string; // 原始文件直链
  thumburl?: string; // 缩略图/海报（设了 *urlwidth 才有）
  width?: number;
  height?: number;
  mime?: string;
  duration?: number; // 视频/音频时长（秒）
  user?: string; // 上传者
  extmetadata?: CommonsExtMeta;
  derivatives?: CommonsDerivative[]; // 视频转码版（videoinfo 才有）
}
export interface CommonsPage {
  pageid: number;
  title: string; // 形如 "File:Foo.ogv"
  imageinfo?: CommonsMediaInfo[];
  videoinfo?: CommonsMediaInfo[];
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

/** 取 derivative 高度：优先 height 字段，否则从 transcodekey 的「480p」解析 */
export function derivativeHeight(d: CommonsDerivative): number {
  if (typeof d.height === "number") return d.height;
  const m = /(\d+)p/.exec(d.transcodekey ?? "");
  return m ? parseInt(m[1], 10) : 0;
}

/** 视频优先选 ≤720p 的最高 webm(vp9) 转码；无 webm 转码则回退原始直链 */
export function pickWikimediaVideoSrc(derivatives: CommonsDerivative[] | undefined, fallbackUrl: string): string {
  const webm = (derivatives ?? []).filter((d) => d.src && /webm/i.test(`${d.transcodekey ?? ""} ${d.type ?? ""}`));
  if (!webm.length) return fallbackUrl;
  const byHeightAsc = webm.slice().sort((a, b) => derivativeHeight(a) - derivativeHeight(b));
  const best = [...byHeightAsc].reverse().find((d) => derivativeHeight(d) <= 720) ?? byHeightAsc[0];
  return best.src ?? fallbackUrl;
}

/** 把 Commons 文件页归一化为候选；无直链则返回 null。视频取 ≤720p webm 转码做下载源 */
export function toWikimediaCandidate(page: CommonsPage, requested: StockMediaType): StockCandidate | null {
  const ii = page.imageinfo?.[0] ?? page.videoinfo?.[0];
  if (!ii?.url) return null;
  const ext = ii.extmetadata ?? {};
  const license = stripHtml(ext.LicenseShortName?.value) || "Unknown";
  const isVideo = requested === "video" || /^video\//.test(ii.mime ?? "");
  const downloadUrl = isVideo ? pickWikimediaVideoSrc(ii.derivatives, ii.url) : ii.url;
  // 视频但没有 ≤720p webm 转码（回退到原始 .ogv 等）→ 跳过：体积大、FFmpeg/浏览器播放不友好，
  // 且静态文件路由不识别其 MIME（octet-stream 不可播）。让该分镜改由其它源/图片兜底。
  if (isVideo && !/\.webm(\?|$)/i.test(downloadUrl)) return null;
  const commonsPageUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`;
  return {
    source: "wikimedia",
    mediaType: isVideo ? "video" : "image",
    id: page.pageid,
    downloadUrl,
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

/** 检索 Commons 媒体：generator=search + namespace=6(File)；视频用 videoinfo 取转码版 */
async function searchWikimedia(
  query: string,
  mediaType: StockMediaType,
  opts: { perPage?: number } = {}
): Promise<StockCandidate[]> {
  if (!query?.trim()) throw new Error("检索词为空");
  const { perPage = 10 } = opts;
  const isVideo = mediaType === "video";
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query.trim()} ${isVideo ? "filetype:video" : "filetype:bitmap"}`,
    gsrnamespace: "6",
    gsrlimit: String(perPage),
  });
  if (isVideo) {
    // videoinfo 比 imageinfo 多 derivatives（转码版）
    params.set("prop", "videoinfo");
    params.set("viprop", "url|size|mime|extmetadata|user|derivatives");
    params.set("viurlwidth", "640");
  } else {
    params.set("prop", "imageinfo");
    params.set("iiprop", "url|size|mime|extmetadata|user");
    params.set("iiurlwidth", "640");
  }

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

/** 检索 Commons 视频（取 ≤720p webm 转码，免 Key 的实拍 B-roll） */
export function searchWikimediaVideos(query: string, opts: { perPage?: number } = {}): Promise<StockCandidate[]> {
  return searchWikimedia(query, "video", opts);
}
