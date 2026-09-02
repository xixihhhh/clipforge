/**
 * Multi-source media engine — shared types, normalized candidates, and utility functions across all stock sources
 *
 * Design: stock sources follow a "search + download" model (unlike the AIProvider's async task-polling model).
 * Each source (Pexels/Pixabay/Openverse…) normalizes its own response into a common StockCandidate,
 * which is then downloaded to data/uploads, recorded in the assets table, and consumed by the composer as an ordinary video/image/audio segment.
 */

/** IDs of integrated stock sources (local = project-bundled B-roll pool; nasa/archive = public-domain archive footage, must be selected explicitly) */
export type StockSourceId =
  | "pexels"
  | "pixabay"
  | "openverse"
  | "wikimedia"
  | "local"
  | "nasa"
  | "archive"
  | "coverr"
  | "jamendo"
  | "freesound";

export type StockMediaType = "video" | "image" | "audio";
export type StockOrientation = "portrait" | "landscape" | "square";

/** Unified media candidate (all sources normalize into this structure) */
export interface StockCandidate {
  source: StockSourceId;
  mediaType: StockMediaType;
  /** Source-internal id (Openverse and others use string ids, so the type is widened to string|number) */
  id: string | number;
  /** Direct URL for the selected quality tier (used for downloading) */
  downloadUrl: string;
  /** Source detail page URL (for compliance attribution) */
  pageUrl: string;
  /** Author name (for attribution) */
  author: string;
  /** Author profile URL */
  authorUrl: string;
  /** License type (varies by source; e.g. "Pexels" / "Pixabay Content License" / "cc-by-2.0") */
  license: string;
  /** Link to the license description (available for CC sources) */
  licenseUrl?: string;
  /** Ready-to-use attribution text (provided by Openverse and others; used directly when exporting credits) */
  attributionText?: string;
  /** Whether attribution is legally required (true for CC BY, BY-SA, etc.) */
  requiresAttribution?: boolean;
  /** Pixel dimensions (absent for audio) */
  width?: number;
  height?: number;
  /** Duration in seconds for video/audio; undefined for images */
  durationSec?: number;
  /** Preview image URL */
  previewImage?: string;
  /** Title / alt text from the source (feeds keyword + semantic matching; absent on some sources) */
  title?: string;
  /** Tag list from the source (feeds keyword + semantic matching) */
  tags?: string[];
}

/** Stock source metadata (used by the frontend to display available sources and whether a key is required) */
export interface StockSourceMeta {
  id: StockSourceId;
  label: string;
  /** Whether the source is fully usable without an API key (critical for zero-config onboarding) */
  keyless: boolean;
  mediaTypes: StockMediaType[];
  /** URL to sign up for a free API key */
  signupUrl?: string;
  /** Environment variable name the server reads the key from */
  envKey?: string;
  /** One-line description */
  note?: string;
  /** Whether this source participates in default aggregate searches (source="all"); defaults to true. Archive sources (two-step retrieval, documentary/scientific content) are set to false and must be selected explicitly to avoid slowing down automatic footage matching */
  aggregate?: boolean;
}

