import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { compositions } from "@/lib/db/schema";
import { generateContactSheet, generateReviewProxy } from "@/lib/video-composer/contact-sheet";
import { apiError, errText } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/contact-sheet — render a one-image overview of the latest composed video.
 * Default "smart" mode samples real scene cuts (red-outlined thumbs + red ticks on the waveform
 * timeline) so splice problems are visible at a glance; "even" keeps uniform sampling.
 * body: { compositionId?: string, frames?: number, thumbWidth?: number,
 *         mode?: "smart"|"even", sceneThreshold?: number, proxy?: boolean }
 * proxy: also renders a short-side-≤720 review clip with burned-in timecode for human feedback.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body; defaults applied below */
  }

  const db = getDb();
  // explicit compositionId wins; otherwise latest *successful* composition (a failed retry must not hide a good take)
  const compositionId = typeof body.compositionId === "string" && SAFE_ID.test(body.compositionId) ? body.compositionId : undefined;
  const [comp] = compositionId
    ? await db
        .select()
        .from(compositions)
        .where(and(eq(compositions.projectId, id), eq(compositions.id, compositionId)))
        .limit(1)
    : await db
        .select()
        .from(compositions)
        .where(and(eq(compositions.projectId, id), eq(compositions.status, "done")))
        .orderBy(desc(compositions.createdAt))
        .limit(1);
  if (!comp?.outputPath || comp.status !== "done") {
    return apiError(req, "请先合成视频再生成成片速览", "Please compose the video before generating a contact sheet");
  }
  const videoPath = existsSync(comp.outputPath) ? comp.outputPath : join(getDataDir(), comp.outputPath);
  if (!existsSync(videoPath)) return apiError(req, "成片文件不存在", "The composed video file does not exist", 404);

  // authoritative splice times: the composer writes a timeline sidecar next to the output
  // (scene detection alone cannot see gradual cross-fades) — best-effort, absent for old renders
  let knownCuts: number[] | undefined;
  try {
    const raw = JSON.parse(await readFile(`${videoPath}.timeline.json`, "utf8")) as { boundaries?: unknown };
    if (Array.isArray(raw.boundaries)) {
      knownCuts = raw.boundaries.filter((b): b is number => typeof b === "number" && Number.isFinite(b) && b > 0);
    }
  } catch {
    /* no sidecar — smart mode falls back to detection only */
  }

  const stamp = Date.now();
  const fileName = `sheet-${stamp}.png`;
  const outPath = join(getDataDir(), "uploads", id, fileName);
  try {
    const result = await generateContactSheet({
      videoPath,
      outPath,
      frames: Number(body.frames) || undefined,
      thumbWidth: Number(body.thumbWidth) || undefined,
      mode: body.mode === "even" ? "even" : "smart",
      sceneThreshold: Number(body.sceneThreshold) || undefined,
      knownCuts,
    });
    let proxyUrl: string | undefined;
    if (body.proxy === true) {
      const proxyName = `proxy-${stamp}.mp4`;
      await generateReviewProxy({ videoPath, outPath: join(getDataDir(), "uploads", id, proxyName) });
      proxyUrl = `/api/files/${id}/${proxyName}`;
    }
    return NextResponse.json({
      sheet: `/api/files/${id}/${fileName}`,
      layout: result.layout,
      mode: result.mode,
      frameTimes: result.frameTimes,
      cuts: result.cuts,
      ...(proxyUrl ? { proxy: proxyUrl } : {}),
      compositionId: comp.id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : errText(req, "成片速览生成失败", "Contact sheet generation failed") },
      { status: 500 }
    );
  }
}
