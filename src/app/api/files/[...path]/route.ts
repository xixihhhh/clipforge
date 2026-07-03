import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { apiError } from "@/lib/api-error";
import { parseRangeHeader } from "@/lib/http-range";
import { stat } from "fs/promises";
import { join, normalize, sep } from "path";
import { createReadStream, existsSync } from "fs";
import { Readable } from "stream";

// Static file server - serves uploaded images/videos.
// Streams from disk (no whole-file buffering) and supports single-range HTTP Range requests (206),
// so video previews can seek without re-downloading and memory stays flat under concurrent loads.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // Root directory for uploads
  const uploadsRoot = join(getDataDir(), "uploads");
  // Decode and normalize path segments before joining to prevent path traversal via encodings like ..%2f
  const decodedSegments = path.map((seg) => decodeURIComponent(seg));
  const filePath = normalize(join(uploadsRoot, ...decodedSegments));

  // Verify the resolved path is still within the uploads root directory
  if (filePath !== uploadsRoot && !filePath.startsWith(uploadsRoot + sep)) {
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
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    webm: "video/webm",
  };

  const baseHeaders: Record<string, string> = {
    "Content-Type": mimeTypes[ext || ""] || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000",
    "Accept-Ranges": "bytes",
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
