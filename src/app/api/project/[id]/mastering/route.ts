import { requireProjectAccess } from "@/lib/saas/authorization";
import { existsSync } from "fs";
import { join } from "path";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { compositions, projects } from "@/lib/db/schema";
import { getDataDir } from "@/lib/paths";
import { analyzeMastering, renderMastering, type MasteringOptions } from "@/lib/video-mastering";
import { extractFirstFrame } from "@/lib/video-composer/frame-extract";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

async function findComposition(projectId: string, compositionId?: string) {
  const db = getDb();
  const [composition] = await db
    .select()
    .from(compositions)
    .where(
      compositionId
        ? and(eq(compositions.projectId, projectId), eq(compositions.id, compositionId))
        : and(eq(compositions.projectId, projectId), eq(compositions.status, "done"))
    )
    .orderBy(desc(compositions.createdAt))
    .limit(1);
  return composition;
}

/**
 * POST /api/project/[id]/mastering
 * action=analyze measures visual differences around real splice points and first-pass loudness.
 * action=render creates a new non-destructive composition using only the explicitly selected
 * local mastering operations. The source composition is never overwritten.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return apiError(req, "请求格式无效", "Invalid request body");
  }

  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) return apiError(req, "项目不存在", "Project not found", 404);

  const compositionId = typeof body.compositionId === "string" && SAFE_ID.test(body.compositionId) ? body.compositionId : undefined;
  const source = await findComposition(id, compositionId);
  if (!source?.outputPath || source.status !== "done") {
    return apiError(req, "请先完成成片合成", "Please finish composing a video first");
  }
  const videoPath = existsSync(source.outputPath) ? source.outputPath : join(getDataDir(), source.outputPath);
  if (!existsSync(videoPath)) return apiError(req, "成片文件不存在", "The composed video file does not exist", 404);

  try {
    const analysis = await analyzeMastering(videoPath);
    if (body.action !== "render") return NextResponse.json({ compositionId: source.id, analysis });

    const options: MasteringOptions = {
      normalizeAudio: body.normalizeAudio === true,
      deflicker: body.deflicker === true,
    };
    if (!options.normalizeAudio && !options.deflicker) {
      return apiError(req, "请至少选择一项本地精修操作", "Select at least one local mastering operation");
    }
    if (options.normalizeAudio && (!analysis.hasAudio || !analysis.loudness)) {
      options.normalizeAudio = false;
    }
    if (!options.normalizeAudio && !options.deflicker) {
      return apiError(req, "当前成片没有可执行的所选精修项", "None of the selected mastering operations can run on this video");
    }

    const label = typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, 60)
      : "Local master";
    const [created] = await db.insert(compositions).values({
      projectId: id,
      resolution: source.resolution,
      aspectRatio: source.aspectRatio,
      duration: source.duration ?? Math.round(analysis.duration * 1000),
      bgmPath: source.bgmPath,
      ttsEnabled: source.ttsEnabled,
      subtitleStyle: source.subtitleStyle,
      aigcBadge: source.aigcBadge,
      label,
      status: "composing",
    }).returning();

    const outName = `master-${Date.now()}-${created.id.slice(0, 8)}.mp4`;
    const outputPath = join(getDataDir(), "output", id, outName);
    void (async () => {
      try {
        await renderMastering({ videoPath, outputPath, contentId: id, analysis, options });
        const thumbnailPath = await extractFirstFrame(outputPath);
        await db.update(compositions).set({
          outputPath,
          status: "done",
          ...(thumbnailPath && { thumbnailPath }),
        }).where(eq(compositions.id, created.id));
      } catch (error) {
        console.error("Local mastering failed:", error);
        await db.update(compositions).set({ status: "failed" }).where(eq(compositions.id, created.id)).catch(() => undefined);
      }
    })();

    return NextResponse.json({ compositionId: created.id, status: "composing", analysis, options }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "本地精修失败", "Local mastering failed") },
      { status: 500 }
    );
  }
}
