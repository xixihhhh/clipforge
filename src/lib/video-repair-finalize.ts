import { existsSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";
import { eq } from "drizzle-orm";
import { persistAssetSource, saveAssetCandidate } from "@/lib/asset-persistence";
import { getDb } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { getDataDir } from "@/lib/paths";
import { resolveUploadFilePath } from "@/lib/remote-image";
import { sanitizeVideoRepairSummary, type VideoRepairSummary } from "@/lib/video-repair-plan";
import { extractFirstFrame, THUMB_SUFFIX } from "@/lib/video-composer/frame-extract";
import { renderVideoRepair } from "@/lib/video-repair-render";

/** Merge a generated replacement segment into the original shot and save one full-shot candidate. */
export async function finalizeVideoRepair(input: {
  projectId: string;
  summary: VideoRepairSummary;
  resultUrl: string;
  prompt: string;
  thumbnailPath?: string | null;
}) {
  const summary = sanitizeVideoRepairSummary(input.summary);
  if (!summary) throw new Error("修复计划已失效，请重新预演");
  const db = getDb();
  const existingRows = await db.select().from(assets).where(eq(assets.projectId, input.projectId));
  const existing = existingRows.find((row) => row.generationPlan && "kind" in row.generationPlan
    && row.generationPlan.kind === "repair"
    && row.generationPlan.operationId === summary.operationId);
  if (existing) return existing;

  const source = existingRows.find((row) => row.id === summary.sourceAssetId);
  if (!source?.filePath || source.status !== "done") throw new Error("原镜头不存在或尚未就绪");
  const sourcePath = resolveUploadFilePath(source.filePath);
  if (!sourcePath || !existsSync(sourcePath)) throw new Error("原镜头文件不存在");

  const replacementUrl = await persistAssetSource(
    input.projectId,
    input.resultUrl,
    summary.shotId,
    `repair-segment-${summary.operationId}`,
  );
  const replacementPath = resolveUploadFilePath(replacementUrl);
  if (!replacementPath) throw new Error("替换片段无法落到本地");
  const outputFileName = `repair-${summary.operationId}.mp4`;
  const outputPath = join(getDataDir(), "uploads", input.projectId, outputFileName);
  try {
    await renderVideoRepair({
      sourcePath,
      replacementPath,
      outputPath,
      window: summary.window,
      contentId: `${input.projectId}:${summary.operationId}`,
    });
    const generatedThumbnail = await extractFirstFrame(outputPath);
    return await saveAssetCandidate({
      projectId: input.projectId,
      scriptId: source.scriptId,
      shotId: summary.shotId,
      type: "ai_generated",
      filePath: `/api/files/${input.projectId}/${outputFileName}`,
      thumbnailPath: generatedThumbnail
        ? `/api/files/${input.projectId}/${outputFileName}${THUMB_SUFFIX}`
        : input.thumbnailPath ?? source.thumbnailPath ?? undefined,
      provider: summary.provider,
      model: summary.model,
      prompt: input.prompt,
      generationPlan: summary,
    });
  } finally {
    if (replacementPath !== sourcePath && replacementPath !== outputPath) {
      await rm(replacementPath, { force: true }).catch(() => undefined);
    }
  }
}
