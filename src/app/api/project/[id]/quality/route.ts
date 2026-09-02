import { requireProjectAccess } from "@/lib/saas/authorization";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { extname, join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { apiError, errText, pickLocale } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { assets, characters, generationReviews, projects, scripts } from "@/lib/db/schema";
import {
  buildShotQualityContract,
  qualityDisposition,
} from "@/lib/generation-quality";
import { evaluateGenerationQuality } from "@/lib/generation-quality-evaluator";
import { llmErrorPair } from "@/lib/llm-error";
import { probeMedia } from "@/lib/media-probe";
import { resolveUploadFilePath, toRemoteUsableImage } from "@/lib/remote-image";
import type { LLMConfig } from "@/lib/script-engine/generator";
import { generateContactSheet } from "@/lib/video-composer/contact-sheet";
import { LAST_FRAME_SUFFIX } from "@/lib/video-composer/frame-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

function parseConfig(value: unknown): LLMConfig | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.baseUrl !== "string" || typeof raw.apiKey !== "string" || typeof raw.model !== "string") return null;
  if (!raw.baseUrl.trim() || !raw.apiKey.trim() || !raw.model.trim()) return null;
  return {
    baseUrl: raw.baseUrl.trim(),
    apiKey: raw.apiKey.trim(),
    model: raw.model.trim(),
    ...(typeof raw.visionModel === "string" && raw.visionModel.trim() && { visionModel: raw.visionModel.trim() }),
  };
}

