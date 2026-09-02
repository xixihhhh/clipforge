import { requireProjectAccess } from "@/lib/saas/authorization";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { mediaSources, projects } from "@/lib/db/schema";
import { probeMedia } from "@/lib/media-probe";
import { keepRangesForPlan, sanitizeTranscriptDocument, sanitizeTranscriptEditPlan } from "@/lib/transcript-editor";
import { exportTimeline, type TimelineExportFormat } from "@/lib/timeline-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;
const FORMATS = new Set<TimelineExportFormat>(["otio", "edl", "csv"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id, mediaId } = await params;
  if (!SAFE_ID.test(id) || !SAFE_ID.test(mediaId)) return apiError(req, "无效的素材ID", "Invalid media ID", 400);
  try {
    const body = await req.json() as Record<string, unknown>;
    const format = typeof body.format === "string" && FORMATS.has(body.format as TimelineExportFormat) ? body.format as TimelineExportFormat : "otio";
    const db = getDb();
    const [[project], [source]] = await Promise.all([
      db.select({ name: projects.name }).from(projects).where(eq(projects.id, id)).limit(1),
      db.select().from(mediaSources).where(and(eq(mediaSources.id, mediaId), eq(mediaSources.projectId, id))).limit(1),
    ]);
    if (!project || !source) return apiError(req, "项目或素材不存在", "Project or media source not found", 404);
    const transcript = sanitizeTranscriptDocument(source.transcript, source.duration / 1000);
    if (!transcript) return apiError(req, "请先完成素材转写", "Transcribe the media before exporting a timeline", 409);
    const plan = sanitizeTranscriptEditPlan(body.plan, new Set(transcript.words.map((word) => word.id)));
    const keepRanges = keepRangesForPlan(transcript, plan);
    if (!keepRanges.length) return apiError(req, "当前草稿没有可导出的保留片段", "The current draft has no kept clips to export", 422);
    const metadata = await probeMedia(source.filePath);
    const clipNotes = keepRanges.map((range) => {
      const words = transcript.words.filter((word) => word.end > range.start && word.start < range.end);
      const cjk = words.some((word) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(word.text));
      return (cjk ? words.map((word) => word.text).join("") : words.map((word) => word.text).join(" ")).slice(0, 2_000);
    });
    const result = exportTimeline(format, {
      projectName: project.name,
      sourceName: source.originalName,
      sourceDuration: transcript.duration,
      frameRate: metadata.frameRate,
      hasAudio: source.hasAudio,
      keepRanges,
      clipNotes,
      revision: Number.isInteger(body.revision) && Number(body.revision) > 0 ? Number(body.revision) : null,
    });
    if (body.inline === true) return NextResponse.json(result);
    return new Response(result.content, {
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-ClipForge-Clips": String(result.clips),
        "X-ClipForge-Frame-Rate": String(result.frameRate),
      },
    });
  } catch (error) {
    console.error("Timeline export failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "时间线导出失败", "Failed to export timeline") }, { status: 500 });
  }
}
