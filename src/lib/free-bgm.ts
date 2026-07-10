/**
 * Free background music — fetches one commercially-usable CC track from Openverse (keyless CC audio)
 * and downloads it locally for mixing into the final video.
 * Failures do not block composition (returns null). Tracks requiring attribution (CC BY, etc.) return
 * author/license/sourceUrl so the caller can prompt the user to credit them in the finished video.
 */
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getUploadsDir } from "@/lib/paths";
import { searchWikimediaAudio } from "@/lib/providers/wikimedia";
import { downloadStockFile } from "@/lib/providers/stock-types";

export interface FreeBgmResult {
  /** Absolute local path of the downloaded file (passed directly as the composer's bgmPath) */
  localPath: string;
  author: string;
  license: string;
  sourceUrl: string;
}

// Category → BGM mood query: lets beauty/food/tech etc. each pick fitting free CC music instead of all defaulting to the same ambient track.
const CATEGORY_BGM_MOOD: Record<string, string> = {
  beauty: "upbeat fashion pop instrumental",
  food: "warm cozy acoustic background",
  home: "calm relaxing acoustic background",
  fashion: "upbeat trendy pop instrumental",
  digital: "energetic electronic tech background",
  tech: "energetic electronic tech background",
  other: "ambient background music",
};

/** Returns the BGM mood query string for a product category; falls back to generic ambient for unknown/empty values. Pure function, unit-testable. */
export function moodQueryForCategory(category?: string | null): string {
  const key = (category || "").toLowerCase().trim();
  return CATEGORY_BGM_MOOD[key] || "ambient background music";
}

// BGM mood explicitly selected by the user on the video page (none/upbeat/chill/energetic/emotional) → search query.
const MOOD_BGM_QUERY: Record<string, string> = {
  upbeat: "upbeat pop instrumental background",
  chill: "chill lofi calm background",
  energetic: "energetic electronic upbeat background",
  emotional: "emotional cinematic piano background",
};

/** Returns the BGM search query for an explicitly user-selected mood; falls back to generic ambient for unknown/empty (including "none"). Pure function, unit-testable. */
export function moodQueryForMood(mood?: string | null): string {
  const key = (mood || "").toLowerCase().trim();
  return MOOD_BGM_QUERY[key] || "ambient background music";
}

/**
 * Fetches one free CC background music track for the project and downloads it to uploads/<project>/bgm/.
 * Prefers tracks with duration >= 8 s (shorter tracks produce noticeable loop artifacts).
 * Any failure is silently swallowed and returns null — never blocks composition.
 */
export async function fetchFreeBgm(
  projectId: string,
  query = "ambient background music"
): Promise<FreeBgmResult | null> {
  try {
    // Use Wikimedia Commons audio: CC/PD, direct download links from upload.wikimedia.org work without auth
    // (Openverse audio often routes through Freesound, which requires authentication and returns 401).
    const candidates = await searchWikimediaAudio(query, { perPage: 10 });
    // Prefer tracks >= 8 s (shorter ones produce noticeable loop artifacts); try downloading each in order,
    // skip any that fail, and use the first one that succeeds.
    const longEnough = candidates.filter((c) => (c.durationSec ?? 0) >= 8);
    // Fallback still avoids obviously short tracks (2-3s loop audibly): keep unknown-length or >= 6s,
    // and only if that leaves nothing do we accept anything downloadable.
    const notTooShort = candidates.filter((c) => c.durationSec == null || c.durationSec >= 6);
    const pool = (longEnough.length ? longEnough : notTooShort.length ? notTooShort : candidates).filter(
      (c) => c.downloadUrl
    );
    if (pool.length === 0) {
      console.warn(`[bgm] 未检索到可用免费音乐（query=${query}）`);
      return null;
    }
    const bgmDir = join(getUploadsDir(), projectId, "bgm");
    await mkdir(bgmDir, { recursive: true });
    for (const pick of pool) {
      try {
        const { filePath } = await downloadStockFile(pick.downloadUrl, bgmDir, `bgm_${Date.now()}`, "audio");
        // provenance sidecar: the compose route only persists bgmPath, so drop author/license/sourceUrl
        // next to the audio file for the asset-credits manifest to pick up later (best-effort, non-blocking)
        try {
          await writeFile(
            `${filePath}.credit.json`,
            JSON.stringify({ author: pick.author, license: pick.license, sourceUrl: pick.pageUrl }),
            "utf-8"
          );
        } catch {
          /* credits sidecar is optional — never block BGM */
        }
        return { localPath: filePath, author: pick.author, license: pick.license, sourceUrl: pick.pageUrl };
      } catch {
        // This track failed to download (e.g. auth required, 401) → try the next one
      }
    }
    console.warn(`[bgm] 所有候选都下载失败（query=${query}, ${pool.length} 条）`);
    return null;
  } catch (e) {
    console.warn("[bgm] 免费 BGM 获取失败（已跳过，不影响成片）:", e);
    return null;
  }
}
