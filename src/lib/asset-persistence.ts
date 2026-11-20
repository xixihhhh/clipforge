import { writableShot, sameShot } from "@/lib/shot-ownership";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { assets, aiTasks } from "@/lib/db/schema";
import { validateOrDelete } from "@/lib/media-validate";
import { getDataDir } from "@/lib/paths";
import { MAX_DOWNLOAD_BYTES } from "@/lib/providers/stock-types";
import { resolveUploadFilePath } from "@/lib/remote-image";
import { sanitizeGenerationControlSummary, type GenerationControlSummary } from "@/lib/video-repair-plan";
import { extractLastFrame, LAST_FRAME_SUFFIX } from "@/lib/video-composer/frame-extract";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

function extensionForMime(mime: string): "png" | "webp" | "mp4" | "jpg" {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("mp4") || mime.includes("video")) return "mp4";
  return "jpg";
}

async function assertValidMedia(absPath: string, ext: string): Promise<void> {
  const kind = ext === "mp4" ? "video" : "image";
  if (!(await validateOrDelete(absPath, kind))) throw new Error("素材文件校验失败（下载内容损坏或非媒体文件），请重新生成");
}

/** Persist an expiring provider URL or data URI under the project's uploads directory. */
export async function persistAssetSource(projectId: string, sourceUrl: string, shotId: number, prefix = "asset"): Promise<string> {
  if (!SAFE_ID.test(projectId)) throw new Error("无效的项目ID");
  if (sourceUrl.startsWith("/api/files/")) {
    const local = resolveUploadFilePath(sourceUrl);
    if (!local || !existsSync(local)) throw new Error("本地素材文件不存在");
    return sourceUrl;
  }

  let bytes: Buffer;
  let mime = "image/jpeg";
  if (sourceUrl.startsWith("data:")) {
    const comma = sourceUrl.indexOf(",");
    if (comma === -1) throw new Error("无法解析 data URI 素材");
    const meta = sourceUrl.slice(5, comma);
    const payload = sourceUrl.slice(comma + 1);
    mime = meta.split(";")[0] || "image/png";
    bytes = /;base64/i.test(meta) ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  } else if (/^https?:\/\//.test(sourceUrl)) {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`下载素材失败: ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) throw new Error(`素材体积 ${declared} 超过上限 ${MAX_DOWNLOAD_BYTES}`);
    bytes = Buffer.from(await response.arrayBuffer());
    mime = response.headers.get("content-type") || mime;
  } else {
    throw new Error("不支持的素材来源");
  }

  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`素材体积 ${bytes.byteLength} 超过上限 ${MAX_DOWNLOAD_BYTES}`);
  const ext = extensionForMime(mime);
  const directory = join(getDataDir(), "uploads", projectId);
  await mkdir(directory, { recursive: true });
  const safePrefix = prefix.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40) || "asset";
  const fileName = `${safePrefix}-${shotId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const absolutePath = join(directory, fileName);
  await writeFile(absolutePath, bytes);
  await assertValidMedia(absolutePath, ext);
  return `/api/files/${projectId}/${fileName}`;
}

export interface SaveAssetCandidateInput {
  projectId: string;
  scriptId?: string | null;
  providerTaskId?: string;
  shotId: number;
  filePath: string;
  type?: "ai_generated" | "product_image" | "user_upload" | "stock_footage";
  thumbnailPath?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  generationPlan?: GenerationControlSummary | null;
}

/** Insert a validated take and atomically make it the active composition input. */
export async function saveAssetCandidate(input: SaveAssetCandidateInput) {
  if (!SAFE_ID.test(input.projectId)) throw new Error("无效的项目ID");
  const db = getDb();
  let lastFrameUrl: string | undefined;
  if (VIDEO_EXT.test(input.filePath) && input.filePath.startsWith(`/api/files/${input.projectId}/`)) {
    const absolutePath = resolveUploadFilePath(input.filePath);
    if (!absolutePath || !existsSync(absolutePath)) throw new Error("本地素材文件不存在");
    const frame = await extractLastFrame(absolutePath);
    if (frame) lastFrameUrl = `${input.filePath}${LAST_FRAME_SUFFIX}`;
  }
  const generationPlan = input.generationPlan ? sanitizeGenerationControlSummary(input.generationPlan) : null;
  const rows = db.transaction((transaction) => {
    const task = input.providerTaskId && transaction.select().from(aiTasks).where(and(eq(aiTasks.provider, input.provider ?? ""), eq(aiTasks.taskId, input.providerTaskId), eq(aiTasks.projectId, input.projectId))).get();
    if (input.providerTaskId && !task) throw new Error("未找到此项目的生成任务");
    if (task && (task.shotId !== input.shotId || task.scriptId !== input.scriptId)) throw new Error("任务不属于此脚本分镜");
    if (task && task.deliveredAssetId) {
      const delivered = transaction.select().from(assets).where(eq(assets.id, task.deliveredAssetId)).get();
      if (delivered) return [delivered];
    }
    const scriptId = writableShot(input.projectId, input.scriptId, input.shotId, transaction);
    transaction.update(assets).set({ selected: false }).where(sameShot(input.projectId, scriptId, input.shotId)).run();
    const inserted = transaction.insert(assets).values({
      projectId: input.projectId,
      scriptId,
      shotId: input.shotId,
      type: input.type ?? "ai_generated",
      filePath: input.filePath,
      ...(input.thumbnailPath?.startsWith("/api/files/") && { thumbnailPath: input.thumbnailPath }),
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      generationPlan,
      selected: true,
      status: "done",
    }).returning().all();
    if (task) transaction.update(aiTasks).set({ deliveredAssetId: inserted[0].id, awaitingAsset: false, status: "completed" }).where(eq(aiTasks.id, task.id)).run();
    return inserted;
  });
  return { ...rows[0], ...(lastFrameUrl && { lastFrameUrl }) };
}
