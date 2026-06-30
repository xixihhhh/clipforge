/**
 * Internet Archive 素材源 —— archive.org 公共领域影像（历史影片/纪录/实拍），免 Key。
 *
 * 两步取材：advancedsearch 检索（强制 licenseurl 含 publicdomain，确保可商用）+ 取 identifier；
 * 每条 /metadata/{id} 列出文件 → 挑 mp4/图片，下载走 archive.org/download/{id}/{file}。
 */

import { fetchWithTimeout, type StockCandidate, type StockMediaType } from "./stock-types";

const ARCHIVE_SEARCH = "https://archive.org/advancedsearch.php";

interface ArchiveFile {
  name?: string;
  format?: string;
  width?: string | number;
  height?: string | number;
}

/** 从 metadata.files 里挑一个可用文件（视频优先带宽高的 mp4 派生，图片优先非缩略 jpg/png）。纯函数。 */
export function pickArchiveFile(files: ArchiveFile[], mediaType: Extract<StockMediaType, "video" | "image">): ArchiveFile | null {
  const named = files.filter((f) => typeof f.name === "string" && f.name);
  if (mediaType === "video") {
    const vids = named.filter((f) => /\.(mp4|webm|m4v)$/i.test(f.name as string));
    return vids.find((f) => f.width && f.height) || vids[0] || null;
  }
  const imgs = named.filter((f) => /\.(jpe?g|png)$/i.test(f.name as string) && !/(thumb|__ia_thumb)/i.test(f.name as string));
  return imgs.find((f) => f.width && f.height) || imgs[0] || null;
}

/** 构造 archive 下载直链（文件名按段编码，保留路径分隔）。纯函数。 */
export function archiveDownloadUrl(identifier: string, name: string): string {
  const file = name
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${file}`;
}

interface ArchiveSearchOptions {
  perPage?: number;
}

async function searchArchive(query: string, mediaType: Extract<StockMediaType, "video" | "image">, opts: ArchiveSearchOptions = {}): Promise<StockCandidate[]> {
  const perPage = Math.max(1, Math.min(12, opts.perPage ?? 6));
  const mt = mediaType === "video" ? "movies" : "image";
  // 强制 publicdomain 授权，避免拉到授权不明/NC 的上传
  const q = `(${query}) AND mediatype:${mt} AND licenseurl:*publicdomain*`;
  const url = `${ARCHIVE_SEARCH}?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${perPage}&output=json`;

  let docs: Array<Record<string, unknown>>;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { response?: { docs?: Array<Record<string, unknown>> } };
    docs = data.response?.docs ?? [];
  } catch {
    return [];
  }

  const settled = await Promise.allSettled(
    docs.map(async (doc): Promise<StockCandidate | null> => {
      const id = typeof doc.identifier === "string" ? doc.identifier : "";
      if (!id) return null;
      const metaRes = await fetchWithTimeout(`https://archive.org/metadata/${encodeURIComponent(id)}`);
      if (!metaRes.ok) return null;
      const meta = (await metaRes.json()) as { files?: ArchiveFile[] };
      const file = pickArchiveFile(meta.files ?? [], mediaType);
      if (!file?.name) return null;
      const creator = Array.isArray(doc.creator) ? doc.creator[0] : doc.creator;
      return {
        source: "archive",
        mediaType,
        id,
        downloadUrl: archiveDownloadUrl(id, file.name),
        pageUrl: `https://archive.org/details/${id}`,
        author: typeof creator === "string" && creator ? creator : "Internet Archive",
        authorUrl: `https://archive.org/details/${id}`,
        license: "Public Domain",
        requiresAttribution: false,
        width: Number(file.width) || undefined,
        height: Number(file.height) || undefined,
        previewImage: `https://archive.org/services/img/${id}`,
      };
    }),
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<StockCandidate> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);
}

export function searchArchiveVideos(query: string, opts: ArchiveSearchOptions = {}): Promise<StockCandidate[]> {
  return searchArchive(query, "video", opts);
}
export function searchArchiveImages(query: string, opts: ArchiveSearchOptions = {}): Promise<StockCandidate[]> {
  return searchArchive(query, "image", opts);
}
