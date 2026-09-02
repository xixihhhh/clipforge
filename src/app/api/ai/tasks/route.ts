import { NextRequest, NextResponse } from "next/server";
import { listAiTasks, listActiveAiTasksAllProjects } from "@/lib/ai-tasks";
import { errText } from "@/lib/api-error";
import { requireApiIdentity, requireProjectAccess } from "@/lib/saas/authorization";
import { projectRepository } from "@/lib/saas/project-repository";

// List persisted AI generation tasks (issue #16 recovery UI).
// GET /api/ai/tasks?projectId=xxx&active=1 — active=1 returns only tasks still
// needing attention (submitted / processing / unknown), i.e. resumable ones.
// Without projectId, returns ALL active paid tasks across projects — the global
// task center's cross-project "any money stuck?" view.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const activeOnly = req.nextUrl.searchParams.get("active") === "1";

  try {
    if (projectId) {
      const projectAccess = await requireProjectAccess(projectId);
      if (!projectAccess.ok) return projectAccess.response;
      return NextResponse.json(await listAiTasks(projectId, activeOnly));
    }
    const access = await requireApiIdentity();
    if (!access.ok) return access.response;
    const rows = await listActiveAiTasksAllProjects();
    const scopedIds = access.identity
      ? new Set((await projectRepository.getProjects(access.identity.user.id)).map((project) => project.id))
      : null;
    const scopedRows = scopedIds ? rows.filter((row) => row.projectId && scopedIds.has(row.projectId)) : rows;
    return NextResponse.json(scopedRows);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取任务列表失败", "Failed to list tasks") },
      { status: 500 }
    );
  }
}
