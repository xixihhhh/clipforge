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
import { broadenQuery, pickBestCandidate, authorKeyOf } from "@/lib/stock-matcher";
import { getDb } from "@/lib/db";
import { assets as assetsTable } from "@/lib/db/schema";

export interface FillShotInput {
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
}

/** A stock search hit normalized for scoring: string id + orientation + image/video type. */
export type ScoredStockCandidate = Awaited<ReturnType<typeof searchStock>>[number] & {
  id: string;
  orientation?: "portrait" | "landscape" | "square";
  type: "image" | "video";
};

/**
 * Search phase: query the stock engine (with the broadenQuery "always-has-results" fallback)
 * and normalize hits for scoring. Returns [] when nothing matches even the broadest query.
 */
export async function searchShotCandidates(
  query: string,
  source: StockSourceId | "all",
  searchOpts: StockSearchOptions
): Promise<ScoredStockCandidate[]> {
  let candidates: Awaited<ReturnType<typeof searchStock>> = [];
  for (const q of [query, ...broadenQuery(query)]) {
    if (!q?.trim()) continue;
    try {
      candidates =
        source === "all" ? (await searchAllStock(q, searchOpts)).candidates : await searchStock(source, q, searchOpts);
    } catch {
      /* individual query failed — try the next one */
    }
    if (candidates.length > 0) break;
  }
  return candidates.map((cand) => ({
    ...cand,
    id: String(cand.id), // normalize to string so it can be stored in the usedIds dedup Set
    orientation: cand.width && cand.height ? orientationOf(cand.width, cand.height) : undefined,
    type: cand.mediaType === "video" ? ("video" as const) : ("image" as const),
  }));
}

/** Persist phase: download the chosen candidate into the project's stock dir and insert the asset row. */
export async function persistCandidate(
  projectId: string,
  shotId: number,
  query: string,
  c: ScoredStockCandidate
): Promise<Record<string, unknown>> {
  const stockDir = join(getUploadsDir(), projectId, "stock");
  await mkdir(stockDir, { recursive: true });
  const base = `${c.source}_${c.id}_${Date.now()}_${shotId}`;
  const { filePath } = await downloadStockFile(c.downloadUrl, stockDir, base, c.mediaType);
  const publicUrl = `/api/files/${projectId}/stock/${basename(filePath)}`;

  const [row] = await getDb()
    .insert(assetsTable)
    .values({
      projectId,
      shotId,
      type: "stock_footage",
      filePath: publicUrl,
      thumbnailPath: c.previewImage ?? null,
      provider: c.source,
      prompt: query,
      sourceUrl: c.pageUrl,
      author: c.author,
      license: c.license,
      status: "done",
    })
    .returning();

  return { ...row, mediaType: c.mediaType, attributionText: c.attributionText };
}

/**
 * Search, download, and persist one stock asset for a single shot.
 * Includes the "always-has-results" fallback (retries with broader queries when the original yields nothing).
 * Returns the persisted asset row on success, or null if nothing could be found.
 */
export async function fillShotStock(input: FillShotInput): Promise<Record<string, unknown> | null> {
  const { projectId, shotId, query, source, searchOpts, usedIds, sameSourceAuthors } = input;

  const scored = await searchShotCandidates(query, source, searchOpts);
  if (scored.length === 0) return null;

  // Pick the best candidate: prefer portrait orientation + deduplicate across shots + lean toward
  // sources already used by same-entity shots (material continuity), instead of just taking the first result
  const c = pickBestCandidate({ description: query }, scored, { preferPortrait: true, usedIds, sameSourceAuthors }) ?? scored[0];
  const authorKey = authorKeyOf(c);
  // whether this pick actually reused a same-group source — computed BEFORE feeding the key back
  const sameSource = authorKey !== null && sameSourceAuthors?.has(authorKey) === true;
  usedIds?.add(c.id);
  if (authorKey) sameSourceAuthors?.add(authorKey);
  const asset = await persistCandidate(projectId, shotId, query, c);
  return { ...asset, sameSource };
}
