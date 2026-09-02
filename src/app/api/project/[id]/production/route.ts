import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { aiTasks, assets, compositions, pipelineRuns, projects, scripts, videoClips } from "@/lib/db/schema";
import {
  buildVersionTree,
  sanitizeCreativeIntent,
  sanitizeProjectMediaInsight,
  sanitizeVisualBible,
  sanitizeWorkflowPlan,
  semanticAssetFromRecord,
  type ProductionSnapshot,
} from "@/lib/production-system";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

async function projectRows(projectId: string) {
  const db = getDb();
  const [project, scriptRows, assetRows, taskRows, compositionRows, clipRows, runRows] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, projectId)).limit(1),
    db.select().from(scripts).where(eq(scripts.projectId, projectId)).orderBy(desc(scripts.createdAt)),
    db.select().from(assets).where(eq(assets.projectId, projectId)).orderBy(desc(assets.createdAt)),
    db.select().from(aiTasks).where(eq(aiTasks.projectId, projectId)).orderBy(desc(aiTasks.createdAt)),
    db.select().from(compositions).where(eq(compositions.projectId, projectId)).orderBy(desc(compositions.createdAt)),
    db.select().from(videoClips).where(eq(videoClips.projectId, projectId)).orderBy(desc(videoClips.createdAt)),
    db.select().from(pipelineRuns).where(eq(pipelineRuns.projectId, projectId)).orderBy(desc(pipelineRuns.createdAt)),
  ]);
  return { project: project[0], scripts: scriptRows, assets: assetRows, tasks: taskRows, compositions: compositionRows, clips: clipRows, runs: runRows };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  try {
    const rows = await projectRows(id);
    if (!rows.project) return apiError(req, "项目不存在", "Project not found", 404);
    return NextResponse.json({
      project: rows.project,
      workflow: rows.project.productionWorkflow,
      creativeIntent: rows.project.creativeIntent,
      visualBible: rows.project.visualBible,
      mediaInsights: rows.project.mediaInsights ?? [],
      snapshots: rows.project.versionSnapshots ?? [],
      semanticAssets: rows.assets.map(semanticAssetFromRecord),
      versionTree: buildVersionTree(rows),
      latestRun: rows.runs[0] ?? null,
      // Keep the latest successful video available while a newer local render is still running
      // or has failed; specific jobs are polled by composition id.
      latestComposition: rows.compositions.find((composition) => composition.status === "done") ?? rows.compositions[0] ?? null,
      latestFailure: [
        ...rows.tasks.filter((task) => task.status === "failed" || task.status === "unknown").map((task) => ({
          source: "task" as const,
          id: task.id,
          status: task.status,
          stage: task.mediaType,
          error: task.error || (task.status === "unknown" ? "Cloud task status is unknown after polling" : "Generation failed"),
          createdAt: task.updatedAt ?? task.createdAt,
        })),
        ...rows.runs.filter((run) => run.status === "failed").map((run) => ({
          source: "pipeline" as const,
          id: run.id,
          status: run.status,
          stage: run.stage,
          error: run.error || "Pipeline stage failed",
          createdAt: run.updatedAt ?? run.createdAt,
        })),
      ].sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))[0] ?? null,
      selectedScript: (() => {
        const script = rows.scripts.find((item) => item.selected) ?? rows.scripts[0];
        return script ? { id: script.id, shotCount: script.shots?.length ?? 0, totalDuration: script.totalDuration ?? 0 } : null;
      })(),
      counts: {
        scripts: rows.scripts.length,
        assets: rows.assets.length,
        clips: rows.clips.length,
        tasks: rows.tasks.length,
        compositions: rows.compositions.length,
      },
    });
  } catch (error) {
    console.error("Production overview failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "读取生产计划失败", "Failed to load production plan") }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  try {
    const body = await req.json() as Record<string, unknown>;
    const rows = await projectRows(id);
    if (!rows.project) return apiError(req, "项目不存在", "Project not found", 404);
    const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };

    if ("creativeIntent" in body) updates.creativeIntent = sanitizeCreativeIntent(body.creativeIntent);
    if ("visualBible" in body) updates.visualBible = sanitizeVisualBible(body.visualBible);
    if ("productionWorkflow" in body) {
      const workflow = sanitizeWorkflowPlan(body.productionWorkflow);
      if (!workflow) return apiError(req, "工作流格式无效", "Invalid workflow format", 400);
      updates.productionWorkflow = workflow;
    }
    if ("mediaInsight" in body) {
      const insight = sanitizeProjectMediaInsight(body.mediaInsight);
      if (!insight) return apiError(req, "媒体洞察格式无效", "Invalid media insight", 400);
      updates.mediaInsights = [insight, ...(rows.project.mediaInsights ?? []).filter((item) => item.id !== insight.id)].slice(0, 50);
    }
    if (typeof body.removeInsightId === "string") {
      updates.mediaInsights = (rows.project.mediaInsights ?? []).filter((item) => item.id !== body.removeInsightId);
    }
    if (body.action === "snapshot") {
      const selected = rows.scripts.find((script) => script.selected) ?? rows.scripts[0];
      const latestDone = rows.compositions.find((composition) => composition.status === "done");
      const snapshot: ProductionSnapshot = {
        id: crypto.randomUUID(),
        label: typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : `Snapshot ${(rows.project.versionSnapshots?.length ?? 0) + 1}`,
        createdAt: new Date().toISOString(),
        ...(selected && { scriptId: selected.id }),
        assetIds: rows.assets.filter((asset) => asset.status === "done").map((asset) => asset.id),
        ...(latestDone && { compositionId: latestDone.id }),
      };
      updates.versionSnapshots = [snapshot, ...(rows.project.versionSnapshots ?? [])].slice(0, 30);
    }

    if (Object.keys(updates).length === 1) return apiError(req, "没有可更新的生产数据", "No production data to update", 400);
    const db = getDb();
    const [updated] = await db.update(projects).set(updates).where(eq(projects.id, id)).returning();
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Production update failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "更新生产计划失败", "Failed to update production plan") }, { status: 500 });
  }
}
