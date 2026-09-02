import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { mkdir } from "fs/promises";
import { join, basename } from "path";
import { downloadStockFile } from "@/lib/providers/stock-types";
import {
  STOCK_SOURCES,
  type StockCandidate,
  type StockSourceId,
  type StockMediaType,
  type StockOrientation,
} from "@/lib/providers/stock-types";
import {
  searchStock,
  searchAllStock,
  getAvailableSources,
  isSourceAvailable,
} from "@/lib/providers/stock-registry";
import { broadenQuery } from "@/lib/stock-matcher";
import { getDb } from "@/lib/db";
import { assets as assetsTable } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { and, eq } from "drizzle-orm";
import { requireProjectAccess } from "@/lib/saas/authorization";

/** validate projectId to prevent path traversal (consistent with the upload route) */
const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

const VALID_SOURCES = new Set(STOCK_SOURCES.map((s) => s.id));

/**
 * GET /api/stock/search —— list available stock sources (used by the frontend to render source selector / mark keyless sources)
 */
export async function GET() {
  const available = getAvailableSources().map((s) => s.id);
  return NextResponse.json({
    sources: STOCK_SOURCES.map((s) => ({
      id: s.id,
      label: s.label,
      keyless: s.keyless,
      mediaTypes: s.mediaTypes,
      signupUrl: s.signupUrl,
      note: s.note,
      available: available.includes(s.id), // whether the source is ready to use in the current environment (env key present or keyless)
    })),
  });
}

