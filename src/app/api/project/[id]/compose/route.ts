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

    /** 探测媒体时长（秒），失败返回 0 */
    async function probeDuration(filePath: string): Promise<number> {
      try {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(
          `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`
        );
        return parseFloat(stdout.trim()) || 0;
      } catch {
        return 0;
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

    // 廉价预检：至少一个分镜有可用素材（避免返回 202 后才发现没素材）
    const hasAnyAsset = shots.some((s) => toLocalPath(assetByShot.get(s.shotId) ?? productImages[0]));
    if (!hasAnyAsset) {
      return NextResponse.json(
        { error: "没有可用素材，请先在素材步骤生成素材或上传商品图" },
        { status: 400 }
      );
    }

    const outputCfg = {
      resolution: (body.resolution === "720p" ? "720p" : "1080p") as "720p" | "1080p",
      aspectRatio: (["9:16", "16:9", "1:1"].includes(body.aspectRatio) ? body.aspectRatio : "9:16") as "9:16" | "16:9" | "1:1",
    };

    // 立即建合成记录(composing)并返回；重活(TTS+FFmpeg)后台异步跑，前端轮询 GET 获取结果
    const [comp] = await db
      .insert(compositions)
      .values({ projectId: id, resolution: outputCfg.resolution, aspectRatio: outputCfg.aspectRatio, status: "composing" })
      .returning();
    await db.update(projects).set({ status: "composing", updatedAt: new Date() }).where(eq(projects.id, id));

    // 后台异步合成（不阻塞请求，避免长视频超时）
    void (async () => {
     try {
    // 构建渲染分镜：跳过无素材的；有 TTS 配音时按配音实际时长卡点（字幕/贴片/画面严格对齐）
    const rendered: { shot: Shot; clip: ClipInput; duration: number }[] = [];
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
      const audioPath =
        shot.voiceover && !nativeAudio ? await buildVoiceover(shot.shotId, shot.voiceover) : undefined;

      // 有效时长：有配音→按配音实际长度+0.4s 尾留白卡点（限 1.5~20s）；否则用脚本时长
      let duration = shot.duration || 3;
      if (audioPath) {
        const ttsDur = await probeDuration(audioPath);
        if (ttsDur > 0) duration = Math.min(Math.max(ttsDur + 0.4, 1.5), 20);
      }

      const clip: ClipInput = {
        type: isVideo ? "video" : "image",
        filePath: local,
        duration,
        transition: shot.transition || "ai_start_end",
        ...(isVideo ? { hasAudio: nativeAudio } : { motion: defaultMotion(shot) }),
        ...(audioPath && { audioPath }),
      };
      rendered.push({ shot, clip, duration });
    }

    if (rendered.length === 0) throw new Error("没有可用素材");

    const clips = rendered.map((r) => r.clip);

    // 字幕 + 文字贴片：按渲染分镜的有效时长累计，与画面时间轴严格对齐（修复缺素材导致的漂移 + 字幕卡配音）
    let acc = 0;
    const subtitleTexts: { text: string; startTime: number; endTime: number }[] = [];
    const overlays: { text: string; style: "title" | "highlight" | "price"; startTime: number; endTime: number }[] = [];
    for (const r of rendered) {
      const start = acc;
      acc += r.duration;
      const end = acc;
      if (r.shot.voiceover) subtitleTexts.push({ text: r.shot.voiceover, startTime: start, endTime: end });
      const ov = r.shot.textOverlay;
      if (ov && ov.style !== "subtitle" && ov.text) {
        overlays.push({ text: ov.text, style: ov.style as "title" | "highlight" | "price", startTime: start, endTime: end });
      }
    }

    // 背景音乐（可选）：本地路径转绝对路径，合成时混入并自动压低
    const bgmLocal = body.bgmPath ? toLocalPath(body.bgmPath) : undefined;

    const config: ComposeConfig = {
      projectId: id,
      clips,
      output: {
        ...outputCfg,
        ...(bgmLocal && { bgmPath: bgmLocal, bgmVolume: 0.18 }),
      },
      subtitle: subtitleTexts.length > 0 ? { texts: subtitleTexts, position: "bottom" } : undefined,
      overlays: overlays.length > 0 ? overlays : undefined,
    };

        // 执行合成（FFmpeg）
        const outputPath = await composeVideo(config);
        // 完成：更新合成记录与项目状态
        await db.update(compositions).set({ outputPath, status: "done" }).where(eq(compositions.id, comp.id));
        await db.update(projects).set({ status: "done", updatedAt: new Date() }).where(eq(projects.id, id));
      } catch (e) {
        console.error("后台合成失败:", e);
        await db.update(compositions).set({ status: "failed" }).where(eq(compositions.id, comp.id)).catch(() => {});
        await db.update(projects).set({ status: "video", updatedAt: new Date() }).where(eq(projects.id, id)).catch(() => {});
      }
    })();

    // 立即返回，前端轮询 GET /api/project/[id]/compose 直到 status=done/failed
    return NextResponse.json({ compositionId: comp.id, status: "composing" }, { status: 202 });
  } catch (error) {
    console.error("视频合成失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "视频合成失败" },
      { status: 500 }
    );
  }
}
