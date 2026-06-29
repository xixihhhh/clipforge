/**
 * 本地素材源 —— 把项目 uploads/{id}/materials/ 里用户自带的视频/图片当作素材候选，
 * 对标 an open-source short-video tool 的 `a local source local files
 * 让「用自拍/自有 B-roll 配画面」无需任何网络与 Key；目录由服务端按项目 ID 拼出，文件名来自 readdir（非用户输入）。
 */

import { readdir } from "fs/promises";
import { join, extname, basename } from "path";
import type { StockCandidate, StockMediaType } from "./stock-types";

/** 可入素材池的扩展名（与 composer 消费侧一致） */
export const LOCAL_VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);
export const LOCAL_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);

/** 文件名 → 媒体类型（仅识别白名单扩展名，其余忽略）。纯函数，可单测。 */
export function classifyMaterial(fileName: string): StockMediaType | null {
  const ext = extname(fileName).slice(1).toLowerCase();
  if (LOCAL_VIDEO_EXT.has(ext)) return "video";
  if (LOCAL_IMAGE_EXT.has(ext)) return "image";
  return null;
}

/**
 * 文件名与检索词的相关度打分（纯函数）：把两者按非字/数字符切词，求 token 交集数。
 * 例：filename "kitchen_pour_over.mp4" + query "pour over coffee" → 命中 pour/over = 2。
 */
export function scoreByFilename(fileName: string, query: string): number {
  const toks = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9一-鿿]+/)
        .filter((w) => w.length >= 2),
    );
  const fileToks = toks(basename(fileName, extname(fileName)));
  const qToks = toks(query);
  let hits = 0;
  for (const q of qToks) if (fileToks.has(q)) hits++;
  return hits;
}

/** 本地素材文件 → 统一候选（downloadUrl = 绝对路径，downloadStockFile 按本地复制处理） */
function toCandidate(absPath: string, name: string, mediaType: StockMediaType): StockCandidate {
  return {
    source: "local",
    mediaType,
    id: name,
    downloadUrl: absPath, // 绝对路径，非网络 URL
    pageUrl: "",
    author: "本地素材",
    authorUrl: "",
    license: "本地/自有",
    requiresAttribution: false,
  };
}

/**
 * 扫描本地素材池目录，按媒体类型过滤、按文件名与检索词相关度排序，返回候选。
 * 目录不存在/为空时返回 []（让聚合检索照常走其它源，不报错）。video 请求也允许 image 兜底；audio 本地不支持。
 */
export async function scanLocalMaterials(
  dir: string,
  query: string,
  opts: { mediaType?: StockMediaType; perPage?: number } = {},
): Promise<StockCandidate[]> {
  const wantType = opts.mediaType ?? "video";
  if (wantType === "audio") return [];

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // 目录不存在
  }

  const ranked = names
    .map((name) => ({ name, mt: classifyMaterial(name) }))
    .filter((x): x is { name: string; mt: StockMediaType } => x.mt !== null)
    .map((x) => ({ ...x, typeMatch: x.mt === wantType ? 0 : 1, score: scoreByFilename(x.name, query) }))
    .sort((a, b) => a.typeMatch - b.typeMatch || b.score - a.score || a.name.localeCompare(b.name))
    .map((x) => toCandidate(join(dir, x.name), x.name, x.mt));

  return opts.perPage ? ranked.slice(0, opts.perPage) : ranked;
}