/**
 * POST /api/stock/search —— search licensed stock media from multiple sources; optionally download and persist to assets.
 *
 * body: {
 *   query: string,                 // search query (English recommended for better recall)
 *   source?: "pexels"|"pixabay"|"openverse"|"all",  // default: pexels (backward-compatible)
 *   mediaType?: "video"|"image"|"audio",            // default: video
 *   orientation?: "portrait"|"landscape"|"square",  // default: portrait
 *   perPage?: number, minSec?: number, maxSec?: number,
 *   download?: boolean, projectId?: string, shotId?: number, count?: number,
 *   apiKeys?: { pexels?, pixabay?, openverse? },     // per-source API keys
 *   apiKey?: string                // backward-compat: applies to the single source specified by `source`
 * }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError(req, "请求体不是合法 JSON", "Request body is not valid JSON");
  }

  const query = String(body.query ?? "").trim();
  const source = (VALID_SOURCES.has(body.source as StockSourceId) ? body.source : body.source === "all" ? "all" : "pexels") as
    | StockSourceId
    | "all";
  const mediaType: StockMediaType =
    body.mediaType === "image" || body.mediaType === "audio" ? (body.mediaType as StockMediaType) : "video";
  const orientation: StockOrientation =
    body.orientation === "landscape" || body.orientation === "square" ? (body.orientation as StockOrientation) : "portrait";
  const perPage = Number(body.perPage ?? 10);
  const count = Math.max(1, Number(body.count ?? 1));
  const download = body.download === true;
  const shotId = Number(body.shotId ?? 0);
  const minSec = body.minSec != null ? Number(body.minSec) : undefined;
  const maxSec = body.maxSec != null ? Number(body.maxSec) : undefined;

  // build per-source key map: apiKeys object takes priority; fall back to legacy apiKey for single-source requests
  const apiKeys: Partial<Record<StockSourceId, string>> =
    (body.apiKeys as Partial<Record<StockSourceId, string>>) ?? {};
  if (body.apiKey && source !== "all" && !apiKeys[source]) {
    apiKeys[source] = String(body.apiKey);
  }

  if (!query) {
    return apiError(req, "请填写检索词（建议英文，召回更好）", "Please enter a search query (English recommended for better recall)");
  }

  const searchOpts = { apiKeys, mediaType, perPage, orientation, minSec, maxSec };

  // search
  let candidates: StockCandidate[];
  let skippedSources: StockSourceId[] = [];
  try {
    if (source === "all") {
      const agg = await searchAllStock(query, searchOpts);
      candidates = agg.candidates;
      skippedSources = agg.skippedSources;
    } else {
      // single source: if the source requires a key that wasn't provided, return a precise error message
      const meta = STOCK_SOURCES.find((s) => s.id === source)!;
      if (!isSourceAvailable(meta, apiKeys)) {
        return apiError(
          req,
          `${meta.label} 需要 API Key，请在设置中填写或设置 ${meta.envKey} 环境变量（免费申请：${meta.signupUrl}）。提示：Openverse 源无需 Key。`,
          `${meta.label} requires an API key. Please fill it in Settings or set the ${meta.envKey} environment variable (free signup: ${meta.signupUrl}). Tip: the Openverse source needs no key.`
        );
      }
      candidates = await searchStock(source, query, searchOpts);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /\b401\b/.test(msg) ? 401 : 502;
    return NextResponse.json({ error: errText(req, `素材检索失败：${msg}`, `Stock search failed: ${msg}`) }, { status });
  }

  // preview only
  if (!download) {
    return NextResponse.json({ candidates, skippedSources });
  }

  // download and persist to DB
  const projectId = String(body.projectId ?? "");
  if (!projectId || !SAFE_ID.test(projectId)) {
    return apiError(req, "download=true 时需提供合法 projectId", "A valid projectId is required when download=true");
  }
  const projectAccess = await requireProjectAccess(projectId);
  if (!projectAccess.ok) return projectAccess.response;
  // "always have footage" fallback: when the original query returns nothing, retry with broader fallback terms to prevent blank shots caused by niche topics
  if (candidates.length === 0) {
    for (const bq of broadenQuery(query)) {
      try {
        candidates =
          source === "all"
            ? (await searchAllStock(bq, searchOpts)).candidates
            : await searchStock(source, bq, searchOpts);
      } catch {
        /* skip to the next fallback term if this one fails */
      }
      if (candidates.length > 0) break;
    }
  }
  if (candidates.length === 0) {
    return NextResponse.json({ error: errText(req, "没有检索到可用素材，换个检索词或素材源试试", "No usable stock media found — try a different query or source"), skippedSources }, { status: 404 });
  }

  const stockDir = join(getDataDir(), "uploads", projectId, "stock");
  await mkdir(stockDir, { recursive: true });

  const picked = candidates.slice(0, count);
  const saved: Array<Record<string, unknown>> = [];
  const db = getDb();
  await db.update(assetsTable).set({ selected: false }).where(and(eq(assetsTable.projectId, projectId), eq(assetsTable.shotId, shotId)));

  for (let i = 0; i < picked.length; i++) {
    const c = picked[i];
    try {
      const base = `${c.source}_${c.id}_${Date.now()}_${i}`;
      const { filePath, bytes } = await downloadStockFile(c.downloadUrl, stockDir, base);
      const publicUrl = `/api/files/${projectId}/stock/${basename(filePath)}`;

      const [row] = await db
        .insert(assetsTable)
        .values({
          projectId,
          shotId,
          type: "stock_footage",
          filePath: publicUrl,
          thumbnailPath: c.previewImage ?? null,
          provider: c.source, // record the actual source (pexels/pixabay/openverse)
          prompt: query,
          sourceUrl: c.pageUrl,
          author: c.author,
          license: c.license,
          selected: i === 0,
          status: "done",
        })
        .returning();

      saved.push({ ...row, bytes, mediaType: c.mediaType, downloadUrl: c.downloadUrl, attributionText: c.attributionText });
    } catch (e) {
      console.error(`素材下载落库失败（${c.downloadUrl}）:`, e);
    }
  }

  if (saved.length === 0) {
    return apiError(req, "素材下载全部失败，请重试", "All stock downloads failed, please try again", 502);
  }

  return NextResponse.json({ assets: saved, candidatesCount: candidates.length, skippedSources });
}
