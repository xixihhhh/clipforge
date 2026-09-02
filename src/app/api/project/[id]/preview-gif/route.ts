import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { compositions } from "@/lib/db/schema";
import { generateGifPreview } from "@/lib/video-composer/gif-preview";
import { apiError, errText } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/preview-gif — turn a slice of the latest composed video into a looping GIF preview.
 * body: { startSec?: number, durationSec?: number, width?: number }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body; defaults applied below */
  }

  const db = getDb();
  const [comp] = await db
    .select()
    .from(compositions)
    // latest *successful* composition — a failed retry on top must not hide a good take
    .where(and(eq(compositions.projectId, id), eq(compositions.status, "done")))
    .orderBy(desc(compositions.createdAt))
    .limit(1);
  if (!comp?.outputPath || comp.status !== "done") {
    return apiError(req, "请先合成视频再生成预览 GIF", "Please compose the video before generating a preview GIF");
  }
  const videoPath = existsSync(comp.outputPath) ? comp.outputPath : join(getDataDir(), comp.outputPath);
  if (!existsSync(videoPath)) return apiError(req, "成片文件不存在", "The composed video file does not exist", 404);

  const fileName = `preview-${Date.now()}.gif`;
  const outPath = join(getDataDir(), "uploads", id, fileName);
  try {
    await generateGifPreview({
      videoPath,
      outPath,
      startSec: Number(body.startSec) || 0,
      durationSec: Number(body.durationSec) || 4,
      width: Number(body.width) || 360,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : errText(req, "GIF 生成失败", "GIF generation failed") }, { status: 500 });
  }
  return NextResponse.json({ gif: `/api/files/${id}/${fileName}` });
}
