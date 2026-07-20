import { NextRequest, NextResponse } from "next/server";
import { getDataDir, fileNameOf } from "@/lib/paths";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { join } from "path";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { getDb } from "@/lib/db";
import { compositions } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { PLATFORM_SPECS } from "@/lib/platform-specs";
import { vbvArgs, fpsCapArgs, buildBitrateReport, probeEncodeStats } from "@/lib/export-guard";
import { apiError, errText } from "@/lib/api-error";

const execAsync = promisify(exec);

// Target dimensions per platform (single source of truth in platform-specs.ts, including TikTok Shop)
const PLATFORM_SIZE = PLATFORM_SPECS;

/**
 * Re-encode the finished video to the target aspect ratio for a given platform.
 * Uses "blur-pad": an enlarged-and-cropped blurred background with the proportionally scaled
 * foreground centered on top — no subtitles/overlays are cropped and no letterboxing is added
 * (standard treatment for short-form commerce videos).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return apiError(req, "无效的项目ID", "Invalid project ID");
    }
    const { platform } = await req.json();
    const target = PLATFORM_SIZE[platform];
    if (!target) {
      return apiError(req, "不支持的平台", "Unsupported platform");
    }

    // Fetch the most recent *successful* composition — a failed retry on top must not hide a good take
    const db = getDb();
    const rows = await db
      .select()
      .from(compositions)
      .where(and(eq(compositions.projectId, id), eq(compositions.status, "done")))
      .orderBy(desc(compositions.createdAt))
      .limit(1);
    const src = rows[0]?.outputPath;
    if (!src || !existsSync(src)) {
      return apiError(req, "还没有成片，请先合成视频", "No composed video yet; please compose the video first");
    }

    const { w, h } = target;
    const outFile = join(getDataDir(), "output", id, `${platform}-${Date.now()}.mp4`);
    // Blur-pad: [bg] scale-up, crop, and blur; [fg] scale to fit proportionally; overlay centered
    const filter =
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:4[bg];` +
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
    // fps ceiling: only downsample when the source actually exceeds the platform limit
    const srcStats = await probeEncodeStats(src).catch(() => null);
    const fpsCap = fpsCapArgs(srcStats?.fps ?? 0, target.maxFps);
    // -map_metadata 0 explicitly carries source metadata into the output (important: this propagates the implicit AIGC compliance markers to the platform export — this is what the user actually uploads)
    // CRF + VBV dual constraint: CRF picks quality, maxrate/bufsize hard-caps bitrate peaks under
    // the platform's recompression line so the upload is served as-is instead of being re-transcoded
    const cmd =
      `"${ffmpegBin()}" -y -i "${src}" -filter_complex "${filter}" ` +
      `-map_metadata 0 -c:v libx264 -preset medium -crf 20 ${vbvArgs(target.maxVideoKbps)} ` +
      `${fpsCap ? fpsCap + " " : ""}-pix_fmt yuv420p -movflags +faststart ` +
      `-c:a aac -b:a 192k "${outFile}"`;

    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

    // verify what we actually produced — the report tells the user whether this file will
    // survive upload without platform recompression
    const outStats = await probeEncodeStats(outFile).catch(() => null);
    const report = outStats ? buildBitrateReport(outStats, target) : null;

    // separator-agnostic: join() produces backslash paths on Windows (issue #15)
    const fileName = fileNameOf(outFile);
    return NextResponse.json({
      success: true,
      platform,
      platformName: target.name,
      url: `/api/output/${id}/${fileName}`,
      size: `${w}x${h}`,
      report,
    });
  } catch (error) {
    console.error("多平台导出失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "导出失败", "Export failed") },
      { status: 500 }
    );
  }
}
