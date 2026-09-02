import { NextResponse } from "next/server";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { aiTasks, batchJobItems, batchJobs, compositions, pipelineRuns, projects } from "@/lib/db/schema";
import { isPipelineRunActive } from "@/lib/pipeline-runner";
import { ACTIVE_AI_TASK_STATUSES } from "@/lib/ai-tasks";
import { requireApiIdentity } from "@/lib/saas/authorization";
import { projectRepository } from "@/lib/saas/project-repository";

/**
 * GET /api/tasks — the global task center feed: everything currently running (or
 * needing attention) across ALL projects, in one place. Until now "is my video
 * still rendering? did a paid task get stuck?" had no answer without opening each
 * project one by one — the unknown-status paid tasks were the worst case: money
 * already spent, recovery UI buried inside a single project's assets page.
 *
 * Buckets:
 * - active:    server pipelines, renders in flight, live paid tasks, a running batch
 * - attention: paid tasks that lost contact (already billed!), interrupted pipelines
 * - recent:    successful renders from the last 24h
 */
export async function GET() {
  try {
    const access = await requireApiIdentity();
    if (!access.ok) return access.response;
    const scopedProjectIds = access.identity
      ? (await projectRepository.getProjects(access.identity.user.id)).map((project) => project.id)
      : null;
    if (scopedProjectIds?.length === 0) {
      return NextResponse.json({ active: [], attention: [], recent: [] });
    }
    const db = getDb();
    const projectName = new Map<string, string>();
    const projectRows = scopedProjectIds
      ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, scopedProjectIds))
      : await db.select({ id: projects.id, name: projects.name }).from(projects);
    for (const p of projectRows) {
      projectName.set(p.id, p.name);
    }

    const active: Array<Record<string, unknown>> = [];
    const attention: Array<Record<string, unknown>> = [];

    // server-side pipelines: verify against the in-process registry; a "running" row whose
    // executor is gone (restart) is settled to failed and surfaced as resumable instead
    const runningPipelines = await db.select().from(pipelineRuns).where(and(
      eq(pipelineRuns.status, "running"),
      ...(scopedProjectIds ? [inArray(pipelineRuns.projectId, scopedProjectIds)] : []),
    ));
    const pipelineComposeIds = new Set<string>();
    for (const run of runningPipelines) {
      if (isPipelineRunActive(run.id)) {
        if (run.compositionId) pipelineComposeIds.add(run.compositionId);
        active.push({
          kind: "pipeline",
          id: run.id,
          projectId: run.projectId,
          projectName: projectName.get(run.projectId) ?? "",
          stage: run.stage,
          createdAt: run.createdAt,
        });
      } else {
        await db
          .update(pipelineRuns)
          .set({ status: "failed", error: "interrupted", updatedAt: new Date() })
          .where(and(eq(pipelineRuns.id, run.id), eq(pipelineRuns.status, "running")));
        attention.push({
          kind: "pipeline_interrupted",
          id: run.id,
          projectId: run.projectId,
          projectName: projectName.get(run.projectId) ?? "",
          stage: run.stage,
          createdAt: run.createdAt,
        });
      }
    }

    // renders in flight (skip ones already represented by their pipeline row)
    const composing = await db.select().from(compositions).where(and(
      eq(compositions.status, "composing"),
      ...(scopedProjectIds ? [inArray(compositions.projectId, scopedProjectIds)] : []),
    ));
    for (const c of composing) {
      if (pipelineComposeIds.has(c.id)) continue;
      active.push({
        kind: "compose",
        id: c.id,
        projectId: c.projectId,
        projectName: projectName.get(c.projectId) ?? "",
        label: c.label,
        createdAt: c.createdAt,
      });
    }

    // paid cloud tasks: live ones are informational; unknown = already billed, contact lost —
    // the row links straight to the project's recovery UI
    const paid = await db.select().from(aiTasks).where(and(
      inArray(aiTasks.status, ACTIVE_AI_TASK_STATUSES),
      ...(scopedProjectIds ? [inArray(aiTasks.projectId, scopedProjectIds)] : []),
    ));
    for (const tsk of paid) {
      (tsk.status === "unknown" ? attention : active).push({
        kind: tsk.status === "unknown" ? "paid_unknown" : "paid",
        id: tsk.id,
        projectId: tsk.projectId,
        projectName: tsk.projectId ? projectName.get(tsk.projectId) ?? "" : "",
        provider: tsk.provider,
        model: tsk.model,
        mediaType: tsk.mediaType,
        status: tsk.status,
        createdAt: tsk.createdAt,
      });
    }

    // a running batch job, with per-item progress counts
    const [job] = scopedProjectIds ? [] : await db
      .select()
      .from(batchJobs)
      .where(eq(batchJobs.status, "running"))
      .orderBy(desc(batchJobs.createdAt))
      .limit(1);
    if (job) {
      const items = await db.select().from(batchJobItems).where(eq(batchJobItems.jobId, job.id));
      active.push({
        kind: "batch",
        id: job.id,
        total: job.total,
        done: items.filter((i) => i.status === "done").length,
        failed: items.filter((i) => i.status === "failed").length,
        createdAt: job.createdAt,
      });
    }

    // recent wins: successful renders from the last 24h
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const recentRows = await db
      .select()
      .from(compositions)
      .where(and(
        eq(compositions.status, "done"),
        gt(compositions.createdAt, dayAgo),
        ...(scopedProjectIds ? [inArray(compositions.projectId, scopedProjectIds)] : []),
      ))
      .orderBy(desc(compositions.createdAt))
      .limit(8);
    const recent = recentRows.map((c) => ({
      kind: "done",
      id: c.id,
      projectId: c.projectId,
      projectName: projectName.get(c.projectId) ?? "",
      label: c.label,
      createdAt: c.createdAt,
    }));

    return NextResponse.json({ active, attention, recent });
  } catch (error) {
    console.error("获取任务中心数据失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取任务中心数据失败" },
      { status: 500 }
    );
  }
}