/** Registry of integrated stock sources (used by the frontend to render source selection; keyless sources appear first) */
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
    id: "wikimedia",
    label: "Wikimedia Commons",
    keyless: true,
    mediaTypes: ["image", "video", "audio"],
    signupUrl: "https://commons.wikimedia.org/",
    note: "免 Key，CC/公共领域图片+视频+音频；唯一免 Key 视频源（实拍 B-roll）+ 免费 BGM 来源，直链可下",
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
  {
    id: "coverr",
    label: "Coverr",
    keyless: false,
    mediaTypes: ["video"],
    signupUrl: "https://coverr.co/developers",
    envKey: "COVERR_API_KEY",
    note: "免费 Key（2000 次/时），精选实拍视频、比传统图库少「素材感」；API 内容需署名 Coverr（自动进授权清单）",
  },
  {
    id: "jamendo",
    label: "Jamendo 音乐",
    keyless: false,
    mediaTypes: ["audio"],
    signupUrl: "https://devportal.jamendo.com/",
    envKey: "JAMENDO_CLIENT_ID",
    note: "免费 Key，海量 CC 音乐 BGM；已强制过滤为可商用纯 CC-BY（NC/ND/SA 全排除，署名自动进清单）",
  },
  {
    id: "freesound",
    label: "Freesound 音效",
    keyless: false,
    mediaTypes: ["audio"],
    signupUrl: "https://freesound.org/apiv2/apply/",
    envKey: "FREESOUND_API_KEY",
    note: "免费 Key，50 万+音效库（开箱/按键/环境声）；已强制过滤 CC0/CC-BY 可商用，取 128kbps 高清预览直链",
  },
  {
    id: "local",
    label: "本地素材",
    keyless: true,
    mediaTypes: ["video", "image"],
    note: "用项目里上传的自拍/自有 B-roll 配画面，免网络免 Key",
  },
  {
    id: "nasa",
    label: "NASA 影像库",
    keyless: true,
    mediaTypes: ["video", "image"],
    aggregate: false,
    note: "免 Key，公共领域地球/太空/科学实拍（纪录/科普题材首选），显式选用",
  },
  {
    id: "archive",
    label: "Internet Archive",
    keyless: true,
    mediaTypes: ["video", "image"],
    aggregate: false,
    note: "免 Key，公共领域历史影片/纪录素材（强制 publicdomain 授权可商用），显式选用",
  },
];

/** Maximum download size per file (80 MB) */
export const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;
/** Network request timeout (milliseconds) */
export const REQUEST_TIMEOUT_MS = 30_000;

// ==================== shared pure functions ====================

/** Determine orientation */
export function orientationOf(width: number, height: number): StockOrientation {
  if (height > width) return "portrait";
  if (width > height) return "landscape";
  return "square";
}

/** Filter candidates by duration (images are not filtered) */
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

/** Infer file extension from the URL or response headers; fall back to media-type defaults when nothing can be detected (avoids images/audio being saved as .mp4) */
export function inferExtension(url: string, contentType?: string | null, mediaType?: StockMediaType): string {
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
  if (m?.[1]) return m[1].toLowerCase();
  if (mediaType === "image") return "jpg";
  if (mediaType === "audio") return "mp3";
  return "mp4";
}

// ==================== shared network functions ====================

/** fetch with timeout */
export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Download result */
export interface DownloadResult {
  filePath: string;
  bytes: number;
}

/**
 * Download a direct URL to the specified directory and return save info.
 * Enforces timeout and size limit; the caller is responsible for providing an already-created directory and a file name prefix.
 */
export async function downloadStockFile(
  url: string,
  destDir: string,
  fileBaseName: string,
  mediaType?: StockMediaType
): Promise<DownloadResult> {
  const { writeFile, copyFile, stat } = await import("fs/promises");
  const { isAbsolute, join } = await import("path");
  const { fileURLToPath } = await import("url");

  const safeBaseName = fileBaseName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "file";

  // local media branch: url is an absolute local path or file:// (constructed exclusively by scanLocalMaterials via readdir from the project pool, never user input);
  // copy directly instead of using network fetch (fetch does not support file paths). Size limit is still enforced, consistent with network downloads.
  if (isAbsolute(url) || url.startsWith("file://")) {
    const srcPath = url.startsWith("file://") ? fileURLToPath(url) : url;
    const st = await stat(srcPath);
    if (st.size > MAX_DOWNLOAD_BYTES) throw new Error(`素材体积 ${st.size} 超过上限 ${MAX_DOWNLOAD_BYTES}`);
    const localExt = inferExtension(srcPath, null, mediaType);
    const destPath = join(destDir, `${safeBaseName}.${localExt}`);
    await copyFile(srcPath, destPath);
    return { filePath: destPath, bytes: st.size };
  }

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

  const ext = inferExtension(url, contentType, mediaType);
  // safeBaseName is sanitized at the top of the function (path separators and special characters removed to prevent directory traversal)
  const filePath = join(destDir, `${safeBaseName}.${ext}`);
  // Write-then-rename so a crash mid-write can never leave a half file under the final name —
  // directory scans and caches must only ever see fully-written media.
  const partPath = `${filePath}.part`;
  await writeFile(partPath, buffer);
  const { rename } = await import("fs/promises");
  await rename(partPath, filePath);
  return { filePath, bytes: buffer.byteLength };
}
