/**
 * 多源素材引擎 —— 跨素材源的统一类型、归一化候选与共享工具
 *
 * 设计：素材源是"检索 + 下载"模型（不同于 AIProvider 的异步 task 轮询）。
 * 各源（Pexels/Pixabay/Openverse…）把自家响应归一化为同一个 StockCandidate，
 * 然后统一下载到 data/uploads 落 assets 表，被 composer 当普通 video/image/audio 片段消费。
 */

/** 已接入的素材源 id */
export type StockSourceId = "pexels" | "pixabay" | "openverse";

export type StockMediaType = "video" | "image" | "audio";
export type StockOrientation = "portrait" | "landscape" | "square";

/** 统一的素材候选（各源都归一到这个结构） */
export interface StockCandidate {
  source: StockSourceId;
  mediaType: StockMediaType;
  /** 源内 id（Openverse 等用字符串 id，故放宽为 string|number） */
  id: string | number;
  /** 选中清晰度的直链（下载用） */
  downloadUrl: string;
  /** 来源详情页 URL（合规归属） */
  pageUrl: string;
  /** 作者名（署名） */
  author: string;
  /** 作者主页 */
  authorUrl: string;
  /** 授权类型（各源不同，故为字符串，如 "Pexels"/"Pixabay Content License"/"cc-by-2.0"） */
  license: string;
  /** 授权说明链接（CC 源有） */
  licenseUrl?: string;
  /** 现成署名文本（Openverse 等提供，直接用于导出 credits） */
  attributionText?: string;
  /** 是否强制署名（CC BY/BY-SA 等为 true） */
  requiresAttribution?: boolean;
  /** 像素宽高（音频无） */
  width?: number;
  height?: number;
  /** 视频/音频时长（秒）；图片为 undefined */
  durationSec?: number;
  /** 预览图 */
  previewImage?: string;
}

/** 素材源元信息（供前端展示可用源、是否需 Key） */
export interface StockSourceMeta {
  id: StockSourceId;
  label: string;
  /** 是否完全免 Key 可用（对新手零配置极重要） */
  keyless: boolean;
  mediaTypes: StockMediaType[];
  /** 免费 Key 申请页 */
  signupUrl?: string;
  /** 服务端读取 Key 的环境变量名 */
  envKey?: string;
  /** 一句话说明 */
  note?: string;
}

/** 已接入素材源注册表（前端据此渲染源选择，keyless 排前） */
export const STOCK_SOURCES: StockSourceMeta[] = [
  {
    id: "openverse",
    label: "Openverse",
    keyless: true,
    mediaTypes: ["image", "audio"],
    signupUrl: "https://api.openverse.org/",
    envKey: "OPENVERSE_TOKEN",
    note: "免 Key 即可用，CC 授权图片+音乐/音效，新手零配置首选（无视频）",
  },
  {
    id: "pexels",
    label: "Pexels",
    keyless: false,
    mediaTypes: ["video", "image"],
    signupUrl: "https://www.pexels.com/api/",
    envKey: "PEXELS_API_KEY",
    note: "免费 Key，高质量可商用视频+图片",
  },
  {
    id: "pixabay",
    label: "Pixabay",
    keyless: false,
    mediaTypes: ["video", "image"],
    signupUrl: "https://pixabay.com/api/docs/",
    envKey: "PIXABAY_API_KEY",
    note: "免费 Key，视频+图片，带货实拍主力补充源",
  },
];

/** 单次下载体积上限（80MB） */
export const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;
/** 网络请求超时（毫秒） */
export const REQUEST_TIMEOUT_MS = 30_000;

// ==================== 共享纯函数 ====================

/** 判断方向 */
export function orientationOf(width: number, height: number): StockOrientation {
  if (height > width) return "portrait";
  if (width > height) return "landscape";
  return "square";
}

/** 按时长过滤候选（图片不过滤） */
export function filterByDuration(
  candidates: StockCandidate[],
  opts: { minSec?: number; maxSec?: number } = {}
): StockCandidate[] {
  const { minSec, maxSec } = opts;
  return candidates.filter((c) => {
    if (c.durationSec == null) return true;
    if (minSec != null && c.durationSec < minSec) return false;
    if (maxSec != null && c.durationSec > maxSec) return false;
    return true;
  });
}

/** 从直链/响应推断文件扩展名 */
export function inferExtension(url: string, contentType?: string | null): string {
  const ctMap: Record<string, string> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
  };
  if (contentType && ctMap[contentType.split(";")[0].trim()]) {
    return ctMap[contentType.split(";")[0].trim()];
  }
  const m = url.split("?")[0].match(/\.([a-zA-Z0-9]{2,4})$/);
  return (m?.[1] || "mp4").toLowerCase();
}

// ==================== 共享网络函数 ====================

/** 带超时的 fetch */
export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 下载结果 */
export interface DownloadResult {
  filePath: string;
  bytes: number;
}

/**
 * 下载一个直链到指定目录，返回保存信息。
 * 带超时与体积上限；调用方负责传入已 mkdir 的目录与文件名前缀。
 */
export async function downloadStockFile(
  url: string,
  destDir: string,
  fileBaseName: string
): Promise<DownloadResult> {
  const { writeFile } = await import("fs/promises");
  const { join } = await import("path");

  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`素材下载失败 ${res.status}: ${url}`);

  const contentType = res.headers.get("content-type");
  const declaredLen = Number(res.headers.get("content-length") || 0);
  if (declaredLen && declaredLen > MAX_DOWNLOAD_BYTES) {
    throw new Error(`素材体积 ${declaredLen} 超过上限 ${MAX_DOWNLOAD_BYTES}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`素材体积 ${buffer.byteLength} 超过上限 ${MAX_DOWNLOAD_BYTES}`);
  }

  const ext = inferExtension(url, contentType);
  const filePath = join(destDir, `${fileBaseName}.${ext}`);
  await writeFile(filePath, buffer);
  return { filePath, bytes: buffer.byteLength };
}
