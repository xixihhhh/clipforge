/**
 * 多源素材引擎 —— 注册表与统一检索分发
 *
 * 对外暴露：
 *  - searchStock(sourceId, query, opts)：单源检索
 *  - searchAllStock(query, opts)：聚合检索（keyless 源始终参与，需 Key 的源缺 Key 自动跳过）
 *  - resolveSourceKey / getAvailableSources：Key 解析与可用源判断
 */

import {
  STOCK_SOURCES,
  orientationOf,
  type StockCandidate,
  type StockSourceId,
  type StockMediaType,
  type StockOrientation,
  type StockSourceMeta,
} from "./stock-types";
import { searchPexelsVideos, searchPexelsPhotos } from "./pexels";
import { searchPixabayVideos, searchPixabayImages } from "./pixabay";
import { searchOpenverseImages, searchOpenverseAudio } from "./openverse";
import { searchWikimediaImages, searchWikimediaVideos, searchWikimediaAudio } from "./wikimedia";
import { TtlCache } from "@/lib/ttl-cache";

export interface StockSearchOptions {
  /** 各源 Key：{ pexels: "...", pixabay: "..." }；openverse 可选 token */
  apiKeys?: Partial<Record<StockSourceId, string>>;
  mediaType?: StockMediaType; // 默认 video
  perPage?: number;
  orientation?: StockOrientation;
  minSec?: number;
  maxSec?: number;
}

/** 从 opts 或环境变量解析某源的 Key（keyless 源返回空串即可） */
export function resolveSourceKey(sourceId: StockSourceId, apiKeys?: Partial<Record<StockSourceId, string>>): string {
  const fromOpts = apiKeys?.[sourceId];
  if (fromOpts) return fromOpts;
  const meta = STOCK_SOURCES.find((s) => s.id === sourceId);
  if (meta?.envKey && process.env[meta.envKey]) return process.env[meta.envKey] as string;
  return "";
}

/** 某源在当前 Key 情况下是否可用（keyless 始终可用） */
export function isSourceAvailable(meta: StockSourceMeta, apiKeys?: Partial<Record<StockSourceId, string>>): boolean {
  return meta.keyless || !!resolveSourceKey(meta.id, apiKeys);
}

/** 列出当前可用的源（keyless 排前） */
export function getAvailableSources(apiKeys?: Partial<Record<StockSourceId, string>>): StockSourceMeta[] {
  return STOCK_SOURCES.filter((s) => isSourceAvailable(s, apiKeys));
}

/** 单源检索：按 mediaType 调用对应源的检索函数 */
export async function searchStock(
  sourceId: StockSourceId,
  query: string,
  opts: StockSearchOptions = {}
): Promise<StockCandidate[]> {
  const { mediaType = "video", perPage, orientation, minSec, maxSec } = opts;
  const key = resolveSourceKey(sourceId, opts.apiKeys);

  switch (sourceId) {
    case "pexels":
      if (mediaType === "image") return searchPexelsPhotos(query, { apiKey: key, perPage, orientation });
      if (mediaType === "audio") return [];
      return searchPexelsVideos(query, { apiKey: key, perPage, orientation, minSec, maxSec });

    case "pixabay":
      if (mediaType === "image") return searchPixabayImages(query, { apiKey: key, perPage, orientation });
      if (mediaType === "audio") return [];
      return searchPixabayVideos(query, { apiKey: key, perPage, orientation, minSec, maxSec });

    case "openverse":
      // Openverse 无视频；请求视频时回退到图片，让"无商品成片"仍有画面
      if (mediaType === "audio") return searchOpenverseAudio(query, { token: key || undefined, perPage });
      return searchOpenverseImages(query, { token: key || undefined, perPage });

    case "wikimedia":
      // Commons 免 Key 的图片+视频+音频源（唯一免 Key 视频；音频直链可下，免 Key BGM 来源）
      if (mediaType === "audio") return searchWikimediaAudio(query, { perPage });
      if (mediaType === "image") return searchWikimediaImages(query, { perPage });
      return searchWikimediaVideos(query, { perPage });

    default:
      return [];
  }
}

