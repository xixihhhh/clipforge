import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { compositions } from "@/lib/db/schema";
import { generateCover } from "@/lib/video-composer/cover";
import { apiError, errText } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/cover — generate a cover/thumbnail image from the latest composed video,
 * overlaying a bold title. body: { title: string, frameAt?: number, position?: "center"|"lower"|"upper" }
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
    /* allow empty body; validated below */
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return apiError(req, "请提供封面标题", "Please provide a cover title");

  const db = getDb();
  const [comp] = await db
    .select()
    .from(compositions)
    // latest *successful* composition — a failed retry on top must not hide a good take
    .where(and(eq(compositions.projectId, id), eq(compositions.status, "done")))
    .orderBy(desc(compositions.createdAt))
    .limit(1);
  if (!comp?.outputPath || comp.status !== "done") {
    return apiError(req, "请先合成视频再生成封面", "Please compose the video before generating a cover");
  }
  // outputPath may be absolute or relative to the data dir
  const videoPath = existsSync(comp.outputPath) ? comp.outputPath : join(getDataDir(), comp.outputPath);
  if (!existsSync(videoPath)) return apiError(req, "成片文件不存在", "The composed video file does not exist", 404);

  const fileName = `cover-${Date.now()}.png`;
  const outPath = join(getDataDir(), "uploads", id, fileName);
  const position = body.position === "lower" || body.position === "upper" ? body.position : "center";
  try {
    await generateCover({ videoPath, title, outPath, frameAtSec: Number(body.frameAt) || 1, position });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : errText(req, "封面生成失败", "Cover generation failed") }, { status: 500 });
  }
  return NextResponse.json({ cover: `/api/files/${id}/${fileName}`, title });
}
