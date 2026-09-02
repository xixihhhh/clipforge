import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { scripts } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { apiError, errText } from "@/lib/api-error";

// Fetch all script variants for a project (the script page / assets page reads real data by projectId)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  try {
    const { id } = await params;
    const db = getDb();
    const rows = await db
      .select()
      .from(scripts)
      .where(eq(scripts.projectId, id))
      .orderBy(desc(scripts.createdAt));
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Failed to fetch scripts:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取脚本失败", "Failed to fetch scripts") },
      { status: 500 }
    );
  }
}

/**
 * Per-shot text patch: voiceover/description/camera may be edited (structure/timing stay intact).
 * `camera` joined the whitelist for the per-shot named camera-preset picker
 * moves) — the edited sentence feeds the i2v motion prompt on the next (re)generation.
 */
interface ShotTextPatch {
  shotId: number;
  voiceover?: string;
  description?: string;
  camera?: string;
}

/** Hard cap for an edited camera sentence (motion prompts must stay camera-led and short). */
const CAMERA_MAX_LEN = 200;

/**
 * PATCH — two operations for the script page:
 * 1. { selectedScriptId } — switch the active variant (downstream steps read `selected` from the DB).
 * 2. { scriptId, shotTexts: [{shotId, voiceover?, description?, camera?}] } — edit shot copy in place.
 *    Only text fields are merged; shot structure, order, durations and visual fields are untouched
 *    (durations are planning estimates and the final cut snaps to real TTS length anyway).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  try {
    const { id } = await params;
    const body = await req.json();

    // Operation 2: per-shot text edits
    const scriptId = body.scriptId as string | undefined;
    const shotTexts = body.shotTexts as ShotTextPatch[] | undefined;
    if (scriptId && Array.isArray(shotTexts)) {
      const db = getDb();
      const [row] = await db.select().from(scripts).where(eq(scripts.id, scriptId));
      if (!row || row.projectId !== id) {
        return apiError(req, "脚本不存在", "Script not found", 404);
      }
      const patchByShot = new Map<number, ShotTextPatch>();
      for (const p of shotTexts) {
        if (p && typeof p.shotId === "number") patchByShot.set(p.shotId, p);
      }
      const shots = (row.shots ?? []).map((shot) => {
        const p = patchByShot.get(shot.shotId);
        if (!p) return shot;
        return {
          ...shot,
          ...(typeof p.voiceover === "string" && { voiceover: p.voiceover.trim() }),
          ...(typeof p.description === "string" && { description: p.description.trim() }),
          ...(typeof p.camera === "string" && { camera: p.camera.trim().slice(0, CAMERA_MAX_LEN) }),
        };
      });
      const [updated] = await db.update(scripts).set({ shots }).where(eq(scripts.id, scriptId)).returning();
      return NextResponse.json({ success: true, script: updated });
    }

    // Operation 1: switch the selected variant
    const selectedId = body.selectedScriptId as string | undefined;
    if (!selectedId) {
      return apiError(req, "缺少 selectedScriptId 或 scriptId+shotTexts", "Missing selectedScriptId or scriptId+shotTexts", 400);
    }
    const db = getDb();
    // Deselect all scripts under this project, then select the target
    const rows = await db.select().from(scripts).where(eq(scripts.projectId, id));
    for (const r of rows) {
      await db
        .update(scripts)
        .set({ selected: r.id === selectedId })
        .where(eq(scripts.id, r.id));
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update script:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "更新失败", "Update failed") },
      { status: 500 }
    );
  }
}
