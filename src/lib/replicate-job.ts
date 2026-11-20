import { and, eq, isNull } from "drizzle-orm";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getDb } from "@/lib/db";
import { aiTasks, compositions, projects } from "@/lib/db/schema";
import { getDataDir } from "@/lib/paths";
import { probeMedia } from "@/lib/media-probe";
import type { AIProvider, VideoOptions } from "@/lib/providers/types";
import { ProviderError } from "@/lib/providers/base";

type Job = typeof aiTasks.$inferSelect;
const MAX_VIDEO = 200 * 1024 * 1024;
const uncertain = "任务提交结果待确认，请检查平台任务记录。为避免重复扣费，本项目不会自动重提。";
const unresolved = (id: string) => and(eq(aiTasks.id, id), isNull(aiTasks.compositionId));

export function replicaForProject(projectId: string) {
  return getDb().select().from(aiTasks).where(and(eq(aiTasks.projectId, projectId), eq(aiTasks.purpose, "replicate"))).get();
}

// A lost acknowledgement can only be reconciled using the ID the user verified in
// the provider dashboard. Binding an existing ID never calls the submission API.
export function attachReplicaTask(projectId: string, provider: string, taskId: string) {
  if (!taskId.trim() || taskId.length > 512) throw new Error("无效的平台任务 ID");
  const db = getDb();
  return db.transaction(tx => {
    const job = tx.select().from(aiTasks).where(and(eq(aiTasks.projectId, projectId), eq(aiTasks.purpose, "replicate"))).get();
    if (!job || job.provider !== provider || job.status === "failed") throw new Error("此项目没有可绑定的复刻任务");
    if (job.taskId) {
      if (job.taskId !== taskId) throw new Error("已绑定其他平台任务");
      return job;
    }
    const other = tx.select({id: aiTasks.id}).from(aiTasks).where(and(eq(aiTasks.provider,provider),eq(aiTasks.taskId,taskId))).get();
    if (other) throw new Error("此平台任务已经绑定到其他操作");
    return tx.update(aiTasks).set({taskId, status:"submitted", error:null, updatedAt:new Date()}).where(eq(aiTasks.id,job.id)).returning().get();
  });
}

function output(job: Job) {
  return { compositionId: job.id, url: `/api/output/${job.projectId}/replicate-${job.id}.mp4`, taskId: job.taskId, status: "completed" };
}

class DownloadError extends Error {
  constructor(readonly status: number) { super(`复刻视频下载失败 HTTP ${status}`); }
}

