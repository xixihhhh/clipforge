import { requireProjectAccess } from "@/lib/saas/authorization";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { extractAsrAudioChunk } from "@/lib/asr-audio-chunk";
import { getDb } from "@/lib/db";
import { mediaSources } from "@/lib/db/schema";
import { ASR_CHUNK_SECONDS, ASR_SAMPLE_RATE } from "@/lib/transcript-checkpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id, mediaId } = await params;
  if (!SAFE_ID.test(id) || !SAFE_ID.test(mediaId)) return apiError(req, "无效的素材ID", "Invalid media ID", 400);
  const start = Number(req.nextUrl.searchParams.get("start") ?? 0);
  const requestedDuration = Number(req.nextUrl.searchParams.get("duration") ?? ASR_CHUNK_SECONDS);
  if (!Number.isFinite(start) || !Number.isFinite(requestedDuration) || start < 0 || requestedDuration <= 0 || requestedDuration > ASR_CHUNK_SECONDS) {
    return apiError(req, "无效的音频分块范围", "Invalid audio chunk range", 400);
  }

  try {
    const db = getDb();
    const [source] = await db.select().from(mediaSources).where(and(eq(mediaSources.id, mediaId), eq(mediaSources.projectId, id))).limit(1);
    if (!source) return apiError(req, "素材不存在", "Media source not found", 404);
    if (!source.hasAudio) return apiError(req, "这个视频没有可转写的音轨", "This video has no audio track to transcribe", 422);
    const sourceDuration = source.duration / 1000;
    if (start >= sourceDuration) return apiError(req, "音频分块起点超出素材时长", "Audio chunk starts after the media ends", 416);
    const duration = Math.min(requestedDuration, sourceDuration - start);
    const pcm = await extractAsrAudioChunk({ inputPath: source.filePath, startSeconds: start, durationSeconds: duration, signal: req.signal });
    const body = new Uint8Array(pcm.byteLength);
    body.set(pcm);
    return new Response(body.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(pcm.byteLength),
        "Cache-Control": "private, no-store",
        "X-Audio-Sample-Rate": String(ASR_SAMPLE_RATE),
        "X-Audio-Start": start.toFixed(3),
        "X-Audio-Duration": (pcm.byteLength / Float32Array.BYTES_PER_ELEMENT / ASR_SAMPLE_RATE).toFixed(3),
      },
    });
  } catch (error) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("ASR audio chunk extraction failed:", error);
    return apiError(req, "音频分块提取失败", "Failed to extract the audio chunk", 500);
  }
}
