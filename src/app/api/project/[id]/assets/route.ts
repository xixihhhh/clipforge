import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { LAST_FRAME_SUFFIX } from "@/lib/video-composer/frame-extract";
import { resolveUploadFilePath } from "@/lib/remote-image";
import { existsSync } from "fs";
import { persistAssetSource, saveAssetCandidate } from "@/lib/asset-persistence";
import { sanitizeGenerationControlSummary } from "@/lib/video-repair-plan";

// 获取某项目已生成的素材（素材页恢复状态用）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  try {
    const { id } = await params;
    const db = getDb();
    const rows = await db.select().from(assets).where(eq(assets.projectId, id)).orderBy(desc(assets.createdAt));
    return NextResponse.json(rows.map((row) => {
      const tailPath = row.filePath && /\.(mp4|webm|mov|m4v)$/i.test(row.filePath)
        ? resolveUploadFilePath(`${row.filePath}${LAST_FRAME_SUFFIX}`)
        : null;
      return { ...row, ...(tailPath && existsSync(tailPath) && { lastFrameUrl: `${row.filePath}${LAST_FRAME_SUFFIX}` }) };
    }));
  } catch (error) {
    console.error("获取素材失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取素材失败" },
      { status: 500 }
    );
  }
}

// 保存/更新某分镜的素材（素材生成成功后落库，供合成读取真实素材）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  try {
    const { id } = await params;
    const body = await req.json();
    const { shotId, sourceUrl } = body as { shotId?: number; sourceUrl?: string };

    if (typeof shotId !== "number" || !sourceUrl) {
      return NextResponse.json({ error: "缺少 shotId 或 sourceUrl" }, { status: 400 });
    }
    // 校验 projectId 防路径穿越
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });
    }

    const filePath = await persistAssetSource(id, sourceUrl, shotId);

    const typeMap: Record<string, "ai_generated" | "product_image" | "user_upload"> = {
      ai_generate: "ai_generated",
      ai_generated: "ai_generated",
      product_image: "product_image",
      user_upload: "user_upload",
    };
    const assetType = typeMap[body.type] ?? "ai_generated";
    const generationPlan = sanitizeGenerationControlSummary(body.generationPlan);

    // Static keyframe (first frame) accompanying an i2v video asset: serves as the assets-page
    // thumbnail AND as the source frame for per-shot motion re-runs / keyframe chaining — the
    // upsert below replaces the old keyframe row entirely, so without this column the frame is
    // unrecoverable. Local persisted paths only (the keyframe was saved as an image asset earlier).
    const thumbnailPath =
      typeof body.thumbnailPath === "string" && body.thumbnailPath.startsWith("/api/files/")
        ? body.thumbnailPath
        : undefined;

    return NextResponse.json(await saveAssetCandidate({
      projectId: id,
      shotId,
      type: assetType,
      filePath,
      thumbnailPath,
      provider: body.provider,
      model: body.model,
      prompt: body.prompt,
      generationPlan,
    }));
  } catch (error) {
    console.error("保存素材失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存素材失败" },
      { status: 500 }
    );
  }
}

/** Select an existing take as the real composition input. No media is deleted. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9-]+$/.test(id)) return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });
    const body = await req.json() as { assetId?: unknown };
    if (typeof body.assetId !== "string" || !/^[a-zA-Z0-9-]+$/.test(body.assetId)) {
      return NextResponse.json({ error: "缺少有效的 assetId" }, { status: 400 });
    }
    const db = getDb();
    const [target] = await db.select().from(assets).where(and(eq(assets.id, body.assetId), eq(assets.projectId, id))).limit(1);
    if (!target || target.status !== "done") return NextResponse.json({ error: "素材不存在或尚未就绪" }, { status: 404 });
    db.transaction((tx) => {
      tx.update(assets).set({ selected: false }).where(and(eq(assets.projectId, id), eq(assets.shotId, target.shotId))).run();
      tx.update(assets).set({ selected: true }).where(eq(assets.id, target.id)).run();
    });
    return NextResponse.json({ ...target, selected: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "切换素材失败" }, { status: 500 });
  }
}
