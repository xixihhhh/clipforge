import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { projects, compositions } from "@/lib/db/schema";
import { runQc, expectedDimensions } from "@/lib/video-composer/qc";
import { apiError, errText } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/qc — quality-check a composed video (post-process on the finished mp4;
 * does not touch the compose pipeline). Probes streams/duration/resolution and scans for black
 * frames, long silence, loudness drift and frozen picture; returns a structured bilingual report
 * so batch users can gate bad output before publishing.
 * body: { compositionId? } — defaults to the latest finished composition.
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
    /* allow empty body */
  }

  const db = getDb();
  const [proj] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!proj) return apiError(req, "项目不存在", "Project not found", 404);

  const compositionId = typeof body.compositionId === "string" && SAFE_ID.test(body.compositionId) ? body.compositionId : undefined;
  const [comp] = await db
    .select()
    .from(compositions)
    // default to the latest *successful* composition — a failed retry on top must not hide a good take
    .where(compositionId ? and(eq(compositions.projectId, id), eq(compositions.id, compositionId)) : and(eq(compositions.projectId, id), eq(compositions.status, "done")))
    .orderBy(desc(compositions.createdAt))
    .limit(1);
  if (!comp?.outputPath || comp.status !== "done") {
    return apiError(req, "请先合成视频再运行质检", "Please compose the video before running QC");
  }
  const videoPath = existsSync(comp.outputPath) ? comp.outputPath : join(getDataDir(), comp.outputPath);
  if (!existsSync(videoPath)) return apiError(req, "成片文件不存在", "The composed video file does not exist", 404);

  try {
    const dims = expectedDimensions(comp.resolution, comp.aspectRatio);
    const report = await runQc(videoPath, {
      durationSec: comp.duration ? comp.duration / 1000 : undefined,
      ...(dims ?? {}),
    });
    return NextResponse.json({ compositionId: comp.id, ...report });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : errText(req, "质检运行失败", "Quality check failed") },
      { status: 500 }
    );
  }
}
