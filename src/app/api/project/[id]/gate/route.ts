import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { projects, scripts as scriptsTable, assets as assetsTable, compositions, generationReviews } from "@/lib/db/schema";
import { runQc, expectedDimensions, type QcReport } from "@/lib/video-composer/qc";
import { buildCreditsManifest, type BgmCredit, type CreditsManifest } from "@/lib/asset-credits";
import { checkPublishReadiness } from "@/lib/publish-readiness";
import {
  buildGateReport,
  gateItemFromAiPolicy,
  gateItemFromCredits,
  gateItemFromGenerationQuality,
  gateItemFromQc,
  gateItemFromReadiness,
  gateItemFromRealMix,
} from "@/lib/release-gate";
import { checkAiCommerceCompliance } from "@/lib/ai-commerce-compliance";
import { computeRealMix, shotReality } from "@/lib/real-mix";
import { apiError, errText } from "@/lib/api-error";
import type { Shot } from "@/lib/db/schema";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/gate — the release gate: one call aggregating the three pre-publish
 * checks that already exist as separate endpoints/pages (script publish-readiness, composed-video
 * QC, asset license manifest) into a single pass|warn|fail report. fail = objectively broken or
 * platform-risky, don't publish; warn = needs a human decision (license review / attribution).
 * body: { compositionId? } — QC defaults to the latest finished composition.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body */
  }

  const db = getDb();
  const [proj] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!proj) return apiError(req, "项目不存在", "Project not found", 404);

  try {
    // Fetch the composition first (or the explicitly requested one): the readiness check below
    // reads its aigcBadge flag to verify the visible AI-content label was actually burned in
    const compositionId =
      typeof body.compositionId === "string" && SAFE_ID.test(body.compositionId) ? body.compositionId : undefined;
    const [comp] = await db
      .select()
      .from(compositions)
      .where(
        compositionId
          ? and(eq(compositions.projectId, id), eq(compositions.id, compositionId))
          : and(eq(compositions.projectId, id), eq(compositions.status, "done"))
      )
      .orderBy(desc(compositions.createdAt))
      .limit(1);

    // 1) script readiness — prefer the selected script (what actually got composed), else the latest version
    const [selected] = await db
      .select()
      .from(scriptsTable)
      .where(and(eq(scriptsTable.projectId, id), eq(scriptsTable.selected, true)))
      .orderBy(desc(scriptsTable.version))
      .limit(1);
    const [latest] = selected
      ? [selected]
      : await db
          .select()
          .from(scriptsTable)
          .where(eq(scriptsTable.projectId, id))
          .orderBy(desc(scriptsTable.version))
          .limit(1);
    let readinessItem = gateItemFromReadiness(null, null);
    if (latest && Array.isArray(latest.shots) && latest.shots.length > 0) {
      const shots = latest.shots as Shot[];
      const total = latest.totalDuration ?? shots.reduce((s, x) => s + (x.duration || 0), 0);
      // product early-reveal rule only applies to commerce projects
      const productName = proj.contentType === "product" ? (proj.productName ?? undefined) : undefined;
      // aigcBadge tri-state: composition rows predating the column stay null → the check is skipped
      const aigcLabel = comp?.status === "done" && typeof comp.aigcBadge === "boolean" ? comp.aigcBadge : undefined;
      // the checker returns single-locale strings — run per locale on identical input and zip
      const zh = checkPublishReadiness(shots, total, { productName, aigcLabel, locale: "zh" });
      const en = checkPublishReadiness(shots, total, { productName, aigcLabel, locale: "en" });
      readinessItem = gateItemFromReadiness(zh, en);
    }

    // 2) composed-video QC — latest successful composition (from the shared query above)
    let qc: QcReport | null = null;
    if (comp?.outputPath && comp.status === "done") {
      const videoPath = existsSync(comp.outputPath) ? comp.outputPath : join(getDataDir(), comp.outputPath);
      if (existsSync(videoPath)) {
        const dims = expectedDimensions(comp.resolution, comp.aspectRatio);
        qc = await runQc(videoPath, {
          durationSec: comp.duration ? comp.duration / 1000 : undefined,
          ...(dims ?? {}),
        });
      }
    }

    // 3) asset license manifest — active done asset per shot + the BGM sidecar free-bgm writes
    const rows = await db
      .select()
      .from(assetsTable)
      .where(and(eq(assetsTable.projectId, id), eq(assetsTable.status, "done"), eq(assetsTable.selected, true)))
      .orderBy(desc(assetsTable.createdAt));
    const current = rows;
    const reviewRows = await db.select().from(generationReviews).where(eq(generationReviews.projectId, id)).orderBy(desc(generationReviews.createdAt));
    const latestReviewByAsset = new Map<string, typeof generationReviews.$inferSelect>();
    for (const review of reviewRows) if (!latestReviewByAsset.has(review.assetId)) latestReviewByAsset.set(review.assetId, review);
    const qualityRows = current.filter((row) => row.type === "ai_generated").map((row) => {
      const review = latestReviewByAsset.get(row.id);
      return {
        shotId: row.shotId,
        verdict: review?.verdict,
        humanDecision: review?.humanDecision,
        overall: review?.report.overall,
      };
    });
    let credits: CreditsManifest | null = null;
    if (current.length > 0) {
      let bgm: BgmCredit | null = null;
      if (comp?.bgmPath) {
        const bgmAbs = existsSync(comp.bgmPath) ? comp.bgmPath : join(getDataDir(), comp.bgmPath);
        try {
          bgm = JSON.parse(await readFile(`${bgmAbs}.credit.json`, "utf-8")) as BgmCredit;
        } catch {
          // no sidecar (paid/user BGM or track predating sidecars) — manifest simply omits the BGM entry
        }
      }
      credits = buildCreditsManifest(
        proj.name ?? proj.productName ?? id,
        current.map((r) => ({
          shotId: r.shotId,
          type: r.type,
          provider: r.provider,
          filePath: r.filePath,
          sourceUrl: r.sourceUrl,
          author: r.author,
          license: r.license,
        })),
        bgm
      );
    }

    // 4) AI-commerce platform policy (Douyin 2026-07 rules) — warn-only, nothing gets blocked
    const gateShots = latest && Array.isArray(latest.shots) ? (latest.shots as Shot[]) : [];
    const scriptCast = Array.isArray(latest?.characters) ? latest.characters : [];
    const hasAiPerson =
      gateShots.some((s) => !!s.characterId) || scriptCast.length > 0 || !!proj.characterId;
    const aiPolicyWarnings = checkAiCommerceCompliance({
      styleType: latest?.styleType,
      hasAiPerson,
      productText: [proj.productName, proj.productCategory].filter(Boolean).join(" "),
      dialogueText: gateShots.map((s) => s.voiceover || "").join(" \n "),
    });

    // 5) real/AI mix metering — informative only (Douyin hybrid-content traffic tilt at ≥50% real)
    const doneByShot = new Map(current.map((r) => [r.shotId, r]));
    const realMix =
      gateShots.length > 0
        ? computeRealMix(
            gateShots.map((s) => {
              const row = doneByShot.get(s.shotId);
              return {
                duration: s.duration || 0,
                reality: shotReality({ visualSource: s.visualSource, assetType: row?.type, done: !!row }),
              };
            })
          )
        : null;

    const report = buildGateReport([
      readinessItem,
      gateItemFromQc(qc),
      gateItemFromGenerationQuality(qualityRows),
      gateItemFromCredits(credits),
      gateItemFromAiPolicy(aiPolicyWarnings),
      gateItemFromRealMix(realMix),
    ]);
    return NextResponse.json({
      projectId: id,
      compositionId: comp?.status === "done" ? comp.id : null,
      report,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : errText(req, "发布门禁运行失败", "Release gate failed to run") },
      { status: 500 }
    );
  }
}
