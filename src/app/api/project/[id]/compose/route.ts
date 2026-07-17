import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { ffprobeBin, ffmpegBin } from "@/lib/ffmpeg-path";
import { join } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { generateSpeech, estimateSpeechSeconds, type TTSConfig } from "@/lib/tts";
import { generateSpeechFree, DEFAULT_FREE_VOICE } from "@/lib/edge-tts";
import { resolveRenderProfile, isRenderPreset } from "@/lib/compose-presets";
import { isCaptionPreset, captionPresetOverrides, CAPTION_PRESETS } from "@/lib/caption-presets";
import { getDb } from "@/lib/db";
import { scripts as scriptsTable, assets as assetsTable, projects, compositions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { composeVideo, resolveChineseFontFamily, type ClipInput, type ComposeConfig } from "@/lib/video-composer/composer";
import { buildSubtitleTimeline, padDurationsForFade, type TimelineSegment } from "@/lib/video-composer/timeline";
import { buildKaraokeAss } from "@/lib/video-composer/karaoke";
import { isAudibleFromVolumedetect } from "@/lib/video-composer/audio-probe";
import { buildComplianceOverlays } from "@/lib/compliance-overlays";
import { fetchFreeBgm, moodQueryForCategory, moodQueryForMood } from "@/lib/free-bgm";
import type { Shot } from "@/lib/db/schema";
import { desc, and } from "drizzle-orm";

// 获取该项目最新一条合成记录（导出页读取真实成片）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    // 可选 ?compositionId：精确取某一次合成（A/B 多变体顺序重渲时按 id 轮询，避免 GET 返回 latest 的竞态串号）
    const compositionId = req.nextUrl.searchParams.get("compositionId");
    const rows = compositionId
      ? await db
          .select()
          .from(compositions)
          .where(and(eq(compositions.projectId, id), eq(compositions.id, compositionId)))
          .limit(1)
      : await db
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
  const p = join(getDataDir(), "uploads", m[1]);
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
    // 免费配音兜底（微软 Edge keyless TTS，无需 Key）：未配付费 TTS 时让「一句话主题成片」也能出声
    const freeTts = body.freeTts as { enabled?: boolean; voice?: string; rate?: string } | undefined;
    const useFreeTts = !ttsConfig && freeTts?.enabled === true;
    const freeVoice = freeTts?.voice || DEFAULT_FREE_VOICE;
    const freeRate = typeof freeTts?.rate === "string" ? freeTts.rate : undefined;
    const ttsDir = join(getDataDir(), "uploads", id, "tts");
    if (ttsConfig || useFreeTts) await mkdir(ttsDir, { recursive: true });

    /** 探测视频文件是否带「可听见」的音轨（自带语音/音效）；仅静音/空轨不算，让免费 TTS 旁白照常生效 */
    async function videoHasAudio(filePath: string): Promise<boolean> {
      try {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        // 1) 先看有没有音频流
        const { stdout } = await execAsync(
          `"${ffprobeBin()}" -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${filePath}"`
        );
        if (stdout.trim().length === 0) return false;
        // 2) 有流再用 volumedetect 看是否真有声音（静音轨按无音频处理，避免吞掉 TTS 旁白）
        const { stderr } = await execAsync(
          `"${ffmpegBin()}" -i "${filePath}" -af volumedetect -f null -`
        );
        return isAudibleFromVolumedetect(stderr);
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
          `"${ffprobeBin()}" -v error -show_entries format=duration -of csv=p=0 "${filePath}"`
        );
        return parseFloat(stdout.trim()) || 0;
      } catch {
        return 0;
      }
    }

    /** 为某分镜生成配音并落地为本地 mp3，返回绝对路径；失败返回 undefined（不阻断合成） */
    async function buildVoiceover(shotId: number, text: string): Promise<string | undefined> {
      if (!text || (!ttsConfig && !useFreeTts)) return undefined;
      try {
        // 付费 TTS 优先；否则走免费 Edge keyless TTS（速度映射：speed 倍率 → SSML 带符号百分比）
        const audio = ttsConfig
          ? await generateSpeech(text, ttsConfig)
          : await generateSpeechFree(text, { voice: freeVoice, rate: freeRate });
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

    // 渲染质量预设（快速/标准/高清）→ 分辨率 + 编码参数；只有「合法」预设才顶替 body.resolution，
    // 否则非法预设字符串会静默把用户显式选的 720p 顶成 1080p。
    const validPreset = isRenderPreset(body.renderPreset) ? body.renderPreset : undefined;
    // caption style preset (standard/bold/minimal/karaoke); invalid values fall back to the default look
    const captionPresetRaw: unknown = body.captionPreset;
    const captionPreset = isCaptionPreset(captionPresetRaw) ? captionPresetRaw : undefined;
    const profile = resolveRenderProfile(validPreset);
    const resolution: "720p" | "1080p" = validPreset
      ? profile.resolution
      : body.resolution === "720p"
        ? "720p"
        : "1080p";
    const outputCfg = {
      resolution,
      aspectRatio: (["9:16", "16:9", "1:1"].includes(body.aspectRatio) ? body.aspectRatio : "9:16") as "9:16" | "16:9" | "1:1",
      videoPreset: profile.videoPreset,
      crf: profile.crf,
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
    // Breathing gap in seconds between the end of one narration and the start of the next;
    // the extra tail needed by acrossfade transitions is added separately by padDurationsForFade
    const VOICE_GAP = 0.45;

    // 构建渲染分镜：跳过无素材的；有 TTS 配音时按配音实际时长卡点（字幕/贴片/画面严格对齐）
    const rendered: { shot: Shot; clip: ClipInput; duration: number; voiceSec?: number }[] = [];
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
      // 注意：免费素材库（Wikimedia）也会返回 .ogv 等容器，必须纳入视频判定，否则被当静态图 → 冻结帧 + 丢音轨
      const isVideo = /\.(mp4|webm|mov|m4v|ogv|ogg|mkv|avi)$/i.test(local);
      const nativeAudio = isVideo ? await videoHasAudio(local) : false;
      const audioPath =
        shot.voiceover && !nativeAudio ? await buildVoiceover(shot.shotId, shot.voiceover) : undefined;

      // Effective duration (core fix for issue #14 "next segment starts before speech ends"):
      // 1) TTS narration → actual audio length + breathing gap (clamped 1.5–20s); when the probe
      //    fails, estimate from text instead of falling back to the script's guessed duration,
      //    which used to hard-trim the narration mid-sentence;
      // 2) video with native voice → play out the real media length so model speech isn't cut;
      // 3) otherwise → script duration.
      let duration = shot.duration || 3;
      let voiceSec: number | undefined;
      if (audioPath) {
        const probed = await probeDuration(audioPath);
        voiceSec = probed > 0 ? probed : estimateSpeechSeconds(shot.voiceover ?? "");
        duration = Math.min(Math.max(voiceSec + VOICE_GAP, 1.5), 20);
      } else if (nativeAudio) {
        const mediaDur = await probeDuration(local);
        if (mediaDur > 0) duration = Math.min(Math.max(mediaDur, 1.5), 20);
      }

      const clip: ClipInput = {
        type: isVideo ? "video" : "image",
        filePath: local,
        duration,
        transition: shot.transition || "ai_start_end",
        ...(isVideo ? { hasAudio: nativeAudio } : { motion: defaultMotion(shot) }),
        ...(audioPath && { audioPath }),
      };
      rendered.push({ shot, clip, duration, voiceSec });
    }

    if (rendered.length === 0) throw new Error("没有可用素材");

    // acrossfade for ffmpeg_fade transitions consumes the previous clip's last FADE_DURATION:
    // pad voiced clips followed by a fade so the cross-fade only ever eats tail silence,
    // never the last words of narration (nor lets the next voice ride over them)
    const paddedDurations = padDurationsForFade(
      rendered.map((r) => ({
        duration: r.duration,
        transition: r.clip.transition,
        hasVoice: Boolean(r.clip.audioPath || r.clip.hasAudio),
      }))
    );
    rendered.forEach((r, i) => {
      r.duration = paddedDurations[i];
      r.clip.duration = paddedDurations[i];
    });

    const clips = rendered.map((r) => r.clip);

    // Subtitle + overlay timeline (pure functions in timeline.ts): accumulates the rendered
    // segments' effective durations in lockstep with the composer's xfade timeline; caption
    // cards follow the actual speech window (not the padded tail) and cards spilling across
    // fade transitions are clamped so two captions never over-print
    const timeline = buildSubtitleTimeline(
      rendered.map((r): TimelineSegment => {
        const ov = r.shot.textOverlay;
        return {
          duration: r.duration,
          transition: r.clip.transition,
          voiceover: r.shot.voiceover || undefined,
          voiceSec: r.voiceSec,
          overlay:
            ov && ov.style !== "subtitle" && ov.text
              ? { text: ov.text, style: ov.style as "title" | "highlight" | "price" }
              : undefined,
        };
      })
    );
    const subtitleTexts = timeline.cues;
    const karaokeLines = timeline.karaokeLines;
    const overlays: { text: string; style: "title" | "highlight" | "price"; startTime: number; endTime: number }[] = [
      ...timeline.overlays,
    ];

    // 可选叠加：片尾购买 CTA（带货转化），按 body 开关
    overlays.push(
      ...buildComplianceOverlays(
        {
          ctaText: typeof body.ctaText === "string" ? body.ctaText : undefined,
        },
        timeline.total
      )
    );

    // 背景音乐（可选）：① 用户上传的 bgmPath；② freeBgm=true 时自动取一条免费 CC 音乐。合成时混入并自动压低。
    let bgmLocal = body.bgmPath ? toLocalPath(body.bgmPath) : undefined;
    if (!bgmLocal && body.freeBgm === true) {
      // 配乐情绪：① 用户在视频页显式选的 bgmMood 优先；② 否则按商品品类自动挑（美妆→upbeat / 美食→warm…）
      const moodQuery =
        typeof body.bgmMood === "string" && body.bgmMood
          ? moodQueryForMood(body.bgmMood)
          : moodQueryForCategory(project.productCategory);
      const free = await fetchFreeBgm(id, moodQuery);
      if (free) {
        bgmLocal = free.localPath;
        // CC 音乐多需署名：记录来源，便于导出 credits / 用户在成片署名（CC BY 等）
        console.info(`[bgm] 免费配乐: ${free.author} · ${free.license} · ${free.sourceUrl}`);
      }
    }

    const config: ComposeConfig = {
      projectId: id,
      clips,
      output: {
        ...outputCfg,
        ...(bgmLocal && { bgmPath: bgmLocal, bgmVolume: 0.18, bgmDuck: body.bgmDuck === true }),
      },
      subtitle:
        subtitleTexts.length > 0
          ? { texts: subtitleTexts, position: "bottom", ...captionPresetOverrides(captionPreset) }
          : undefined,
      overlays: overlays.length > 0 ? overlays : undefined,
    };

    // karaoke per-character subtitles (opt-in via the karaoke flag or captionPreset=karaoke):
    // whole-sentence ASS \k burn-in via libass, replacing the rapid short caption cards
    const wantKaraoke = body.karaoke === true || (captionPreset && CAPTION_PRESETS[captionPreset].karaoke === true);
    if (wantKaraoke && karaokeLines.length > 0) {
      const ass = buildKaraokeAss(karaokeLines, { fontName: resolveChineseFontFamily() });
      const assDir = join(getDataDir(), "output", id);
      await mkdir(assDir, { recursive: true });
      const assPath = join(assDir, `karaoke_${comp.id}.ass`);
      await writeFile(assPath, ass, "utf8");
      config.subtitle = { texts: [], karaokeAssPath: assPath };
    }

    // 商品卡贴片（opt-in）：用商品图首图 + 商品名做左下角挂车卡
    if (body.productCard === true) {
      const cardImg = toLocalPath(productImages[0]);
      if (cardImg) {
        config.productCard = {
          imagePath: cardImg,
          name: (project.productName as string) || project.name || undefined,
          price: (project.productPrice as string) || undefined,
        };
      }
    }

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
