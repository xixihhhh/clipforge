import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { compositions } from "@/lib/db/schema";
import { generateContactSheet } from "@/lib/video-composer/contact-sheet";
import { apiError, errText } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/contact-sheet — render a one-image overview of the latest composed video:
 * evenly-sampled filmstrip + audio waveform. The post-compose eyeball check for humans and agents.
 * body: { compositionId?: string, frames?: number, thumbWidth?: number }
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

  const fileName = `sheet-${Date.now()}.png`;
  const outPath = join(getDataDir(), "uploads", id, fileName);
  try {
    const layout = await generateContactSheet({
      videoPath,
      outPath,
      frames: Number(body.frames) || undefined,
      thumbWidth: Number(body.thumbWidth) || undefined,
    });
    return NextResponse.json({ sheet: `/api/files/${id}/${fileName}`, layout, compositionId: comp.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : errText(req, "成片速览生成失败", "Contact sheet generation failed") },
      { status: 500 }
    );
  }
}
