import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { aiTasks } from "@/lib/db/schema";
import { writableShot } from "@/lib/shot-ownership";
import { NextRequest, NextResponse } from "next/server";
import { listAiTasks, listActiveAiTasksAllProjects } from "@/lib/ai-tasks";
import { errText } from "@/lib/api-error";

// List persisted AI generation tasks (issue #16 recovery UI).
// GET /api/ai/tasks?projectId=xxx&active=1 — active=1 returns only tasks still
// needing attention (submitted / processing / unknown), i.e. resumable ones.
// Without projectId, returns ALL active paid tasks across projects — the global
// task center's cross-project "any money stuck?" view.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const activeOnly = req.nextUrl.searchParams.get("active") === "1";

  try {
    const rows = projectId ? await listAiTasks(projectId, activeOnly) : await listActiveAiTasksAllProjects();
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取任务列表失败", "Failed to list tasks") },
      { status: 500 }
    );
  }
}

// Explicit binding for historical shot-level tasks whose script could not be inferred.
export async function POST(req: NextRequest) {
  try {
    const { rowId, projectId, scriptId } = await req.json();
    if (!rowId || !projectId || !scriptId) return NextResponse.json({ error: "Missing task/project/script" }, { status: 400 });
    const db = getDb();
    const assigned = db.transaction(tx => {
      const task = tx.select().from(aiTasks).where(and(eq(aiTasks.id, rowId),eq(aiTasks.projectId, projectId),isNull(aiTasks.purpose))).get();
      if (!task || task.shotId == null || (task.scriptId && task.scriptId !== scriptId)) throw new Error("任务不能绑定到此脚本");
      writableShot(projectId, scriptId, task.shotId, tx);
      return tx.update(aiTasks).set({ scriptId, awaitingAsset: !task.deliveredAssetId }).where(eq(aiTasks.id,rowId)).returning().get();
    });
    return NextResponse.json(assigned);
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : "无法绑定任务"}, {status:409});
  }
}