async function deliver(job: Job, resultUrl: string) {
  const dir = join(getDataDir(), "output", job.projectId!);
  const target = join(dir, `replicate-${job.id}.mp4`);
  // Rename only complete, probed files into place. An interrupted download can be retried.
  if (!(await stat(target).catch(() => null))?.isFile()) {
    if (!/^https?:\/\//i.test(resultUrl)) throw new Error("复刻结果没有可下载的视频地址");
    const response = await fetch(resultUrl, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new DownloadError(response.status);
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.${crypto.randomUUID()}.part`;
    let bytes = 0;
    try {
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), new Transform({
        transform(chunk, _, done) {
          bytes += chunk.length;
          done(bytes > MAX_VIDEO ? new Error("复刻视频超过 200MB") : null, chunk);
        },
      }), createWriteStream(tmp, { flags: "wx" }));
      const meta = await probeMedia(tmp);
      if (!meta.duration || !meta.width || !meta.height) throw new Error("复刻结果不是可播放视频");
      try {
        await rename(tmp, target);
      } catch (error) {
        // Windows may refuse a replacement while the first concurrent finalizer probes the file.
        const code = (error as NodeJS.ErrnoException).code;
        if ((code !== "EEXIST" && code !== "EPERM") || !(await stat(target).catch(() => null))?.isFile()) throw error;
      }
    } finally { await rm(tmp, { force: true }); }
  }
  const meta = await probeMedia(target);
  const db = getDb();
  db.transaction(tx => {
    tx.insert(compositions).values({ id: job.id, projectId: job.projectId!, outputPath: target,
      duration: Math.round(meta.duration * 1000), aspectRatio: meta.height >= meta.width ? "9:16" : "16:9",
      status: "done", aigcBadge: false }).onConflictDoNothing({ target: compositions.id }).run();
    tx.update(aiTasks).set({ compositionId: job.id, status: "completed", error: null, updatedAt: new Date() }).where(eq(aiTasks.id, job.id)).run();
  });
  return output(job);
}

async function fetchResult(job: Job, provider: AIProvider) {
  if (!provider.waitForTask) throw new Error("该平台不支持任务恢复");
  const state = await provider.waitForTask(job.taskId, { interval: 5000 });
  if (state.status === "failed" || state.status === "cancelled") throw new ProviderError(state.error || "复刻任务失败", "TASK_FAILED", job.provider);
  const url = state.result && "videoUrls" in state.result ? state.result.videoUrls[0] : undefined;
  if (!url) throw new Error("视频结果尚不可用，请恢复查询");
  getDb().update(aiTasks).set({ resultUrls: [url], updatedAt: new Date() }).where(unresolved(job.id)).run();
  return url;
}

export async function recoverReplica(job: Job, provider: AIProvider) {
  if (job.compositionId) return output(job);
  if (job.status === "failed") throw new ProviderError(job.error || "复刻任务失败", "TASK_FAILED", job.provider);
  if (!job.taskId) throw new Error(job.error || uncertain);
  const db = getDb();
  try {
    const cached = job.resultUrls?.[0];
    if (cached) {
      try { return await deliver(job, cached); }
      catch (error) {
        if (!(error instanceof DownloadError) || ![401, 403, 404, 410].includes(error.status)) throw error;
        db.update(aiTasks).set({ resultUrls: null }).where(unresolved(job.id)).run();
      }
    }
    return await deliver(job, await fetchResult(job, provider));
  } catch (error) {
    // A provider URL may expire during a restart. A later recovery re-queries the same task ID.
    const failed = error instanceof ProviderError && error.code === "TASK_FAILED";
    db.update(aiTasks).set({ status: failed ? "failed" : "unknown", resultUrls: null,
      error: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(unresolved(job.id)).run();
    const current = replicaForProject(job.projectId!);
    if (current?.compositionId) return output(current);
    throw error;
  }
}

export async function submitReplica(projectId: string, provider: AIProvider, options: VideoOptions) {
  if (!provider.submitVideoTask || !provider.waitForTask) throw new Error("该平台不支持可恢复的复刻生成");
  const db = getDb();
  const project = db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new Error("项目不存在");
  // Persist the claim BEFORE the first billable POST. Even if the acknowledgement is lost,
  // a second click, another worker, or a restart can never submit again for this operation.
  const job = db.insert(aiTasks).values({ projectId, purpose: "replicate", provider: provider.name,
    model: options.modelId, prompt: options.prompt, mode: "video-to-video", taskId: "", status: "unknown" })
    .onConflictDoNothing().returning().get();
  if (!job) {
    const existing = replicaForProject(projectId)!;
    if (existing.provider !== provider.name) throw new Error("请使用原复刻任务的平台恢复");
    return recoverReplica(existing, provider);
  }
  try {
    const { taskId, modelId } = await provider.submitVideoTask(options);
    if (!taskId) throw new Error(uncertain);
    db.update(aiTasks).set({ taskId, model: modelId, status: "submitted", updatedAt: new Date() }).where(eq(aiTasks.id, job.id)).run();
    job.taskId = taskId;
  } catch (error) {
    const rejected = error instanceof ProviderError && (error.code === "TASK_FAILED" || [400, 401, 402, 403, 404, 422].includes(error.statusCode ?? 0));
    db.update(aiTasks).set({ status: rejected ? "failed" : "unknown", error: rejected ? error.message : uncertain, updatedAt: new Date() }).where(unresolved(job.id)).run();
    if (rejected) throw new ProviderError(error.message, "TASK_FAILED", provider.name);
    throw error;
  }
  return recoverReplica(job, provider);
}
