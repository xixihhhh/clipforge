import { appendScriptVariants } from "@/lib/script-variants";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { splitNarrationIntoShots } from "@/lib/script-import";
import { apiError } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/import-script — Produce a video directly from a user-written script/narration (no AI generation step).
 * Splits the full copy into shots sentence-by-sentence with estimated durations and saves it as the currently selected script;
 * then proceeds normally: auto-match visuals (or use local assets) + voiceover + compose.
 * body: { script: string, title?: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body; validated below */
  }
  const text = typeof body.script === "string" ? body.script.trim() : "";
  if (text.length < 2) return apiError(req, "请提供脚本文案", "Please provide script copy");

  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) return apiError(req, "项目不存在", "Project not found", 404);

  const shots = splitNarrationIntoShots(text);
  if (!shots.length) return apiError(req, "脚本无法切分出分镜（缺少有效文案）", "Could not split the script into shots (no valid copy)", 422);
  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0);

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 80)
      : (shots[0]?.voiceover ?? "导入脚本").slice(0, 30);

  const [row] = appendScriptVariants(id, [{
      styleType: "custom",
      title,
      totalDuration,
      shots,
    }]);

  return NextResponse.json({ scriptId: row.id, version: row.version, shots: shots.length, totalDuration });
}
