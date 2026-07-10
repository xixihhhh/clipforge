import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { projects, compositions } from "@/lib/db/schema";
import { applyNativeFeel, type FeelStrength } from "@/lib/video-composer/native-feel";
import { apiError, errText } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/native-feel — re-render the latest composed video with a hand-shot look
 * (handheld micro-jitter + light grain + slight de-polish color), as a post-process on the finished
 * mp4 (the compose pipeline is untouched). Counters the 2026 platform downranking of overly polished
 * AI-looking content. body: { compositionId?, strength?: "subtle"|"medium", seed?, grain?, vignette? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    .where(compositionId ? and(eq(compositions.projectId, id), eq(compositions.id, compositionId)) : eq(compositions.projectId, id))
    .orderBy(desc(compositions.createdAt))
    .limit(1);
  if (!comp?.outputPath || comp.status !== "done") {
    return apiError(req, "请先合成视频再做原生感处理", "Please compose the video before applying the native feel");
  }
  const videoPath = existsSync(comp.outputPath) ? comp.outputPath : join(getDataDir(), comp.outputPath);
  if (!existsSync(videoPath)) return apiError(req, "成片文件不存在", "The composed video file does not exist", 404);

  const strength: FeelStrength = body.strength === "medium" ? "medium" : "subtle";
  const seed = typeof body.seed === "number" && Number.isFinite(body.seed) ? body.seed : undefined;
  const grain = typeof body.grain === "boolean" ? body.grain : undefined;
  const vignette = body.vignette === true;

  const outName = `native-${Date.now()}.mp4`;
  const outPath = join(getDataDir(), "output", id, outName);
  try {
    await applyNativeFeel({ videoPath, outPath, strength, seed, grain, vignette });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : errText(req, "原生感处理失败", "Native-feel processing failed") },
      { status: 500 }
    );
  }
  return NextResponse.json({ video: `/api/output/${id}/${outName}`, strength });
}
