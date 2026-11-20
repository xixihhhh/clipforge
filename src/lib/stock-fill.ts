import { writableShot, sameShot } from "@/lib/shot-ownership";
/**
 * Auto-fill stock footage for each shot — fetch one clip/image from a free stock library
 * using the shot's English search keywords, then download and persist it as stock_footage.
 * Reuses the multi-source stock engine + broadenQuery "always-has-results" fallback;
 * this is the core of the "script → auto-matched assets" pipeline.
 *
 * Split into search (searchShotCandidates) and persist (persistCandidate) phases so the
 * semantic-rerank path can gather every shot's candidates first, pick with ONE batched LLM
 * call, then persist — while fillShotStock keeps the original single-shot heuristic flow.
 */
import { mkdir } from "fs/promises";
import { join, basename } from "path";
import { getUploadsDir } from "@/lib/paths";
import { downloadStockFile, orientationOf, type StockSourceId } from "@/lib/providers/stock-types";
import { searchStock, searchAllStock, type StockSearchOptions } from "@/lib/providers/stock-registry";
import { broadenQuery, pickBestCandidate, authorKeyOf, fallbackLevelOf, type FallbackLevel } from "@/lib/stock-matcher";
import { validateOrDelete } from "@/lib/media-validate";
import { getDb } from "@/lib/db";
import { assets as assetsTable } from "@/lib/db/schema";

export interface FillShotInput {
  scriptId: string;
  projectId: string;
  shotId: number;
  /** Search query (typically shot.stockKeywords joined, falls back to description) */
  query: string;
  source: StockSourceId | "all";
  searchOpts: StockSearchOptions;
  /** IDs of stock items already used (deduplication across shots to avoid the same image repeating throughout the video); maintained and passed in by the caller */
  usedIds?: Set<string>;
  /** Author keys already picked by shots of the same entity group (material continuity: prefer same-source footage); maintained and passed in by the caller */
  sameSourceAuthors?: Set<string>;
  /** The shot's slot length in seconds — long-enough videos get a scoring bonus (freeze-frame prevention) */
  slotSec?: number;
  /** English topic anchor for the broaden ladder (tried before universal fallbacks) */
  subjectEn?: string;
}

/** A stock search hit normalized for scoring: string id + orientation + image/video type. */
export type ScoredStockCandidate = Awaited<ReturnType<typeof searchStock>>[number] & {
  id: string;
  orientation?: "portrait" | "landscape" | "square";
  type: "image" | "video";
};

/** Search-phase result: candidates plus how far the broaden ladder had to drift to find them. */
export interface ShotCandidateSearch {
  cands: ScoredStockCandidate[];
  /** the ladder query that actually returned results ("" when nothing matched at all) */
  matchedQuery: string;
  /** original = shot's own terms; narrowed = shortened/topic-anchored; universal = generic filler */
  fallbackLevel: FallbackLevel;
}

/**
 * Search phase: query the stock engine (with the broadenQuery "always-has-results" fallback)
 * and normalize hits for scoring. Returns empty cands when nothing matches even the broadest query.
 * When a minSec duration filter was set and yields nothing anywhere on the ladder, the ladder runs
 * once more without it — a too-short clip (freeze-frame tail) still beats an empty shot.
 */
export async function searchShotCandidates(
  query: string,
  source: StockSourceId | "all",
  searchOpts: StockSearchOptions,
  opts: { subjectEn?: string } = {}
): Promise<ShotCandidateSearch> {
  const runLadder = async (so: StockSearchOptions) => {
    for (const q of [query, ...broadenQuery(query, opts.subjectEn)]) {
      if (!q?.trim()) continue;
      let candidates: Awaited<ReturnType<typeof searchStock>> = [];
      try {
        candidates =
          source === "all" ? (await searchAllStock(q, so)).candidates : await searchStock(source, q, so);
      } catch {
        /* individual query failed — try the next one */
      }
      if (candidates.length > 0) return { candidates, matchedQuery: q };
    }
    return { candidates: [] as Awaited<ReturnType<typeof searchStock>>, matchedQuery: "" };
  };

  let { candidates, matchedQuery } = await runLadder(searchOpts);
  if (candidates.length === 0 && searchOpts.minSec != null) {
    ({ candidates, matchedQuery } = await runLadder({ ...searchOpts, minSec: undefined }));
  }
  return {
    cands: candidates.map((cand) => ({
      ...cand,
      id: String(cand.id), // normalize to string so it can be stored in the usedIds dedup Set
      orientation: cand.width && cand.height ? orientationOf(cand.width, cand.height) : undefined,
      type: cand.mediaType === "video" ? ("video" as const) : ("image" as const),
    })),
    matchedQuery,
    fallbackLevel: fallbackLevelOf(query, matchedQuery),
  };
}

