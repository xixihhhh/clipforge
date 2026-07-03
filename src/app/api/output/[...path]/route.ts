import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { apiError } from "@/lib/api-error";
import { parseRangeHeader } from "@/lib/http-range";
import { stat } from "fs/promises";
import { join, normalize, sep } from "path";
import { createReadStream, existsSync } from "fs";
import { Readable } from "stream";

// File server for composed output (video) — serves finished clips under data/output for playback and download.
// Streams from disk (no whole-file buffering) and supports single-range HTTP Range requests (206),
// so <video> seeking and iOS Safari playback work without re-downloading the entire file.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  const outputRoot = join(getDataDir(), "output");
  // Decode and normalize the path to prevent path traversal via encoded sequences like ..%2f
  const decodedSegments = path.map((seg) => decodeURIComponent(seg));
  const filePath = normalize(join(outputRoot, ...decodedSegments));

  if (filePath !== outputRoot && !filePath.startsWith(outputRoot + sep)) {
    return apiError(req, "非法路径", "Invalid path", 403);
  }

  if (!existsSync(filePath)) {
    return apiError(req, "文件不存在", "File not found", 404);
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    return apiError(req, "文件不存在", "File not found", 404);
  }
  const size = fileStat.size;

  const ext = filePath.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
  };

  // Optional download: when ?download=1 is present, instruct the browser to download the file
  const download = req.nextUrl.searchParams.get("download");
  const fileName = filePath.split(sep).pop() ?? "video.mp4";

  const baseHeaders: Record<string, string> = {
    "Content-Type": mimeTypes[ext || ""] || "application/octet-stream",
    "Cache-Control": "public, max-age=3600",
    "Accept-Ranges": "bytes",
    ...(download ? { "Content-Disposition": `attachment; filename="${fileName}"` } : {}),
  };

  const range = parseRangeHeader(req.headers.get("range"), size);

  if (range === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  if (range) {
    // Partial content: stream only the requested byte window
    const stream = Readable.toWeb(
      createReadStream(filePath, { start: range.start, end: range.end })
    ) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }

  // Full content: still stream from disk instead of buffering the whole file in memory
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      ...baseHeaders,
      "Content-Length": String(size),
    },
  });
}
