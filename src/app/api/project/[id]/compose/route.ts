import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { generateSpeech, type TTSConfig } from "@/lib/tts";
import { getDb } from "@/lib/db";
import { scripts as scriptsTable, assets as assetsTable, projects, compositions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { composeVideo, type ClipInput, type ComposeConfig } from "@/lib/video-composer/composer";
import type { Shot } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

// 获取该项目最新一条合成记录（导出页读取真实成片）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const rows = await db
      .select()
      .from(compositions)
      .where(eq(compositions.projectId, id))
      .orderBy(desc(compositions.createdAt))
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ composition: null });
    }
    const c = rows[0];
    const fileName = (c.outputPath ?? "").split("/").pop() ?? "";
    return NextResponse.json({
      composition: {
        ...c,
        fileName,
        url: fileName ? `/api/output/${id}/${fileName}` : null,
      },
    });
  } catch (error) {
    console.error("获取合成记录失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "获取合成记录失败" },
      { status: 500 }
    );
  }
}

/** 把 /api/files/{pid}/{file} 形式的访问路径还原为本地磁盘绝对路径 */
function toLocalPath(fileRef: string | undefined): string | undefined {
  if (!fileRef) return undefined;
  const m = fileRef.match(/\/api\/files\/(.+)/);
  if (!m) return undefined;
  const p = join(process.cwd(), "data", "uploads", m[1]);
  return existsSync(p) ? p : undefined;
}

/** 按镜头类型给商品原图分镜分配一个默认运镜 */
function defaultMotion(shot: Shot): string {
  if (shot.motion) return shot.motion;
  switch (shot.type) {
    case "hook":
      return "zoom_in_slow";
    case "product_reveal":
      return "ken_burns";
    case "demo":
      return "pan_right";
    case "cta":
      return "static";
    default:
      return "ken_burns";
  }
}