export interface AggregateResult {
  candidates: StockCandidate[];
  /** 因缺 Key 被跳过的源 id */
  skippedSources: StockSourceId[];
  /** 检索出错的源 id（不阻塞其余） */
  erroredSources: StockSourceId[];
}

/**
 * 聚合检索：对所有支持该 mediaType 且可用的源并发检索，合并候选。
 * keyless 源优先排序；单源失败不影响其余（Promise.allSettled）。
 */
/** 聚合检索结果缓存：批量配画面逐镜检索时，语义相近的检索词会重复打各源 API（还撞 Pixabay/Openverse 限流）。 */
const stockCache = new TtlCache<AggregateResult>(5 * 60 * 1000, 64);

/** 缓存键：影响检索结果的参数 + 实际参与的源（源由 apiKeys 决定，故纳入键）。导出便于单测。 */
export function stockCacheKey(query: string, opts: StockSearchOptions, sourceIds: string[]): string {
  const { mediaType = "video", orientation, perPage, minSec, maxSec } = opts;
  return [mediaType, orientation || "", perPage || "", minSec || "", maxSec || "", sourceIds.slice().sort().join(","), query.trim().toLowerCase()].join("|");
}

export async function searchAllStock(query: string, opts: StockSearchOptions = {}): Promise<AggregateResult> {
  const { mediaType = "video" } = opts;
  const skippedSources: StockSourceId[] = [];
  const erroredSources: StockSourceId[] = [];

  // 选出支持该 mediaType 的源（openverse 视频请求时也参与——它会回退图片）
  const usable = STOCK_SOURCES.filter((s) => {
    const supports = s.mediaTypes.includes(mediaType) || (s.id === "openverse" && mediaType === "video");
    if (!supports) return false;
    if (!isSourceAvailable(s, opts.apiKeys)) {
      skippedSources.push(s.id);
      return false;
    }
    return true;
  });

  // 命中缓存直接复用候选池（同 query+参数+可用源，5 分钟内）
  const ck = stockCacheKey(query, opts, usable.map((s) => s.id));
  const cached = stockCache.get(ck);
  if (cached) return cached;

  const settled = await Promise.allSettled(usable.map((s) => searchStock(s.id, query, opts)));

  const merged: StockCandidate[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") merged.push(...r.value);
    else erroredSources.push(usable[i].id);
  });

  const result = { candidates: rankStockCandidates(merged, mediaType, opts.orientation), skippedSources, erroredSources };
  // 只缓存有结果的（空结果多半是瞬时失败/无命中，缓存会挡住重试与「永远有素材」兜底）
  if (result.candidates.length > 0) stockCache.set(ck, result);
  return result;
}

/**
 * 聚合候选排序（纯函数，可单测）。优先级：
 * ① 命中请求媒体类型（真视频 > Openverse 回退图片，避免「要视频却拿到静态图」）
 * ② keyless 源优先 ③ 朝向匹配（竖屏短视频偏好竖向素材，少裁切/黑边）④ 短边分辨率高者
 */
export function rankStockCandidates(
  candidates: StockCandidate[],
  mediaType: StockMediaType,
  orientation?: StockOrientation
): StockCandidate[] {
  const keylessIds = new Set(STOCK_SOURCES.filter((s) => s.keyless).map((s) => s.id));
  const matchesOrientation = (c: StockCandidate) =>
    orientation && c.width && c.height ? orientationOf(c.width, c.height) === orientation : false;
  return candidates.slice().sort((a, b) => {
    const am = a.mediaType === mediaType ? 0 : 1;
    const bm = b.mediaType === mediaType ? 0 : 1;
    if (am !== bm) return am - bm;
    const ak = keylessIds.has(a.source) ? 0 : 1;
    const bk = keylessIds.has(b.source) ? 0 : 1;
    if (ak !== bk) return ak - bk;
    if (orientation) {
      const ao = matchesOrientation(a) ? 0 : 1;
      const bo = matchesOrientation(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
    }
    const aShort = Math.min(a.width ?? 0, a.height ?? 0);
    const bShort = Math.min(b.width ?? 0, b.height ?? 0);
    return bShort - aShort;
  });
}
