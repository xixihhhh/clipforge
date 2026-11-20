import { NextResponse } from "next/server";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { reconcileTranscriptRenders } from "@/lib/transcript-render-runner";
import { getDb } from "@/lib/db";
import { aiTasks, batchJobItems, batchJobs, compositions, mediaEdits, pipelineRuns, projects } from "@/lib/db/schema";
import { isPipelineRunActive } from "@/lib/pipeline-runner";
import { outstandingAiTasks } from "@/lib/ai-tasks";
import { listLatestPipelineRuns } from "@/lib/pipeline-history";

/**
 * 汇总所有项目的运行任务、待恢复任务，以及最近 24 小时的成片。
 * 这里只读取状态；恢复和重新生成由用户在对应项目中发起。
 */
export async function GET() {
  try {
    reconcileTranscriptRenders();
    const db = getDb();
    const projectName = new Map<string, string>();
    for (const p of await db.select({ id: projects.id, name: projects.name }).from(projects)) {
      projectName.set(p.id, p.name);
    }

    const active: Array<Record<string, unknown>> = [];
    const attention: Array<Record<string, unknown>> = [];

    // server-side pipelines: verify against the in-process registry; a "running" row whose
    // executor is gone (restart) is settled to failed and surfaced as resumable instead
    const latestPipelines = listLatestPipelineRuns();
    const pipelineComposeIds = new Set<string>();
    for (const run of latestPipelines) {
      if (run.status === "running" && isPipelineRunActive(run.id)) {
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
        if (run.status === "running") {
          const settled = db
            .update(pipelineRuns)
            .set({ status: "failed", error: "interrupted", updatedAt: new Date() })
            .where(and(eq(pipelineRuns.id, run.id), eq(pipelineRuns.status, "running")))
            .returning().get();
          if (!settled) continue;
          Object.assign(run, settled);
        }
        if (run.status !== "failed") continue;
        attention.push({
          kind: run.error === "interrupted" ? "pipeline_interrupted" : "pipeline_failed",
          id: run.id,
          projectId: run.projectId,
          projectName: projectName.get(run.projectId) ?? "",
          stage: run.stage,
          createdAt: run.createdAt,
        });
      }
    }

    const transcriptRows = await db.select().from(mediaEdits).where(inArray(mediaEdits.status, ["queued", "rendering", "failed"])).orderBy(desc(mediaEdits.createdAt));
    const transcriptComposeIds = new Set(transcriptRows.map((edit) => edit.compositionId));
    for (const edit of transcriptRows) {
      (edit.status === "failed" ? attention : active).push({ kind: edit.status === "failed" ? "transcript_failed" : "transcript", id: edit.id, projectId: edit.projectId, projectName: projectName.get(edit.projectId) ?? "", sourceId: edit.sourceId, revision: edit.revision, progress: edit.progress, status: edit.status, createdAt: edit.createdAt });
    }

    // renders in flight (skip ones already represented by their pipeline row)
    const composing = await db.select().from(compositions).where(eq(compositions.status, "composing"));
    for (const c of composing) {
      if (pipelineComposeIds.has(c.id) || transcriptComposeIds.has(c.id)) continue;
      active.push({
        kind: "compose",
        id: c.id,
        projectId: c.projectId,
        projectName: projectName.get(c.projectId) ?? "",
        label: c.label,
        createdAt: c.createdAt,
      });
    }

    // 云端任务状态未知时提供恢复入口；提交状态不代表已结算扣费。
    const paid = await db.select().from(aiTasks).where(outstandingAiTasks());
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

    // 展示全部运行中的批次，一次读取它们的进度。
    const jobs = await db
      .select()
      .from(batchJobs)
      .where(eq(batchJobs.status, "running"))
      .orderBy(desc(batchJobs.createdAt));
    const items = jobs.length ? await db.select({ jobId: batchJobItems.jobId, status: batchJobItems.status })
      .from(batchJobItems).where(inArray(batchJobItems.jobId, jobs.map((job) => job.id))) : [];
    const counts = new Map<string, { done: number; failed: number }>();
    for (const item of items) {
      const count = counts.get(item.jobId) ?? { done: 0, failed: 0 };
      if (item.status === "done") count.done++;
      if (item.status === "failed") count.failed++;
      counts.set(item.jobId, count);
    }
    for (const job of jobs) {
      active.push({
        kind: "batch",
        id: job.id,
        total: job.total,
        done: counts.get(job.id)?.done ?? 0,
        failed: counts.get(job.id)?.failed ?? 0,
        createdAt: job.createdAt,
      });
    }

    // recent wins: successful renders from the last 24h
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const recentRows = await db
      .select()
      .from(compositions)
      .where(and(eq(compositions.status, "done"), gt(compositions.createdAt, dayAgo)))
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

    return NextResponse.json({ active, attention, recent }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("获取任务中心数据失败:", error);
    return NextResponse.json(
      { error: "获取任务中心数据失败" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
