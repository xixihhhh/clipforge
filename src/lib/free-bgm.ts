/**
 * 免费背景音乐 —— 从 Openverse（keyless CC 音频）取一条可商用音乐下载到本地，供合成时混入。
 * 失败不阻塞合成（返回 null）。CC BY 等需署名：返回 author/license/sourceUrl，由调用方告知用户在成片署名。
 */
import { mkdir } from "fs/promises";
import { join } from "path";
import { getUploadsDir } from "@/lib/paths";
import { searchWikimediaAudio } from "@/lib/providers/wikimedia";
import { downloadStockFile } from "@/lib/providers/stock-types";

export interface FreeBgmResult {
  /** 下载到本地的绝对路径（直接作为 composer 的 bgmPath） */
  localPath: string;
  author: string;
  license: string;
  sourceUrl: string;
}

// 品类 → 配乐情绪检索词：让美妆/美食/数码等各取贴合的免费 CC 音乐，而非全都同一条 ambient。
const CATEGORY_BGM_MOOD: Record<string, string> = {
  beauty: "upbeat fashion pop instrumental",
  food: "warm cozy acoustic background",
  home: "calm relaxing acoustic background",
  fashion: "upbeat trendy pop instrumental",
  digital: "energetic electronic tech background",
  tech: "energetic electronic tech background",
  other: "ambient background music",
};

/** 由商品品类得到配乐情绪检索词；未知/空回退通用 ambient。纯函数可单测。 */
export function moodQueryForCategory(category?: string | null): string {
  const key = (category || "").toLowerCase().trim();
  return CATEGORY_BGM_MOOD[key] || "ambient background music";
}

// 用户在视频页显式选的配乐情绪（none/upbeat/chill/energetic/emotional）→ 检索词。
const MOOD_BGM_QUERY: Record<string, string> = {
  upbeat: "upbeat pop instrumental background",
  chill: "chill lofi calm background",
  energetic: "energetic electronic upbeat background",
  emotional: "emotional cinematic piano background",
};

/** 由用户显式选择的配乐情绪得到检索词；未知/空（含 none）回退通用 ambient。纯函数可单测。 */
export function moodQueryForMood(mood?: string | null): string {
  const key = (mood || "").toLowerCase().trim();
  return MOOD_BGM_QUERY[key] || "ambient background music";
}

/**
 * 为项目取一条免费 CC 背景音乐并下载到 uploads/<project>/bgm/。
 * 偏好时长 ≥ 8s 的曲目（太短循环噪点大）。任何失败都吞掉返回 null，绝不阻塞合成。
 */
export async function fetchFreeBgm(
  projectId: string,
  query = "ambient background music"
): Promise<FreeBgmResult | null> {
  try {
    // 用 Wikimedia Commons 音频：CC/PD、upload.wikimedia.org 直链可下（Openverse 音频多走 Freesound 需鉴权会 401）。
    const candidates = await searchWikimediaAudio(query, { perPage: 10 });
    // 偏好 ≥8s 的曲目（太短循环噪点大）；逐条尝试下载，跳过失败的，取第一条能下到的。
    const longEnough = candidates.filter((c) => (c.durationSec ?? 0) >= 8);
    const pool = (longEnough.length ? longEnough : candidates).filter((c) => c.downloadUrl);
    if (pool.length === 0) {
      console.warn(`[bgm] 未检索到可用免费音乐（query=${query}）`);
      return null;
    }
    const bgmDir = join(getUploadsDir(), projectId, "bgm");
    await mkdir(bgmDir, { recursive: true });
    for (const pick of pool) {
      try {
        const { filePath } = await downloadStockFile(pick.downloadUrl, bgmDir, `bgm_${Date.now()}`, "audio");
        return { localPath: filePath, author: pick.author, license: pick.license, sourceUrl: pick.pageUrl };
      } catch {
        // 该曲目下载失败（如需鉴权 401）→ 试下一条
      }
    }
    console.warn(`[bgm] 所有候选都下载失败（query=${query}, ${pool.length} 条）`);
    return null;
  } catch (e) {
    console.warn("[bgm] 免费 BGM 获取失败（已跳过，不影响成片）:", e);
    return null;
  }
}
