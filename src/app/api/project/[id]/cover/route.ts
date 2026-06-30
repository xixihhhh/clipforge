import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { compositions } from "@/lib/db/schema";
import { generateCover } from "@/lib/video-composer/cover";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/cover — generate a cover/thumbnail image from the latest composed video,
 * overlaying a bold title. body: { title: string, frameAt?: number, position?: "center"|"lower"|"upper" }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body; validated below */
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "请提供封面标题" }, { status: 400 });

  const db = getDb();
  const [comp] = await db
    .select()
    .from(compositions)
    .where(eq(compositions.projectId, id))
    .orderBy(desc(compositions.createdAt))
    .limit(1);
  if (!comp?.outputPath || comp.status !== "done") {
    return NextResponse.json({ error: "请先合成视频再生成封面" }, { status: 400 });
  }
  // outputPath may be absolute or relative to the data dir
  const videoPath = existsSync(comp.outputPath) ? comp.outputPath : join(getDataDir(), comp.outputPath);
  if (!existsSync(videoPath)) return NextResponse.json({ error: "成片文件不存在" }, { status: 404 });

  const fileName = `cover-${Date.now()}.png`;
  const outPath = join(getDataDir(), "uploads", id, fileName);
  const position = body.position === "lower" || body.position === "upper" ? body.position : "center";
  try {
    await generateCover({ videoPath, title, outPath, frameAtSec: Number(body.frameAt) || 1, position });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "封面生成失败" }, { status: 500 });
  }
  return NextResponse.json({ cover: `/api/files/${id}/${fileName}`, title });
}
