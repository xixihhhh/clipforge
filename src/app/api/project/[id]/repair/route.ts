import { requireProjectAccess } from "@/lib/saas/authorization";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiError, errText } from "@/lib/api-error";
import { recordAiTask, updateAiTask } from "@/lib/ai-tasks";
import { getDb } from "@/lib/db";
import { assets, generationReviews } from "@/lib/db/schema";
import { probeMedia } from "@/lib/media-probe";
import { createProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/base";
import { resolveUploadFilePath, toRemoteUsableImage } from "@/lib/remote-image";
import {
  buildVideoRepairPreview,
  sanitizeTimedKeyframes,
  sanitizeVideoRepairSummary,
  type RepairScope,
  type RepairWindow,
  type VideoRepairPreview,
} from "@/lib/video-repair-plan";
import { finalizeVideoRepair } from "@/lib/video-repair-finalize";
import { extractFrameAtTime } from "@/lib/video-composer/frame-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

interface RepairRequest {
  action?: "preview" | "execute" | "finalize";
  assetId?: string;
  reviewId?: string;
  provider?: string;
  model?: string;
  supportsAudio?: boolean;
  pricePerCall?: number;
  window?: Partial<RepairWindow>;
  scope?: RepairScope;
  region?: unknown;
  keyframes?: unknown;
  operationId?: string;
  planHash?: string;
  confirmed?: boolean;
  apiKey?: string;
  baseUrl?: string;
  resultUrl?: string;
  plan?: unknown;
}

async function loadRepairContext(projectId: string, assetId: string, reviewId: string) {
  const db = getDb();
  const [[asset], [review], projectAssets] = await Promise.all([
    db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.projectId, projectId))).limit(1),
    db.select().from(generationReviews).where(and(eq(generationReviews.id, reviewId), eq(generationReviews.projectId, projectId))).limit(1),
    db.select().from(assets).where(eq(assets.projectId, projectId)),
  ]);
  if (!asset?.filePath || asset.status !== "done" || !VIDEO_EXT.test(asset.filePath)) throw new Error("请选择已完成的视频候选");
  if (!review || review.assetId !== asset.id) throw new Error("评估记录与候选不匹配，请刷新后重试");
  const sourcePath = resolveUploadFilePath(asset.filePath);
  if (!sourcePath || !existsSync(sourcePath)) throw new Error("原镜头文件不存在");
  const metadata = await probeMedia(sourcePath);
  if (metadata.duration <= 0) throw new Error("无法读取原镜头时长");
  return { asset, review, projectAssets, sourcePath, metadata };
}

async function compilePreview(projectId: string, body: RepairRequest, forceOperationId?: string): Promise<{
  preview: VideoRepairPreview;
  context: Awaited<ReturnType<typeof loadRepairContext>>;
}> {
  const assetId = typeof body.assetId === "string" && SAFE_ID.test(body.assetId) ? body.assetId : "";
  const reviewId = typeof body.reviewId === "string" && SAFE_ID.test(body.reviewId) ? body.reviewId : "";
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!assetId || !reviewId || !provider || !model) throw new Error("缺少候选、评估、平台或模型");
  const context = await loadRepairContext(projectId, assetId, reviewId);
  const requestedKeyframes = sanitizeTimedKeyframes(body.keyframes, context.metadata.duration);
  const allowedIds = new Set(context.projectAssets.filter((row) => row.filePath && !VIDEO_EXT.test(row.filePath)).map((row) => row.id));
  if (requestedKeyframes.some((keyframe) => !allowedIds.has(keyframe.assetId))) throw new Error("时间锚点必须使用当前项目中的图片素材");
  const operationId = forceOperationId
    ?? (typeof body.operationId === "string" && SAFE_ID.test(body.operationId) ? body.operationId : crypto.randomUUID());
  const preview = buildVideoRepairPreview({
    operationId,
    sourceAssetId: context.asset.id,
    reviewId: context.review.id,
    shotId: context.asset.shotId,
    provider,
    model,
    supportsAudio: body.supportsAudio === true,
    sourceDuration: context.metadata.duration,
    report: context.review.report,
    contract: context.review.contract,
    requestedWindow: body.window,
    requestedScope: body.scope,
    requestedRegion: body.region,
    keyframes: requestedKeyframes,
    sourceUploadAvailable: provider === "atlas-cloud",
    pricePerCall: body.pricePerCall,
  });
  return { preview, context };
}

