import { requireProjectAccess } from "@/lib/saas/authorization";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { compositions, mediaEdits, mediaSources } from "@/lib/db/schema";
import { createTranscriptEditProposal } from "@/lib/transcript-edit-protocol";
import { startTranscriptRender } from "@/lib/transcript-render-runner";
import {
  DEFAULT_TRANSCRIPT_EDIT_PLAN,
  sanitizeTranscriptDocument,
} from "@/lib/transcript-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

function aspectRatio(width: number, height: number): "9:16" | "16:9" | "1:1" {
  const ratio = width / Math.max(1, height);
  return ratio > 1.2 ? "16:9" : ratio < 0.8 ? "9:16" : "1:1";
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id, mediaId } = await params;
  if (!SAFE_ID.test(id) || !SAFE_ID.test(mediaId)) return apiError(req, "无效的素材ID", "Invalid media ID", 400);
  try {
    const db = getDb();
    const [source] = await db.select().from(mediaSources)
      .where(and(eq(mediaSources.id, mediaId), eq(mediaSources.projectId, id))).limit(1);
    if (!source) return apiError(req, "素材不存在", "Media source not found", 404);
    const [latest] = await db.select().from(mediaEdits)
      .where(eq(mediaEdits.sourceId, source.id)).orderBy(desc(mediaEdits.revision)).limit(1);
    const transcript = sanitizeTranscriptDocument(source.transcript, source.duration / 1000);
    const offset = boundedInteger(req.nextUrl.searchParams.get("offset"), 0, 0, 100_000);
    const limit = boundedInteger(req.nextUrl.searchParams.get("limit"), 500, 1, 2_000);
    const words = transcript?.words.slice(offset, offset + limit) ?? [];
    return NextResponse.json({
      source: {
        id: source.id,
        projectId: source.projectId,
        originalName: source.originalName,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        duration: source.duration,
        width: source.width,
        height: source.height,
        hasAudio: source.hasAudio,
        status: source.status,
        language: source.language,
        model: source.model,
        device: source.device,
      },
      transcript: transcript ? {
        version: transcript.version,
        language: transcript.language,
        duration: transcript.duration,
        model: transcript.model,
        device: transcript.device,
        words,
        wordOffset: offset,
        wordLimit: limit,
        totalWords: transcript.words.length,
        hasMore: offset + words.length < transcript.words.length,
        silenceRanges: transcript.silenceRanges,
        createdAt: transcript.createdAt,
      } : null,
      latestRevision: latest?.revision ?? 0,
      latestPlan: latest?.plan ?? DEFAULT_TRANSCRIPT_EDIT_PLAN,
      latestEdit: latest ? {
        id: latest.id,
        revision: latest.revision,
        operationId: latest.operationId,
        baseRevision: latest.baseRevision,
        actor: latest.actor,
        status: latest.status,
        summary: latest.summary,
        compositionId: latest.compositionId,
        createdAt: latest.createdAt,
      } : null,
    });
  } catch (error) {
    console.error("Transcript edit inspect failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "读取剪辑计划失败", "Failed to inspect edit plan") }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id, mediaId } = await params;
  if (!SAFE_ID.test(id) || !SAFE_ID.test(mediaId)) return apiError(req, "无效的素材ID", "Invalid media ID", 400);
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = body.action === undefined ? "apply" : body.action;
    if (action !== "preview" && action !== "apply") return apiError(req, "不支持的剪辑操作", "Unsupported edit action", 400);

    const db = getDb();
    const [source] = await db.select().from(mediaSources)
      .where(and(eq(mediaSources.id, mediaId), eq(mediaSources.projectId, id))).limit(1);
    if (!source) return apiError(req, "素材不存在", "Media source not found", 404);
    const transcript = sanitizeTranscriptDocument(source.transcript, source.duration / 1000);
    if (source.status !== "ready" || !transcript) return apiError(req, "请先完成本地转写", "Complete local transcription first", 409);

    const [latest] = await db.select().from(mediaEdits)
      .where(eq(mediaEdits.sourceId, source.id)).orderBy(desc(mediaEdits.revision)).limit(1);
    const fallbackOperationId = crypto.randomUUID();
    const proposal = createTranscriptEditProposal({
      document: transcript,
      value: {
        ...body,
        actor: body.actor ?? "human",
        operationId: body.operationId ?? fallbackOperationId,
      },
      basePlan: latest?.plan ?? DEFAULT_TRANSCRIPT_EDIT_PLAN,
      latestRevision: latest?.revision ?? 0,
      fallbackOperationId,
    });

    if (action === "preview") return NextResponse.json({ proposal });

    const [existing] = await db.select().from(mediaEdits)
      .where(and(eq(mediaEdits.operationId, proposal.operationId), eq(mediaEdits.sourceId, source.id))).limit(1);
    if (existing) {
      return NextResponse.json({
        idempotent: true,
        edit: existing,
        compositionId: existing.compositionId,
        status: existing.status,
      });
    }
    if (proposal.conflict) {
      return NextResponse.json({
        error: errText(req, `剪辑版本已更新到 R${proposal.latestRevision}，请重新预演`, `The edit advanced to R${proposal.latestRevision}; preview again`),
        proposal,
      }, { status: 409 });
    }
    if (proposal.summary.outputDuration < 0.5) return apiError(req, "保留内容不足 0.5 秒", "Less than 0.5 seconds of content remains", 422);
    if (latest?.status === "queued" || latest?.status === "rendering") {
      return apiError(req, "已有剪辑版本正在生成，请完成后再试", "Another edit version is rendering", 409);
    }

    const created = db.transaction((tx) => {
      const transactionLatest = tx.select().from(mediaEdits)
        .where(eq(mediaEdits.sourceId, source.id)).orderBy(desc(mediaEdits.revision)).limit(1).get();
      const transactionRevision = transactionLatest?.revision ?? 0;
      if (transactionRevision !== proposal.latestRevision) throw new Error("EDIT_REVISION_CONFLICT");
      if (transactionLatest?.status === "queued" || transactionLatest?.status === "rendering") throw new Error("EDIT_BUSY");

      const composition = tx.insert(compositions).values({
        projectId: id,
        resolution: Math.min(source.width, source.height) >= 1000 ? "1080p" : "720p",
        aspectRatio: aspectRatio(source.width, source.height),
        duration: Math.round(proposal.summary.outputDuration * 1000),
        ttsEnabled: false,
        aigcBadge: false,
        label: `Text edit · R${proposal.nextRevision}`,
        status: "composing",
      }).returning().get();
      const edit = tx.insert(mediaEdits).values({
        projectId: id,
        sourceId: source.id,
        revision: proposal.nextRevision,
        operationId: proposal.operationId,
        baseRevision: proposal.baseRevision,
        actor: proposal.actor,
        plan: proposal.plan,
        keepRanges: proposal.keepRanges,
        summary: proposal.summary,
        compositionId: composition.id,
        status: "rendering",
      }).returning().get();
      return { composition, edit };
    });

    startTranscriptRender({
      editId: created.edit.id,
      compositionId: created.composition.id,
      revision: created.edit.revision,
      source,
      transcript,
      plan: proposal.plan,
      keepRanges: proposal.keepRanges,
    });
    return NextResponse.json({ proposal, edit: created.edit, compositionId: created.composition.id, status: "rendering" }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "EDIT_REVISION_CONFLICT") {
      return apiError(req, "剪辑版本已变化，请重新预演", "The edit revision changed; preview again", 409);
    }
    if (error instanceof Error && error.message === "EDIT_BUSY") {
      return apiError(req, "已有剪辑版本正在生成，请完成后再试", "Another edit version is rendering", 409);
    }
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
      return apiError(req, "相同剪辑操作已提交或版本已变化", "This edit was already submitted or the revision changed", 409);
    }
    console.error("Transcript edit start failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "启动文字剪辑失败", "Failed to start text edit") }, { status: 500 });
  }
}
