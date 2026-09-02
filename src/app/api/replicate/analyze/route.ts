import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";
import { probeMedia } from "@/lib/media-probe";
import { detectSceneTimes } from "@/lib/video-composer/contact-sheet";
import { shotPlanFromCuts, replicateReferenceStructure, REPLICATE_MAX_REF_SEC } from "@/lib/replicate-plan";
import { apiError, errText } from "@/lib/api-error";
import { isSaasMode } from "@/lib/saas/runtime";
import { requireApiIdentity } from "@/lib/saas/authorization";

/** Single-file limit (matches the materials route; the model tier's own cap is 50MB/15s, reported per-mode) */
const MAX_FILE_SIZE = 80 * 1024 * 1024;
const ALLOWED_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const EXT_BY_MIME: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/**
 * POST /api/replicate/analyze — REAL reference-video analysis for the viral-replication
 * flow (replaces the clone page's old fake 600ms "analysis" that returned a hardcoded
 * 6-card structure). multipart: file=<video>.
 *
 * Saves the video under uploads/replicate/ (servable via /api/files/replicate/...),
 * detects scene cuts with ffmpeg (same detector as the contact sheet), and returns the
 * shot-duration skeleton plus the ready-to-use referenceStructure prompt block.
 */
export async function POST(req: NextRequest) {
  if (isSaasMode()) {
    const access = await requireApiIdentity();
    if (!access.ok) return access.response;
    return apiError(
      req,
      "SaaS 第一阶段尚未迁移共享复刻素材目录",
      "The shared replication media directory is not available in SaaS phase one",
      501,
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError(req, "无效的表单数据", "Invalid form data", 400);
  }
  const file = formData.get("file") as File | null;
  if (!file) return apiError(req, "请上传参考视频文件", "Please upload a reference video file", 400);
  if (file.size > MAX_FILE_SIZE) {
    return apiError(req, "参考视频超过 80MB 大小限制", "Reference video exceeds the 80MB size limit", 400);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return apiError(req, "仅支持 mp4/webm/mov 视频", "Only mp4/webm/mov videos are supported", 400);
  }

  try {
    const dir = join(getDataDir(), "uploads", "replicate");
    await mkdir(dir, { recursive: true });
    // renamed on save (original filename never reused — same policy as the materials route)
    const name = `ref-${Date.now()}.${EXT_BY_MIME[file.type] ?? "mp4"}`;
    const filePath = join(dir, name);
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    const probe = await probeMedia(filePath);
    if (!probe.duration) {
      return apiError(req, "无法读取视频时长，文件可能损坏", "Could not read the video duration — the file may be corrupt", 400);
    }
    const cuts = await detectSceneTimes(filePath);
    const shots = shotPlanFromCuts(cuts, probe.duration);

    return NextResponse.json({
      path: `/api/files/replicate/${name}`,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      shots,
      referenceStructure: replicateReferenceStructure(shots, probe.duration),
      // model-tier eligibility (Seedance reference_videos: ≤15s) decided server-side once
      modelTierEligible: probe.duration <= REPLICATE_MAX_REF_SEC,
      maxRefSec: REPLICATE_MAX_REF_SEC,
    });
  } catch (error) {
    console.error("Reference video analysis failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "参考视频分析失败", "Reference video analysis failed") },
      { status: 500 }
    );
  }
}
