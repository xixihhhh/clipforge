import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { scripts as scriptsTable, assets as assetsTable, type Shot } from "@/lib/db/schema";
import { fillShotStock } from "@/lib/stock-fill";
import { shotQuery } from "@/lib/stock-matcher";
import type { StockSourceId, StockMediaType, StockOrientation } from "@/lib/providers/stock-types";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/stock-fill —— 按当前选中脚本的每个分镜，用其检索词自动配一条免费素材落库。
 * 这是「脚本→素材自动配齐」（无商品主题成片）的关键一步，复用多源素材引擎 + 永远有素材兜底。
 *
 * body: { source?, mediaType?, orientation?, apiKeys?, force? }
 *  - source 默认 "all"（聚合，keyless 的 Openverse 始终参与）
 *  - force=true 时即使该分镜已有 stock 素材也重新配
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) {
    return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* 允许空 body */
  }

  const source = (body.source as StockSourceId | "all") ?? "all";
  // mediaType="auto"：逐镜「视频优先、配不到再退图片」——拿到动态 B-roll 又保证每镜有画面（全程免 Key）
  const autoMode = body.mediaType === "auto";
  const mediaType: StockMediaType =
    body.mediaType === "image" || body.mediaType === "audio" ? (body.mediaType as StockMediaType) : "video";
  const orientation: StockOrientation =
    body.orientation === "landscape" || body.orientation === "square" ? (body.orientation as StockOrientation) : "portrait";
  const apiKeys = (body.apiKeys as Record<string, string>) ?? {};
  const force = body.force === true;

  const db = getDb();

  // 取选中脚本（无选中则取最新一条）
  const rows = await db.select().from(scriptsTable).where(eq(scriptsTable.projectId, id));
  if (rows.length === 0) {
    return NextResponse.json({ error: "该项目还没有脚本，请先生成脚本" }, { status: 404 });
  }
  const script = rows.find((r) => r.selected) ?? rows[rows.length - 1];
  const shots = (script.shots ?? []) as Shot[];
  if (shots.length === 0) {
    return NextResponse.json({ error: "脚本没有分镜" }, { status: 400 });
  }

  // 已有任意素材的分镜（避免重复配、避免与 AI/商品素材在同一分镜上冲突，除非 force）
  const existing = await db
    .select({ shotId: assetsTable.shotId })
    .from(assetsTable)
    .where(eq(assetsTable.projectId, id));
  const already = new Set(existing.map((e) => e.shotId));

  const searchOpts = { apiKeys, mediaType, orientation, perPage: 10 };
  const results: Array<{
    shotId: number;
    ok: boolean;
    query: string;
    provider?: string;
    mediaType?: StockMediaType;
    reason?: string;
  }> = [];

  for (const shot of shots) {
    const sid = shot.shotId;
    if (!force && already.has(sid)) {
      results.push({ shotId: sid, ok: false, query: "", reason: "已有素材，跳过" });
      continue;
    }
    // 商品原图分镜不配免费素材：合成时用商品原图（商品保真），免费素材会盖掉商品
    if (shot.visualSource === "product_image") {
      results.push({ shotId: sid, ok: false, query: "", reason: "商品原图分镜，跳过" });
      continue;
    }
    const query = shotQuery(shot);
    if (!query) {
      results.push({ shotId: sid, ok: false, query: "", reason: "无检索词" });
      continue;
    }
    try {
      let asset = await fillShotStock({ projectId: id, shotId: sid, query, source, searchOpts });
      let usedType: StockMediaType = mediaType;
      // auto 模式下视频没配到 → 退回图片，保证该分镜不空画面
      if (!asset && autoMode && mediaType !== "image") {
        asset = await fillShotStock({
          projectId: id,
          shotId: sid,
          query,
          source,
          searchOpts: { ...searchOpts, mediaType: "image" },
        });
        usedType = "image";
      }
      results.push(
        asset
          ? { shotId: sid, ok: true, query, provider: String(asset.provider), mediaType: usedType }
          : { shotId: sid, ok: false, query, reason: "未找到素材" }
      );
    } catch (e) {
      results.push({ shotId: sid, ok: false, query, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  const filled = results.filter((r) => r.ok).length;
  return NextResponse.json({ projectId: id, scriptId: script.id, total: shots.length, filled, results });
}