// 合成视频：读取已选脚本分镜 + 已生成素材，用 FFmpeg 合成带运镜与中文字幕的成片
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const db = getDb();

    // 读取项目（拿商品图兜底）与已选脚本
    const projRows = await db.select().from(projects).where(eq(projects.id, id));
    if (projRows.length === 0) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    const project = projRows[0];
    const productImages = (project.productImages ?? []) as string[];

    const scriptRows = await db.select().from(scriptsTable).where(eq(scriptsTable.projectId, id));
    const selected = scriptRows.find((s) => s.selected) ?? scriptRows[0];
    if (!selected || !Array.isArray(selected.shots) || selected.shots.length === 0) {
      return NextResponse.json({ error: "尚未生成脚本，无法合成" }, { status: 400 });
    }
    const shots = selected.shots as Shot[];

    // 已生成的素材（assets 表，按 shotId 索引）
    const assetRows = await db.select().from(assetsTable).where(eq(assetsTable.projectId, id));
    const assetByShot = new Map<number, string>();
    for (const a of assetRows) {
      if (a.filePath) assetByShot.set(a.shotId, a.filePath);
    }

    // 可选 TTS 配音配置（前端从设置带入）
    const ttsConfig: TTSConfig | undefined =
      body.ttsConfig?.baseUrl && body.ttsConfig?.apiKey && body.ttsConfig?.model && body.ttsConfig?.voice
        ? body.ttsConfig
        : undefined;
    const ttsDir = join(process.cwd(), "data", "uploads", id, "tts");
    if (ttsConfig) await mkdir(ttsDir, { recursive: true });

    /** 探测视频文件是否带音轨（自带语音/音效的视频模型产出） */
    async function videoHasAudio(filePath: string): Promise<boolean> {
      try {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(
          `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${filePath}"`
        );
        return stdout.trim().length > 0;
      } catch {
        return false;
      }
    }

    /** 为某分镜生成配音并落地为本地 mp3，返回绝对路径；失败返回 undefined（不阻断合成） */
    async function buildVoiceover(shotId: number, text: string): Promise<string | undefined> {
      if (!ttsConfig || !text) return undefined;
      try {
        const audio = await generateSpeech(text, ttsConfig);
        const file = join(ttsDir, `shot-${shotId}.mp3`);
        await writeFile(file, audio);
        return file;
      } catch (e) {
        console.warn(`分镜 ${shotId} 配音生成失败（已跳过）:`, e);
        return undefined;
      }
    }

    // 为每个分镜构建一个 image+motion 片段（用静态素材 + 运镜，避免 AI 篡改商品）
    const clips: ClipInput[] = [];
    const missing: number[] = [];
    for (const shot of shots) {
      // 素材优先级：该分镜已生成素材 → 商品原图兜底
      const ref = assetByShot.get(shot.shotId) ?? productImages[0];
      const local = toLocalPath(ref);
      if (!local) {
        missing.push(shot.shotId);
        continue;
      }
      // 视频素材 vs 静态图：视频自带音轨时用模型原生语音，不再叠 TTS（避免双重声音）
      const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(local);
      const nativeAudio = isVideo ? await videoHasAudio(local) : false;
      // 仅静态图、或无音轨的视频，才生成 TTS 配音
      const audioPath =
        shot.voiceover && !nativeAudio ? await buildVoiceover(shot.shotId, shot.voiceover) : undefined;

      clips.push({
        type: isVideo ? "video" : "image",
        filePath: local,
        duration: shot.duration || 3,
        transition: shot.transition || "ai_start_end",
        ...(isVideo ? { hasAudio: nativeAudio } : { motion: defaultMotion(shot) }),
        ...(audioPath && { audioPath }),
      });
    }

    if (clips.length === 0) {
      return NextResponse.json(
        { error: "没有可用素材，请先在素材步骤生成素材或上传商品图" },
        { status: 400 }
      );
    }

    // 字幕：把每个分镜的配音文案按累计时长切成时间段
    let acc = 0;
    const subtitleTexts = shots
      .filter((s) => s.voiceover)
      .map((s) => {
        const start = acc;
        acc += s.duration || 3;
        return { text: s.voiceover, startTime: start, endTime: acc };
      });

    // 文字贴片：由分镜 textOverlay 生成；价格类自动回填商品价格
    let acc2 = 0;
    const overlays = shots
      .map((s) => {
        const start = acc2;
        acc2 += s.duration || 3;
        const ov = s.textOverlay;
        if (!ov || ov.style === "subtitle" || !ov.text) return null;
        return { text: ov.text, style: ov.style as "title" | "highlight" | "price", startTime: start, endTime: acc2 };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const config: ComposeConfig = {
      projectId: id,
      clips,
      output: {
        resolution: body.resolution === "720p" ? "720p" : "1080p",
        aspectRatio: ["9:16", "16:9", "1:1"].includes(body.aspectRatio) ? body.aspectRatio : "9:16",
      },
      subtitle: subtitleTexts.length > 0 ? { texts: subtitleTexts, position: "bottom" } : undefined,
      overlays: overlays.length > 0 ? overlays : undefined,
    };

    // 执行合成（FFmpeg）
    const outputPath = await composeVideo(config);
    const fileName = outputPath.split("/").pop() ?? "";
    const publicUrl = `/api/output/${id}/${fileName}`;

    // 落库合成记录 + 更新项目状态
    await db.insert(compositions).values({
      projectId: id,
      outputPath,
      resolution: config.output.resolution,
      aspectRatio: config.output.aspectRatio,
      status: "done",
    });
    await db.update(projects).set({ status: "done", updatedAt: new Date() }).where(eq(projects.id, id));

    return NextResponse.json({
      success: true,
      outputPath,
      fileName,
      url: publicUrl,
      clipCount: clips.length,
      missingShots: missing,
    });
  } catch (error) {
    console.error("视频合成失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "视频合成失败" },
      { status: 500 }
    );
  }
}