async function usableReference(ref: string | null | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  const converted = await toRemoteUsableImage(ref);
  return converted && (/^data:image\//.test(converted) || /^https?:\/\//.test(converted)) ? converted : undefined;
}

function publicReview(row: typeof generationReviews.$inferSelect) {
  return {
    id: row.id,
    assetId: row.assetId,
    shotId: row.shotId,
    contract: row.contract,
    report: row.report,
    disposition: row.disposition,
    evaluatorModel: row.evaluatorModel,
    verdict: row.verdict,
    humanDecision: row.humanDecision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  try {
    const db = getDb();
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) return apiError(req, "项目不存在", "Project not found", 404);
    const [assetRows, reviewRows] = await Promise.all([
      db.select().from(assets).where(and(eq(assets.projectId, id), eq(assets.status, "done"), eq(assets.type, "ai_generated"))).orderBy(desc(assets.createdAt)),
      db.select().from(generationReviews).where(eq(generationReviews.projectId, id)).orderBy(desc(generationReviews.createdAt)),
    ]);
    const latestByAsset = new Map<string, typeof generationReviews.$inferSelect>();
    for (const review of reviewRows) if (!latestByAsset.has(review.assetId)) latestByAsset.set(review.assetId, review);
    const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
    const aggregates = new Map<string, { reviews: number; overall: number; rejected: number }>();
    // Keep reassessments from inflating a model's score; only each candidate's latest review counts.
    for (const review of latestByAsset.values()) {
      const model = assetById.get(review.assetId)?.model;
      if (!model) continue;
      const current = aggregates.get(model) ?? { reviews: 0, overall: 0, rejected: 0 };
      current.reviews += 1;
      current.overall += review.report.overall;
      if (review.humanDecision === "rejected" || (!review.humanDecision && review.verdict === "reject")) current.rejected += 1;
      aggregates.set(model, current);
    }
    return NextResponse.json({
      candidates: assetRows.map((asset) => ({
        id: asset.id,
        shotId: asset.shotId,
        type: asset.type,
        filePath: asset.filePath,
        thumbnailPath: asset.thumbnailPath,
        provider: asset.provider,
        model: asset.model,
        prompt: asset.prompt,
        generationPlan: asset.generationPlan,
        selected: asset.selected,
        createdAt: asset.createdAt,
        latestReview: latestByAsset.has(asset.id) ? publicReview(latestByAsset.get(asset.id)!) : null,
      })),
      reviewCount: reviewRows.length,
      modelStats: [...aggregates.entries()].map(([model, value]) => ({
        model,
        reviews: value.reviews,
        averageOverall: Math.round(value.overall / value.reviews),
        rejectionRate: Math.round((value.rejected / value.reviews) * 1000) / 1000,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "读取质量记录失败", "Failed to load quality reviews") }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError(req, "无效的评估参数", "Invalid evaluation payload", 400);
  }
  const assetId = typeof body.assetId === "string" && SAFE_ID.test(body.assetId) ? body.assetId : "";
  const config = parseConfig(body.llmConfig);
  if (!assetId) return apiError(req, "请选择要评估的素材", "Choose an asset to evaluate", 400);
  if (!config) return apiError(req, "请先配置可看图的视觉模型", "Configure a vision-capable model first", 400);

  const db = getDb();
  const [[project], [asset], scriptRows, selectedAssets] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, id)).limit(1),
    db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.projectId, id))).limit(1),
    db.select().from(scripts).where(eq(scripts.projectId, id)).orderBy(desc(scripts.createdAt)),
    db.select().from(assets).where(and(eq(assets.projectId, id), eq(assets.selected, true))),
  ]);
  if (!project) return apiError(req, "项目不存在", "Project not found", 404);
  if (!asset?.filePath || asset.status !== "done") return apiError(req, "素材不存在或尚未就绪", "Asset not found or not ready", 404);
  const script = scriptRows.find((row) => row.selected) ?? scriptRows[0];
  const shot = script?.shots?.find((row) => row.shotId === asset.shotId);
  if (!shot) return apiError(req, "找不到素材对应的分镜", "The asset no longer matches a script shot", 400);
  const assetPath = resolveUploadFilePath(asset.filePath);
  if (!assetPath || !existsSync(assetPath)) return apiError(req, "素材文件不存在", "Asset file does not exist", 404);

  const shotIndex = script.shots?.findIndex((row) => row.shotId === shot.shotId) ?? -1;
  const previousShotId = shotIndex > 0 ? script.shots?.[shotIndex - 1]?.shotId : undefined;
  const previousAsset = selectedAssets.find((row) => row.shotId === previousShotId);
  const sourceKeyframe = await usableReference(asset.thumbnailPath);
  const productReference = await usableReference(project.productImages?.[0]);
  const characterId = shot.characterId || project.characterId;
  const [character] = characterId
    ? await db.select().from(characters).where(eq(characters.id, characterId)).limit(1)
    : [];
  const characterReference = await usableReference(character?.referenceImages?.[0]);
  let previousReference: string | undefined;
  if (previousAsset?.filePath) {
    const tail = VIDEO_EXT.test(previousAsset.filePath) ? `${previousAsset.filePath}${LAST_FRAME_SUFFIX}` : previousAsset.filePath;
    previousReference = await usableReference(tail) ?? await usableReference(previousAsset.thumbnailPath);
  }
  const mediaType = VIDEO_EXT.test(asset.filePath) ? "video" : "image";
  const contract = buildShotQualityContract({
    shot,
    mediaType,
    intent: project.creativeIntent,
    bible: project.visualBible,
    hasSourceKeyframe: Boolean(sourceKeyframe),
    hasProductReference: Boolean(productReference),
    hasCharacterReference: Boolean(characterReference),
    hasPreviousReference: Boolean(previousReference),
  });
  const references = [sourceKeyframe, productReference, characterReference, previousReference].filter((value): value is string => Boolean(value));

  const workingDir = await mkdtemp(join(tmpdir(), "clipforge-quality-"));
  try {
    let visualPath = assetPath;
    let sampleContext: string | undefined;
    if (mediaType === "video") {
      visualPath = join(workingDir, "contact-sheet.png");
      const metadata = await probeMedia(assetPath);
      const sheet = await generateContactSheet({ videoPath: assetPath, outPath: visualPath, frames: 8, thumbWidth: 220, waveHeight: 0 });
      sampleContext = `duration ${metadata.duration.toFixed(2)}s; ${sheet.cuts.length + 1} detected scenes; frame cells in chronological order at ${sheet.frameTimes.map((time) => `${time}s`).join(", ")}`;
    }
    const bytes = await readFile(visualPath);
    const ext = extname(visualPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    const report = await evaluateGenerationQuality({
      contract,
      outputImageDataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      referenceImageUrls: references,
      locale: pickLocale(req),
      config,
      sampleContext,
    });
    const priorRejectsForModel = asset.model
      ? (await db.select({ id: generationReviews.id }).from(generationReviews)
          .innerJoin(assets, eq(generationReviews.assetId, assets.id))
          .where(and(
            eq(generationReviews.projectId, id),
            eq(generationReviews.shotId, shot.shotId),
            eq(generationReviews.verdict, "reject"),
            eq(assets.model, asset.model),
          ))).length
      : 0;
    const disposition = qualityDisposition(report, { priorRejectsForModel });
    const [saved] = await db.insert(generationReviews).values({
      projectId: id,
      assetId: asset.id,
      shotId: asset.shotId,
      contract,
      report,
      disposition,
      evaluatorModel: config.visionModel || config.model,
      verdict: report.verdict,
    }).returning();
    return NextResponse.json(publicReview(saved));
  } catch (error) {
    console.error("Generation quality evaluation failed:", error);
    const pair = llmErrorPair(error);
    return NextResponse.json({ error: errText(req, `质量评估失败：${pair.zh}`, `Quality evaluation failed: ${pair.en}`) }, { status: 500 });
  } finally {
    await rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  try {
    const body = await req.json() as { reviewId?: unknown; decision?: unknown };
    const reviewId = typeof body.reviewId === "string" && SAFE_ID.test(body.reviewId) ? body.reviewId : "";
    const decision = body.decision === "accepted" || body.decision === "rejected" ? body.decision : null;
    if (!reviewId || !decision) return apiError(req, "评审决定无效", "Invalid review decision", 400);
    const db = getDb();
    const [review] = await db.select().from(generationReviews).where(and(eq(generationReviews.id, reviewId), eq(generationReviews.projectId, id))).limit(1);
    if (!review) return apiError(req, "评审记录不存在", "Quality review not found", 404);
    const [latestReview] = await db.select({ id: generationReviews.id }).from(generationReviews)
      .where(and(eq(generationReviews.assetId, review.assetId), eq(generationReviews.projectId, id)))
      .orderBy(desc(generationReviews.createdAt))
      .limit(1);
    if (latestReview?.id !== review.id) return apiError(req, "这份评审已被更新，请刷新后处理最新结果", "This review was superseded; refresh and decide on the latest result", 409);
    const [asset] = await db.select().from(assets).where(and(eq(assets.id, review.assetId), eq(assets.projectId, id))).limit(1);
    if (!asset) return apiError(req, "素材不存在", "Asset not found", 404);
    const [updated] = db.transaction((tx) => {
      if (decision === "accepted") {
        tx.update(assets).set({ selected: false }).where(and(eq(assets.projectId, id), eq(assets.shotId, asset.shotId))).run();
        tx.update(assets).set({ selected: true }).where(eq(assets.id, asset.id)).run();
      }
      return tx.update(generationReviews).set({ humanDecision: decision, updatedAt: new Date() }).where(eq(generationReviews.id, review.id)).returning().all();
    });
    return NextResponse.json(publicReview(updated));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "保存评审决定失败", "Failed to save review decision") }, { status: 500 });
  }
}
