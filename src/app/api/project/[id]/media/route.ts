import { requireProjectAccess } from "@/lib/saas/authorization";
import { createWriteStream } from "fs";
import { mkdir, rm } from "fs/promises";
import { basename, extname, join } from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { apiError, errText } from "@/lib/api-error";
import { getDb } from "@/lib/db";
import { compositions, mediaEdits, mediaSources, projects } from "@/lib/db/schema";
import { probeMedia } from "@/lib/media-probe";
import { validateOrDelete } from "@/lib/media-validate";
import { fileNameOf, getUploadsDir } from "@/lib/paths";
import { publicMediaComposition, publicMediaSource } from "@/lib/public-media-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SAFE_ID = /^[a-zA-Z0-9-]+$/;
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;
const MAX_IMPORT_SECONDS = 2 * 60 * 60;
const SUPPORTED_EXTENSIONS = new Map([
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
  [".m4v", "video/x-m4v"],
]);

function decodedOriginalName(header: string | null): string {
  if (!header) return "video.mp4";
  try {
    return basename(decodeURIComponent(header).replace(/\\/g, "/")).slice(0, 240) || "video.mp4";
  } catch {
    return basename(header.replace(/\\/g, "/")).slice(0, 240) || "video.mp4";
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  try {
    const db = getDb();
    const [project, sourceRows, edits, projectCompositions] = await Promise.all([
      db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1),
      db.select().from(mediaSources).where(eq(mediaSources.projectId, id)).orderBy(desc(mediaSources.createdAt)),
      db.select().from(mediaEdits).where(eq(mediaEdits.projectId, id)).orderBy(desc(mediaEdits.createdAt)),
      db.select().from(compositions).where(eq(compositions.projectId, id)).orderBy(desc(compositions.createdAt)),
    ]);
    if (!project[0]) return apiError(req, "项目不存在", "Project not found", 404);
    const staleCutoff = Date.now() - 3 * 60 * 1000;
    const staleIds = sourceRows.filter((source) => source.status === "transcribing" && source.updatedAt && source.updatedAt.getTime() < staleCutoff).map((source) => source.id);
    if (staleIds.length) {
      await Promise.all(staleIds.map((sourceId) => db.update(mediaSources).set({ status: "failed", error: errText(req, "转写已中断，可直接重新开始", "Transcription was interrupted; you can restart it"), updatedAt: new Date() }).where(eq(mediaSources.id, sourceId))));
    }
    const sources = sourceRows.map((source) => staleIds.includes(source.id) ? { ...source, status: "failed" as const, error: errText(req, "转写已中断，可直接重新开始", "Transcription was interrupted; you can restart it") } : source);
    const compositionById = new Map(projectCompositions.map((composition) => [composition.id, composition]));
    return NextResponse.json({
      sources: sources.map((source) => {
        return {
          ...publicMediaSource(source),
          url: `/api/files/${id}/imported/${basename(source.filePath)}`,
          edits: edits
          .filter((edit) => edit.sourceId === source.id)
          .map((edit) => {
            const composition = edit.compositionId ? compositionById.get(edit.compositionId) ?? null : null;
            const outputName = composition?.outputPath ? fileNameOf(composition.outputPath) : null;
            return {
              ...edit,
              composition: composition ? publicMediaComposition(composition, {
                outputUrl: outputName ? `/api/output/${id}/${outputName}` : null,
                downloadUrl: outputName ? `/api/output/${id}/${outputName}?download=1` : null,
              }) : null,
            };
          }),
        };
      }),
    });
  } catch (error) {
    console.error("Imported media list failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "读取导入素材失败", "Failed to load imported media") }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  if (!req.body) return apiError(req, "没有收到视频文件", "No video file received", 400);

  const originalName = decodedOriginalName(req.headers.get("x-file-name"));
  const extension = extname(originalName).toLowerCase();
  const canonicalMime = SUPPORTED_EXTENSIONS.get(extension);
  if (!canonicalMime) return apiError(req, "仅支持 MP4、MOV、WebM、MKV、M4V", "Only MP4, MOV, WebM, MKV, and M4V are supported", 415);
  const declaredBytes = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_IMPORT_BYTES) {
    return apiError(req, "文件不能超过 1GB", "File size cannot exceed 1 GB", 413);
  }

  const db = getDb();
  const project = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!project[0]) return apiError(req, "项目不存在", "Project not found", 404);

  const directory = join(getUploadsDir(), id, "imported");
  await mkdir(directory, { recursive: true });
  const fileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const filePath = join(directory, fileName);
  let receivedBytes = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_IMPORT_BYTES) callback(new Error("IMPORT_TOO_LARGE"));
      else callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]),
      guard,
      createWriteStream(filePath, { flags: "wx" }),
    );
    if (!(await validateOrDelete(filePath, "video"))) {
      return apiError(req, "视频无法解码或文件已损坏", "The video cannot be decoded or is damaged", 422);
    }
    const metadata = await probeMedia(filePath);
    if (metadata.duration > MAX_IMPORT_SECONDS) {
      await rm(filePath, { force: true });
      return apiError(req, "单个视频最长支持 2 小时", "A single video can be up to 2 hours", 413);
    }
    const [source] = await db.insert(mediaSources).values({
      projectId: id,
      originalName,
      filePath,
      mimeType: canonicalMime,
      sizeBytes: receivedBytes,
      duration: Math.round(metadata.duration * 1000),
      width: metadata.width,
      height: metadata.height,
      hasAudio: metadata.hasAudio,
      status: "uploaded",
    }).returning();
    return NextResponse.json({ ...publicMediaSource(source), url: `/api/files/${id}/imported/${fileName}`, edits: [] }, { status: 201 });
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => {});
    if (error instanceof Error && error.message === "IMPORT_TOO_LARGE") {
      return apiError(req, "文件不能超过 1GB", "File size cannot exceed 1 GB", 413);
    }
    console.error("Imported media upload failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : errText(req, "视频导入失败", "Video import failed") }, { status: 500 });
  }
}
