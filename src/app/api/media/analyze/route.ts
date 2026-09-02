import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { extname, join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText, pickLocale } from "@/lib/api-error";
import { llmErrorPair } from "@/lib/llm-error";
import { analyzeVisualMedia } from "@/lib/media-analysis";
import { probeMedia } from "@/lib/media-probe";
import type { LLMConfig } from "@/lib/script-engine/generator";
import { generateContactSheet } from "@/lib/video-composer/contact-sheet";
import { requireApiIdentity } from "@/lib/saas/authorization";

export const runtime = "nodejs";

const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 80 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 180;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

function parseConfig(value: FormDataEntryValue | null): LLMConfig | null {
  if (typeof value !== "string") return null;
  try {
    const config = JSON.parse(value) as LLMConfig;
    return config?.baseUrl && config?.apiKey && config?.model ? config : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const access = await requireApiIdentity();
  if (!access.ok) return access.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError(req, "无效的上传数据", "Invalid upload data", 400);
  }
  const file = form.get("file");
  const config = parseConfig(form.get("llmConfig"));
  if (!(file instanceof File)) return apiError(req, "请选择图片或视频", "Choose an image or video", 400);
  if (!config) return apiError(req, "请先配置可看图的视觉模型", "Configure a vision-capable model first", 400);

  const mediaType = IMAGE_MIME.has(file.type) ? "image" : VIDEO_MIME.has(file.type) ? "video" : null;
  if (!mediaType) return apiError(req, "仅支持 JPG、PNG、WebP、MP4、WebM、MOV", "Only JPG, PNG, WebP, MP4, WebM, and MOV are supported", 400);
  const limit = mediaType === "image" ? IMAGE_MAX : VIDEO_MAX;
  if (file.size > limit) {
    return apiError(req, mediaType === "image" ? "图片不能超过 15MB" : "视频不能超过 80MB", mediaType === "image" ? "Images must be 15MB or smaller" : "Videos must be 80MB or smaller", 400);
  }

  const workingDir = await mkdtemp(join(tmpdir(), "clipforge-media-"));
  try {
    const extension = EXTENSIONS[file.type] || extname(file.name) || ".bin";
    const mediaPath = join(workingDir, `source${extension}`);
    await writeFile(mediaPath, Buffer.from(await file.arrayBuffer()));
    const metadata = await probeMedia(mediaPath);
    let visualPath = mediaPath;
    let frameTimes: number[] = [];
    let cuts: number[] = [];

    if (mediaType === "video") {
      if (!(metadata.duration > 0)) return apiError(req, "无法读取视频，文件可能损坏", "Could not read the video; the file may be damaged", 400);
      if (metadata.duration > MAX_VIDEO_SECONDS) {
        return apiError(req, "视频最长支持 3 分钟", "Videos can be up to 3 minutes long", 400);
      }
      visualPath = join(workingDir, "contact-sheet.png");
      const sheet = await generateContactSheet({ videoPath: mediaPath, outPath: visualPath, frames: 8, thumbWidth: 200, waveHeight: 100 });
      frameTimes = sheet.frameTimes;
      cuts = sheet.cuts;
    }

    const bytes = await readFile(visualPath);
    const mime = mediaType === "video" ? "image/png" : file.type;
    const sampleContext = mediaType === "video"
      ? `duration ${metadata.duration.toFixed(1)}s; ${cuts.length + 1} detected shots; representative frames at ${frameTimes.map((time) => `${time}s`).join(", ") || "even intervals"}`
      : undefined;
    const analysis = await analyzeVisualMedia({
      imageDataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      mediaType,
      locale: pickLocale(req),
      config,
      sampleContext,
    });
    return NextResponse.json({
      ...analysis,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        size: file.size,
        ...(mediaType === "video" && {
          duration: metadata.duration,
          hasAudio: metadata.hasAudio,
          shotCount: cuts.length + 1,
          frameTimes,
        }),
      },
    });
  } catch (error) {
    console.error("Media analysis failed:", error);
    const pair = llmErrorPair(error);
    return NextResponse.json({ error: errText(req, `媒体解构失败：${pair.zh}`, `Media analysis failed: ${pair.en}`) }, { status: 500 });
  } finally {
    await rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