/** Persist phase: download the chosen candidate into the project's stock dir and insert the asset row. */
export async function persistCandidate(
  projectId: string,
  shotId: number,
  query: string,
  c: ScoredStockCandidate,
  scriptId: string
): Promise<Record<string, unknown>> {
  const stockDir = join(getUploadsDir(), projectId, "stock");
  await mkdir(stockDir, { recursive: true });
  const base = `${c.source}_${c.id}_${Date.now()}_${shotId}`;
  const { filePath } = await downloadStockFile(c.downloadUrl, stockDir, base, c.mediaType);
  // Real decode-level check: a CDN that cut the stream or answered with an HTML error page would
  // otherwise fail the whole single-pass compose later with no hint of which asset broke.
  if (!(await validateOrDelete(filePath, c.mediaType === "video" ? "video" : "image"))) {
    throw new Error(`素材文件校验失败（下载损坏或非媒体内容）: ${c.source}/${c.id}`);
  }
  const publicUrl = `/api/files/${projectId}/stock/${basename(filePath)}`;

  const db = getDb();
  const [row] = db.transaction((tx) => {
    writableShot(projectId, scriptId, shotId, tx);
    tx.update(assetsTable).set({ selected: false }).where(sameShot(projectId, scriptId, shotId)).run();
    return tx.insert(assetsTable).values({
      projectId,
      scriptId,
      shotId,
      type: "stock_footage",
      filePath: publicUrl,
      thumbnailPath: c.previewImage ?? null,
      provider: c.source,
      prompt: query,
      sourceUrl: c.pageUrl,
      author: c.author,
      license: c.license,
      selected: true,
      status: "done",
    }).returning().all();
  });

  return { ...row, mediaType: c.mediaType, attributionText: c.attributionText };
}

/**
 * Search, download, and persist one stock asset for a single shot.
 * Includes the "always-has-results" fallback (retries with broader queries when the original yields nothing).
 * Returns the persisted asset row on success, or null if nothing could be found.
 */
export async function fillShotStock(input: FillShotInput): Promise<Record<string, unknown> | null> {
  const { projectId, shotId, query, source, searchOpts, usedIds, sameSourceAuthors, slotSec, subjectEn } = input;

  const search = await searchShotCandidates(query, source, searchOpts, { subjectEn });
  // A generic "abstract background / lifestyle" hit technically fills the slot but makes a
  // finished short feel unrelated to its script. Leave the shot unresolved so the user can
  // adjust its search terms or upload a matching clip instead of silently inserting filler.
  if (search.fallbackLevel === "universal") return null;
  if (search.cands.length === 0) return null;

  // Pick the best candidate: prefer portrait orientation + deduplicate across shots + lean toward
  // sources already used by same-entity shots (material continuity), instead of just taking the first result.
  // A candidate whose download fails validation (broken file, dead link) is dropped and the next-best
  // one is tried — up to 3 attempts, so one rotten hit doesn't leave the shot with no footage.
  const remaining = [...search.cands];
  for (let attempt = 0; attempt < 3 && remaining.length > 0; attempt++) {
    const c =
      pickBestCandidate({ description: query }, remaining, { preferPortrait: true, usedIds, sameSourceAuthors, slotSec }) ??
      remaining[0];
    let asset: Record<string, unknown>;
    try {
      asset = await persistCandidate(projectId, shotId, query, c, input.scriptId);
    } catch (e) {
      console.warn(`[stock-fill] 镜头 ${shotId} 候选下载/校验失败，换下一候选:`, e);
      remaining.splice(remaining.indexOf(c), 1);
      continue;
    }
    const authorKey = authorKeyOf(c);
    // whether this pick actually reused a same-group source — computed BEFORE feeding the key back
    const sameSource = authorKey !== null && sameSourceAuthors?.has(authorKey) === true;
    usedIds?.add(c.id);
    if (authorKey) sameSourceAuthors?.add(authorKey);
    return { ...asset, sameSource, fallbackLevel: search.fallbackLevel, matchedQuery: search.matchedQuery };
  }
  return null;
}
