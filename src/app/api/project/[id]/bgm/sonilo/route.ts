import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and } from "drizzle-orm";
import { join } from "path";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { getDataDir } from "@/lib/paths";
import { compositions } from "@/lib/db/schema";
import { apiError, errText } from "@/lib/api-error";
import { probeMedia } from "@/lib/media-probe";
import { recordAiTask, updateAiTask } from "@/lib/ai-tasks";
import {
  SoniloBgmError,
  SONILO_MUSIC_MAX_SECONDS,
  SONILO_SFX_MAX_SECONDS,
  hasSoniloApiKey,
  soniloStyleHint,
  submitSoniloBgm,
  awaitSoniloBgm,
  saveSoniloBgm,
} from "@/lib/sonilo-bgm";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

/**
 * POST /api/project/[id]/bgm/sonilo — AI 按成片生成配乐/音效（Sonilo，可选功能）。
 * 取该项目最新一次合成完成的成片（或 body.compositionId 指定的一次），发给 Sonilo
 * video-to-music（body.sfx=true 时 video-to-sfx），返回与「上传 BGM」接口同形的
 * { path, name }——前端选用后重新合成即混入，走既有的 bgmPath + 自动压低链路。
 *
 * body（均可选）：{ sfx?: boolean; mood?: string; prompt?: string; compositionId?: string }
 * - mood: 视频页配乐情绪（upbeat/chill/energetic/emotional）→ 风格提示；同一条成片换
 *   mood 重复调用，即可产出不同配乐方向做 A/B（与变体矩阵的配乐维度同一思路）
 * - prompt: 自定义风格提示，优先于 mood
 *
 * 计费安全：提交即计费（失败自动退款）；task_id 在轮询前先落库 ai_tasks（issue #16），
 * 轮询超时标 unknown 不丢单。上限：配乐 6 分钟 / 音效 3 分钟（超限本地先拦，不白传大文件）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!SAFE_ID.test(id)) {
      return apiError(req, "无效的项目ID", "Invalid project ID", 400);
    }
    if (!hasSoniloApiKey()) {
      return apiError(
        req,
        "未配置 SONILO_API_KEY 环境变量（sonilo.com 注册获取，注册送免费额度）",
        "SONILO_API_KEY is not set (get a key at sonilo.com — free credits on signup)",
        400
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      /* body 可省略：全默认（配乐、无风格提示、取最新成片） */
    }
    const sfx = body.sfx === true;
    const kind = sfx ? ("sfx" as const) : ("music" as const);

    // 成片：body.compositionId 指定的一次，或最新一次合成完成的
    const db = getDb();
    const compositionId = typeof body.compositionId === "string" ? body.compositionId : null;
    const [comp] = compositionId
      ? await db
          .select()
          .from(compositions)
          .where(and(eq(compositions.projectId, id), eq(compositions.id, compositionId)))
          .limit(1)
      : await db
          .select()
          .from(compositions)
          .where(and(eq(compositions.projectId, id), eq(compositions.status, "done")))
          .orderBy(desc(compositions.createdAt))
          .limit(1);
    if (!comp?.outputPath) {
      return apiError(req, "还没有合成完成的成片，先点「合成」再按成片生成配乐", "No finished composition yet — compose the video first", 400);
    }
    // separator-agnostic（issue #15 同款处理）：Windows 行存的是反斜杠绝对路径
    const videoPath = existsSync(comp.outputPath) ? comp.outputPath : join(getDataDir(), comp.outputPath);
    if (!existsSync(videoPath)) {
      return apiError(req, "成片文件不存在（可能已被清理），请重新合成", "Composition file is missing — compose again", 404);
    }

    // 时长上限本地预检：超限没必要白传一遍大文件（ffprobe 失败时交给后端 422 兜底，不扣费）
    const cap = sfx ? SONILO_SFX_MAX_SECONDS : SONILO_MUSIC_MAX_SECONDS;
    try {
      const probe = await probeMedia(videoPath);
      if (probe.duration > cap) {
        return apiError(
          req,
          `成片 ${Math.round(probe.duration)}s 超过${sfx ? "音效" : "配乐"}接口上限 ${cap}s`,
          `The cut is ${Math.round(probe.duration)}s — over the ${cap}s ${sfx ? "SFX" : "music"} cap`,
          400
        );
      }
    } catch {
      /* ffprobe 不可用则跳过预检，后端仍会校验（超限拒绝且不扣费） */
    }

    const prompt =
      (typeof body.prompt === "string" && body.prompt.trim()) ||
      soniloStyleHint(typeof body.mood === "string" ? body.mood : undefined);

    // 提交（受理即计费，绝不自动重试）→ task_id 先落库再轮询（issue #16：轮询失败不丢已付费任务）
    const { taskId } = await submitSoniloBgm({ videoPath, kind, prompt });
    const rowId = await recordAiTask({
      projectId: id,
      provider: "sonilo",
      model: sfx ? "video-to-sfx" : "video-to-music",
      mediaType: "audio",
      ...(prompt && { prompt }),
      taskId,
    });

    try {
      const result = await awaitSoniloBgm(taskId);
      const saved = await saveSoniloBgm(id, kind, { ...result, taskId });
      await updateAiTask(rowId, { status: "completed", resultUrls: [result.audioUrl] });
      return NextResponse.json({
        success: true,
        path: saved.publicPath,
        name: saved.fileName,
        taskId,
        ...(result.licenseId && { licenseId: result.licenseId }),
      });
    } catch (e) {
      // timeout = 失联（后台可能仍在跑）标 unknown；明确 failed 才标 failed
      const status = e instanceof SoniloBgmError && e.kind === "failed" ? "failed" : "unknown";
      await updateAiTask(rowId, { status, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  } catch (error) {
    if (error instanceof SoniloBgmError) {
      return apiError(req, error.zh, error.en, error.kind === "config" ? 400 : 502);
    }
    console.error("Sonilo 配乐生成失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "生成失败", "Generation failed") },
      { status: 500 }
    );
  }
}
