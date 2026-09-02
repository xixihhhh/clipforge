import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";
import { getDb } from "@/lib/db";
import { scripts, assets } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { createProvider } from "@/lib/providers";
import { toRemoteUsableImage } from "@/lib/remote-image";
import { buildStoryboardGridPrompt, computeGridCells, GRID_MAX_SHOTS } from "@/lib/storyboard-grid";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { probeMedia } from "@/lib/media-probe";
import { apiError, errText } from "@/lib/api-error";

const execFileAsync = promisify(execFile);

/** Download or decode the generated grid image into the project uploads dir; returns the physical path + public path. */
async function persistGridImage(projectId: string, sourceUrl: string): Promise<{ absPath: string; publicPath: string }> {
  const dir = join(getDataDir(), "uploads", projectId);
  await mkdir(dir, { recursive: true });
  let buf: Buffer;
  let ext = "png";
  if (sourceUrl.startsWith("data:")) {
    const comma = sourceUrl.indexOf(",");
    if (comma === -1) throw new Error("无法解析 data URI 图片");
    const meta = sourceUrl.slice(5, comma);
    buf = /;base64/i.test(meta)
      ? Buffer.from(sourceUrl.slice(comma + 1), "base64")
      : Buffer.from(decodeURIComponent(sourceUrl.slice(comma + 1)), "utf-8");
    if (meta.includes("webp")) ext = "webp";
    else if (meta.includes("jpeg") || meta.includes("jpg")) ext = "jpg";
  } else if (/^https?:\/\//.test(sourceUrl)) {
    const resp = await fetch(sourceUrl);
    if (!resp.ok) throw new Error(`下载九宫格图失败: ${resp.status}`);
    buf = Buffer.from(await resp.arrayBuffer());
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("webp")) ext = "webp";
    else if (ct.includes("jpeg") || ct.includes("jpg")) ext = "jpg";
  } else {
    throw new Error("不支持的图片来源");
  }
  const fileName = `storyboard-grid-${Date.now()}.${ext}`;
  const absPath = join(dir, fileName);
  await writeFile(absPath, buf);
  return { absPath, publicPath: `/api/files/${projectId}/${fileName}` };
}

/**
 * POST /api/project/[id]/storyboard-grid — one-image consistency anchoring.
 *
 * Renders ALL shots of a script as a single 3x3 storyboard grid (same person /
 * outfit / room / light physically guaranteed by being one generation), then
 * crops each cell into that shot's keyframe asset. The existing per-shot i2v
 * pass ("animate") picks the keyframes up from there. Scripts with more than 9
 * shots are rejected honestly instead of silently truncated.
 *
 * body: { scriptId, provider, model, apiKey, baseUrl?, options? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return apiError(req, "无效的项目ID", "Invalid project id", 400);
    }
    const body = await req.json();
    const { scriptId, provider: providerName, model, apiKey, baseUrl, options, characterSheetUrl, productImageUrl } = body as {
      scriptId?: string;
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      options?: Record<string, unknown>;
      /** Presenter's multi-view sheet — locks the person's identity across all nine cells */
      characterSheetUrl?: string;
      /** Product photo — locks the product's appearance across all nine cells */
      productImageUrl?: string;
    };
    if (!scriptId || !providerName || !model) {
      return apiError(req, "缺少 scriptId / provider / model", "Missing scriptId / provider / model", 400);
    }
    if (!apiKey) {
      return apiError(req, "缺少 API Key，请先在设置中配置生图平台", "Missing API key — configure an image provider in settings first", 400);
    }

    const db = getDb();
    const [script] = await db
      .select()
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.projectId, id)));
    if (!script) return apiError(req, "脚本不存在", "Script not found", 404);
    const shots = Array.isArray(script.shots) ? script.shots : [];
    if (shots.length < 2) {
      return apiError(req, "分镜太少，九宫格至少需要 2 个分镜", "Too few shots — the grid needs at least 2", 400);
    }
    if (shots.length > GRID_MAX_SHOTS) {
      return apiError(
        req,
        `九宫格最多放 ${GRID_MAX_SHOTS} 个分镜（当前 ${shots.length} 个）——适合短脚本；长脚本请用逐镜生成+链式首尾帧`,
        `The grid holds at most ${GRID_MAX_SHOTS} shots (this script has ${shots.length}) — use per-shot generation with keyframe chaining for longer scripts`,
        400
      );
    }

    // reference images (order matters — the prompt cites them by position):
    // [character sheet?, product photo?]; local /api/files paths travel as Base64
    const refInputs = [characterSheetUrl, productImageUrl].filter((u): u is string => !!u);
    const referenceImageUrls = (await Promise.all(refInputs.map(toRemoteUsableImage))).filter(
      (u): u is string => !!u
    );

    // 1) one generation renders every shot — consistency is physical, not prompted;
    // with references attached the sheet pins the person and the photo pins the product
    const prompt = buildStoryboardGridPrompt(shots, script.characters, {
      characterSheet: !!characterSheetUrl,
      productImage: !!productImageUrl,
    });
    const provider = createProvider({ name: providerName, apiKey, baseUrl: baseUrl ?? "" });
    const result = await provider.generateImage({
      ...(options ?? {}),
      modelId: model,
      mode: referenceImageUrls.length > 0 ? "image-to-image" : "text-to-image",
      ...(referenceImageUrls.length > 0 && { referenceImageUrls }),
      prompt,
    });
    const gridUrl = result.imageUrls?.[0];
    if (!gridUrl) throw new Error("生图未返回图片");

    // 2) persist the grid, then crop each cell into that shot's keyframe
    const { absPath, publicPath } = await persistGridImage(id, gridUrl);
    const probe = await probeMedia(absPath);
    if (!probe.width || !probe.height) throw new Error("无法读取九宫格图片尺寸");
    const cells = computeGridCells(probe.width, probe.height);

    const dir = join(getDataDir(), "uploads", id);
    const saved: { shotId: number; filePath: string }[] = [];
    for (let i = 0; i < shots.length; i++) {
      const cell = cells[i];
      const fileName = `asset-${shots[i].shotId}-${Date.now()}-grid.png`;
      const outPath = join(dir, fileName);
      await execFileAsync(ffmpegBin(), [
        "-y",
        "-i", absPath,
        "-vf", `crop=${cell.w}:${cell.h}:${cell.x}:${cell.y}`,
        "-frames:v", "1",
        outPath,
      ]);
      const filePath = `/api/files/${id}/${fileName}`;
      // Keep older takes for review/rollback while making this fresh grid cell active.
      await db.update(assets).set({ selected: false }).where(and(eq(assets.projectId, id), eq(assets.shotId, shots[i].shotId)));
      await db.insert(assets).values({
        projectId: id,
        shotId: shots[i].shotId,
        type: "ai_generated",
        filePath,
        provider: providerName,
        model,
        prompt: `[storyboard-grid 第${i + 1}格] ${shots[i].description ?? ""}`.trim(),
        selected: true,
        status: "done",
      });
      saved.push({ shotId: shots[i].shotId, filePath });
    }

    return NextResponse.json({ gridPath: publicPath, cells: saved, count: saved.length });
  } catch (error) {
    console.error("九宫格分镜生成失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "九宫格分镜生成失败", "Storyboard grid failed") },
      { status: 500 }
    );
  }
}
