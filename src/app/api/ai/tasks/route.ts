import { NextRequest, NextResponse } from "next/server";
import { listAiTasks } from "@/lib/ai-tasks";
import { errText } from "@/lib/api-error";

// List persisted AI generation tasks for a project (issue #16 recovery UI).
// GET /api/ai/tasks?projectId=xxx&active=1 — active=1 returns only tasks still
// needing attention (submitted / processing / unknown), i.e. resumable ones.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const activeOnly = req.nextUrl.searchParams.get("active") === "1";

  if (!projectId) {
    return NextResponse.json(
      { error: errText(req, "缺少 projectId 参数", "Missing projectId parameter") },
      { status: 400 }
    );
  }

  try {
    const rows = await listAiTasks(projectId, activeOnly);
    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "获取任务列表失败", "Failed to list tasks") },
      { status: 500 }
    );
  }
}