function imageDataUrl(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

async function executeRepair(projectId: string, body: RepairRequest) {
  if (body.confirmed !== true) throw new Error("请先确认修复计划与预计费用");
  if (!body.apiKey?.trim()) throw new Error("缺少 API Key，请先在设置中配置对应平台");
  if (!body.operationId || !SAFE_ID.test(body.operationId)) throw new Error("修复计划标识无效，请重新预演");
  const { preview, context } = await compilePreview(projectId, body, body.operationId);
  if (preview.summary.planHash !== body.planHash) throw new Error("修复参数已变化，请重新预演并确认费用");
  if (!preview.executable) throw new Error("当前平台或模型不能安全执行这份修复计划");
  const provider = createProvider({ name: preview.summary.provider, apiKey: body.apiKey.trim(), baseUrl: body.baseUrl || "" });
  if (!provider.uploadLocalMedia || !provider.submitVideoTask || !provider.waitForTask) {
    throw new Error("当前平台缺少可恢复的参考视频任务能力，未提交也未产生费用");
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), "clipforge-repair-"));
  try {
    const startFrame = join(workingDirectory, "start.jpg");
    const endFrame = join(workingDirectory, "end.jpg");
    const endTime = Math.min(Math.max(0, context.metadata.duration - 0.05), preview.summary.window.end);
    const [startResult, endResult, sourceVideoUrl] = await Promise.all([
      extractFrameAtTime(context.sourcePath, preview.summary.window.start, startFrame),
      extractFrameAtTime(context.sourcePath, endTime, endFrame),
      provider.uploadLocalMedia(context.sourcePath),
    ]);
    if (!startResult || !endResult) throw new Error("修复边界帧提取失败，未提交付费任务");
    const extraImages: string[] = [];
    for (const keyframe of preview.summary.keyframes) {
      const asset = context.projectAssets.find((row) => row.id === keyframe.assetId);
      const usable = asset?.filePath ? await toRemoteUsableImage(asset.filePath) : undefined;
      if (!usable) throw new Error(`时间锚点 ${keyframe.assetId} 无法安全传给模型，未提交付费任务`);
      extraImages.push(usable);
    }
    const referenceImageUrls = [
      imageDataUrl(await readFile(startResult)),
      imageDataUrl(await readFile(endResult)),
      ...extraImages,
    ];
    const { taskId, modelId } = await provider.submitVideoTask({
      modelId: preview.summary.model,
      mode: "video-to-video",
      prompt: preview.prompt,
      duration: preview.summary.generatedDuration,
      width: context.metadata.width,
      height: context.metadata.height,
      referenceVideoUrls: [sourceVideoUrl],
      referenceImageUrls,
      audioEnabled: false,
    });
    const rowId = await recordAiTask({
      projectId,
      shotId: preview.summary.shotId,
      provider: preview.summary.provider,
      model: modelId,
      mediaType: "video",
      mode: "video-to-video",
      prompt: preview.prompt,
      taskId,
      controlPlan: preview.summary,
    });
    try {
      const status = await provider.waitForTask(taskId, { interval: 5000 });
      const result = status.result;
      const videoUrls = result && "videoUrls" in result ? result.videoUrls : undefined;
      if (!videoUrls?.length) {
        await updateAiTask(rowId, { status: "unknown", error: "任务完成但未返回替换视频地址" });
        return { error: "任务完成但未返回替换视频地址", taskId, recoverable: true, status: 502 };
      }
      try {
        const asset = await finalizeVideoRepair({
          projectId,
          summary: preview.summary,
          resultUrl: videoUrls[0],
          prompt: preview.prompt,
          thumbnailPath: context.asset.thumbnailPath,
        });
        await updateAiTask(rowId, { status: "completed", resultUrls: videoUrls, error: null });
        return { asset, taskId, plan: preview.summary, status: 200 };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateAiTask(rowId, { status: "unknown", resultUrls: videoUrls, error: `远端已完成，本地拼接待恢复：${message}` });
        return { error: `${message}。远端结果已保存，可在素材页恢复本地拼接`, taskId, recoverable: true, plan: preview.summary, status: 500 };
      }
    } catch (error) {
      const failed = error instanceof ProviderError && error.code === "TASK_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      await updateAiTask(rowId, { status: failed ? "failed" : "unknown", error: message });
      return {
        error: failed ? message : `${message}。任务 ID ${taskId} 已保存，可在素材页恢复，请勿重复提交`,
        taskId,
        recoverable: !failed,
        plan: preview.summary,
        status: failed ? 500 : 504,
      };
    }
  } finally {
    await rm(workingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  let body: RepairRequest;
  try {
    body = await req.json();
  } catch {
    return apiError(req, "无效的修复参数", "Invalid repair payload", 400);
  }
  try {
    if (body.action === "finalize") {
      const summary = sanitizeVideoRepairSummary(body.plan);
      if (!summary || !body.resultUrl) return apiError(req, "修复结果或计划无效", "Invalid repair result or plan", 400);
      const { preview, context } = await compilePreview(id, {
        ...body,
        assetId: summary.sourceAssetId,
        reviewId: summary.reviewId,
        provider: summary.provider,
        model: summary.model,
        pricePerCall: summary.estimatedCostUsd,
        window: summary.window,
        scope: summary.requestedScope,
        region: summary.region,
        keyframes: summary.keyframes,
      }, summary.operationId);
      if (preview.summary.planHash !== summary.planHash) return apiError(req, "修复计划已变化，请重新预演", "The repair plan changed; preview it again", 409);
      const asset = await finalizeVideoRepair({ projectId: id, summary, resultUrl: body.resultUrl, prompt: preview.prompt, thumbnailPath: context.asset.thumbnailPath });
      return NextResponse.json({ asset, plan: summary });
    }
    if (body.action === "execute") {
      const result = await executeRepair(id, body);
      const { status, ...payload } = result;
      return NextResponse.json(payload, { status });
    }
    const { preview } = await compilePreview(id, body);
    return NextResponse.json(preview);
  } catch (error) {
    console.error("Video repair failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "精准修复失败", "Video repair failed") }, { status: 400 });
  }
}
