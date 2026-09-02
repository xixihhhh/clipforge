import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { projects, compositions } from "@/lib/db/schema";
import { generateShopQr } from "@/lib/shop-qr";
import { generateEndCard } from "@/lib/video-composer/end-card";
import { resolveChineseFontFile } from "@/lib/video-composer/composer";
import { getOffSiteQrPolicy } from "@/lib/platform-specs";
import { apiError, errText } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;

/**
 * POST /api/project/[id]/end-card — burn a "scan to buy" QR onto the last few seconds of the latest
 * composed video (post-process on the finished mp4; does not touch the compose pipeline).
 * The QR encodes the project's UTM-tagged shop link. body: { url?, platform?, seconds?, ctaText?, force? }
 * ctaText is opt-in (off by default) because it can collide with the video's own end overlays.
 * Platform QR gate: douyin refuses by default (off-site-diversion enforcement; force:true overrides),
 * other domestic platforms return the video plus a `warning`; overseas platforms pass clean.
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

  const shopUrl = (typeof body.url === "string" && body.url.trim()) || proj.shopUrl || "";
  if (!shopUrl) {
    return apiError(req, "该项目没有商品链接，请先设置或用 url 传入", "This project has no shop link; set one or pass a url", 400);
  }

  const [comp] = await db
    .select()
    .from(compositions)
    // latest *successful* composition — a failed retry on top must not hide a good take
    .where(and(eq(compositions.projectId, id), eq(compositions.status, "done")))
    .orderBy(desc(compositions.createdAt))
    .limit(1);
  if (!comp?.outputPath || comp.status !== "done") {
    return apiError(req, "请先合成视频再生成片尾二维码", "Please compose the video before adding the end-card QR");
  }
  const videoPath = existsSync(comp.outputPath) ? comp.outputPath : join(getDataDir(), comp.outputPath);
  if (!existsSync(videoPath)) return apiError(req, "成片文件不存在", "The composed video file does not exist", 404);

  const platform = typeof body.platform === "string" ? body.platform : undefined;
  const seconds = typeof body.seconds === "number" ? body.seconds : undefined;
  const ctaText = typeof body.ctaText === "string" && body.ctaText.trim() ? body.ctaText.trim() : undefined;

  // Off-site-diversion gate: on Douyin an in-video QR risks shop-window closure (2026-07 enforcement),
  // so a block-level platform refuses unless the caller explicitly forces; softer levels pass a warning through.
  const qrPolicy = getOffSiteQrPolicy(platform);
  if (qrPolicy.level === "block" && body.force !== true) {
    return apiError(req, `${qrPolicy.reason.zh}（force: true 可强制生成）`, `${qrPolicy.reason.en} (pass force: true to proceed)`, 400);
  }
  const qrWarning = qrPolicy.level === "ok" ? undefined : qrPolicy.reason;

  const ts = Date.now();
  const qrPath = join(getDataDir(), "uploads", id, `endcard-qr-${ts}.png`);
  const outName = `endcard-${ts}.mp4`;
  const outPath = join(getDataDir(), "output", id, outName);

  let shopLink: string;
  try {
    shopLink = await generateShopQr(shopUrl, qrPath, { platform, affiliateCode: proj.affiliateCode ?? undefined });
    await generateEndCard({ videoPath, qrPath, outPath, ctaText, seconds, fontFile: resolveChineseFontFile() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : errText(req, "片尾二维码生成失败", "End-card generation failed") }, { status: 500 });
  }
  return NextResponse.json({ video: `/api/output/${id}/${outName}`, shopLink, ...(qrWarning ? { warning: qrWarning } : {}) });
}
