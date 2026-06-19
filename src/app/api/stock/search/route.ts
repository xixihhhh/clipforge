import { NextRequest, NextResponse } from "next/server";
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
import { getDb } from "@/lib/db";
import { assets as assetsTable } from "@/lib/db/schema";

/** 校验 projectId 防路径穿越（与 upload 路由一致） */
const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

const VALID_SOURCES = new Set(STOCK_SOURCES.map((s) => s.id));

/**
 * GET /api/stock/search —— 列出可用素材源（前端据此渲染源选择/标注 keyless）
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
      available: available.includes(s.id), // 当前环境(env key 或 keyless)是否可直接用
    })),
  });
}

/**
 * POST /api/stock/search —— 多源检索版权素材，可选下载落库到 assets。
 *
 * body: {
 *   query: string,                 // 检索词（建议英文）
 *   source?: "pexels"|"pixabay"|"openverse"|"all",  // 默认 pexels（向后兼容）
 *   mediaType?: "video"|"image"|"audio",            // 默认 video
 *   orientation?: "portrait"|"landscape"|"square",  // 默认 portrait
 *   perPage?: number, minSec?: number, maxSec?: number,
 *   download?: boolean, projectId?: string, shotId?: number, count?: number,
 *   apiKeys?: { pexels?, pixabay?, openverse? },     // 多源 Key
 *   apiKey?: string                // 向后兼容：作用于 source 单源
 * }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
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

  // 组装多源 Key：apiKeys 对象优先；向后兼容 apiKey 作用于单源
  const apiKeys: Partial<Record<StockSourceId, string>> =
    (body.apiKeys as Partial<Record<StockSourceId, string>>) ?? {};
  if (body.apiKey && source !== "all" && !apiKeys[source]) {
    apiKeys[source] = String(body.apiKey);
  }

  if (!query) {
    return NextResponse.json({ error: "请填写检索词（建议英文，召回更好）" }, { status: 400 });
  }

  const searchOpts = { apiKeys, mediaType, perPage, orientation, minSec, maxSec };

  // 检索
  let candidates: StockCandidate[];
  let skippedSources: StockSourceId[] = [];
  try {
    if (source === "all") {
      const agg = await searchAllStock(query, searchOpts);
      candidates = agg.candidates;
      skippedSources = agg.skippedSources;
    } else {
      // 单源：若该源需 Key 而未提供，给精准提示
      const meta = STOCK_SOURCES.find((s) => s.id === source)!;
      if (!isSourceAvailable(meta, apiKeys)) {
        return NextResponse.json(
          {
            error: `${meta.label} 需要 API Key，请在设置中填写或设置 ${meta.envKey} 环境变量（免费申请：${meta.signupUrl}）。提示：Openverse 源无需 Key。`,
          },
          { status: 400 }
        );
      }
      candidates = await searchStock(source, query, searchOpts);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /\b401\b/.test(msg) ? 401 : 502;
    return NextResponse.json({ error: `素材检索失败：${msg}` }, { status });
  }

  // 仅预览
  if (!download) {
    return NextResponse.json({ candidates, skippedSources });
  }

  // 下载落库
  const projectId = String(body.projectId ?? "");
  if (!projectId || !SAFE_ID.test(projectId)) {
    return NextResponse.json({ error: "download=true 时需提供合法 projectId" }, { status: 400 });
  }
  if (candidates.length === 0) {
    return NextResponse.json({ error: "没有检索到可用素材，换个检索词或素材源试试", skippedSources }, { status: 404 });
  }

  const stockDir = join(process.cwd(), "data", "uploads", projectId, "stock");
  await mkdir(stockDir, { recursive: true });

  const picked = candidates.slice(0, count);
  const saved: Array<Record<string, unknown>> = [];
  const db = getDb();

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
          provider: c.source, // 记录实际来源（pexels/pixabay/openverse）
          prompt: query,
          sourceUrl: c.pageUrl,
          author: c.author,
          license: c.license,
          status: "done",
        })
        .returning();

      saved.push({ ...row, bytes, mediaType: c.mediaType, downloadUrl: c.downloadUrl, attributionText: c.attributionText });
    } catch (e) {
      console.error(`素材下载落库失败（${c.downloadUrl}）:`, e);
    }
  }

  if (saved.length === 0) {
    return NextResponse.json({ error: "素材下载全部失败，请重试" }, { status: 502 });
  }

  return NextResponse.json({ assets: saved, candidatesCount: candidates.length, skippedSources });
}
