/**
 * Openverse 素材源（api.openverse.org，WordPress 维护）—— 多源素材引擎的「免 Key」源
 *
 * 最大价值：检索完全免 Key（匿名即可），覆盖 CC 授权「图片 + 音乐/音效」，是新手零配置首选。
 * 限制：无视频端点；匿名限额 20/min·200/day（量产可选配 OAuth2 token 提额）。
 * 合规：CC 聚合源授权不一，带货=商用，检索强制 license_type=commercial 过滤掉 NC；
 *       归一化保留 license/licenseUrl/attributionText，导出生成 credits。
 */

import { type StockCandidate, fetchWithTimeout } from "./stock-types";

const OPENVERSE_API = "https://api.openverse.org/v1";

// ==================== 原始响应类型 ====================

export interface OpenverseImage {
  id: string;
  title?: string;
  url: string; // 媒体直链/原图
  thumbnail?: string; // 代理缩略图
  creator?: string;
  creator_url?: string;
  foreign_landing_url?: string; // 原站详情页
  license: string; // 如 "by-nc"
  license_version?: string;
  license_url?: string;
  attribution?: string; // 官方已拼好的署名文本
  width?: number;
  height?: number;
}

export interface OpenverseAudio {
  id: string;
  title?: string;
  url: string;
  thumbnail?: string;
  creator?: string;
  creator_url?: string;
  foreign_landing_url?: string;
  license: string;
  license_version?: string;
  license_url?: string;
  attribution?: string;
  duration?: number; // 毫秒
  alt_files?: Array<{ url: string; bit_rate?: number; filetype?: string }>;
}

// ==================== 纯函数（可单测） ====================

/** CC0 / 公共领域标记无需署名；其余（BY 系）需署名 */
export function ccRequiresAttribution(license: string): boolean {
  const l = license.toLowerCase();
  return !(l === "cc0" || l === "pdm");
}

/** 组合 license 显示值，如 "by-2.0" */
export function composeLicense(license: string, version?: string): string {
  return version ? `${license}-${version}` : license;
}

/** 把 Openverse 图片归一化为候选 */
export function toOpenverseImageCandidate(img: OpenverseImage): StockCandidate {
  return {
    source: "openverse",
    mediaType: "image",
    id: img.id,
    downloadUrl: img.url,
    pageUrl: img.foreign_landing_url || img.url,
    author: img.creator || "Unknown",
    authorUrl: img.creator_url || img.foreign_landing_url || "https://openverse.org",
    license: composeLicense(img.license, img.license_version),
    licenseUrl: img.license_url,
    attributionText: img.attribution,
    requiresAttribution: ccRequiresAttribution(img.license),
    width: img.width,
    height: img.height,
    previewImage: img.thumbnail,
  };
}

/** 把 Openverse 音频归一化为候选（取最高码率 alt_files，否则 url；时长毫秒→秒） */
export function toOpenverseAudioCandidate(a: OpenverseAudio): StockCandidate {
  const best =
    (a.alt_files || [])
      .slice()
      .sort((x, y) => (y.bit_rate ?? 0) - (x.bit_rate ?? 0))[0]?.url || a.url;
  return {
    source: "openverse",
    mediaType: "audio",
    id: a.id,
    downloadUrl: best,
    pageUrl: a.foreign_landing_url || a.url,
    author: a.creator || "Unknown",
    authorUrl: a.creator_url || a.foreign_landing_url || "https://openverse.org",
    license: composeLicense(a.license, a.license_version),
    licenseUrl: a.license_url,
    attributionText: a.attribution,
    requiresAttribution: ccRequiresAttribution(a.license),
    durationSec: a.duration != null ? Math.round(a.duration / 1000) : undefined,
    previewImage: a.thumbnail,
  };
}

// ==================== 网络函数 ====================

/** 可选 Bearer token（提额用，非必须） */
function authHeaders(token?: string): HeadersInit {
  const h: Record<string, string> = { "User-Agent": "daihuo-jianshou/1.0 (stock media)" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** 搜索 Openverse 图片（默认只取可商用，过滤 NC） */
export async function searchOpenverseImages(
  query: string,
  opts: { token?: string; perPage?: number; commercialOnly?: boolean } = {}
): Promise<StockCandidate[]> {
  const { token, perPage = 10, commercialOnly = true } = opts;
  if (!query?.trim()) throw new Error("检索词为空");

  const params = new URLSearchParams({
    q: query.trim(),
    page_size: String(perPage),
    mature: "false",
  });
  if (commercialOnly) params.set("license_type", "commercial");

  const res = await fetchWithTimeout(`${OPENVERSE_API}/images/?${params}`, { headers: authHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Openverse 图片检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { results?: OpenverseImage[] };
  return (data.results ?? []).map(toOpenverseImageCandidate);
}

/** 搜索 Openverse 音频（音乐/音效，默认可商用） */
export async function searchOpenverseAudio(
  query: string,
  opts: { token?: string; perPage?: number; commercialOnly?: boolean; category?: "music" | "sound_effect" } = {}
): Promise<StockCandidate[]> {
  const { token, perPage = 10, commercialOnly = true, category } = opts;
  if (!query?.trim()) throw new Error("检索词为空");

  const params = new URLSearchParams({ q: query.trim(), page_size: String(perPage), mature: "false" });
  if (commercialOnly) params.set("license_type", "commercial");
  if (category) params.set("category", category);

  const res = await fetchWithTimeout(`${OPENVERSE_API}/audio/?${params}`, { headers: authHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Openverse 音频检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { results?: OpenverseAudio[] };
  return (data.results ?? []).map(toOpenverseAudioCandidate);
}
