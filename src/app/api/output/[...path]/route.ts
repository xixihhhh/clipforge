import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { join, normalize, sep } from "path";
import { existsSync } from "fs";

// 合成产物（视频）文件服务 - 提供 data/output 下的成片访问/下载
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  const outputRoot = join(process.cwd(), "data", "output");
  // 解码并归一化路径，防止 ..%2f 等编码绕过造成路径穿越
  const decodedSegments = path.map((seg) => decodeURIComponent(seg));
  const filePath = normalize(join(outputRoot, ...decodedSegments));

  if (filePath !== outputRoot && !filePath.startsWith(outputRoot + sep)) {
    return NextResponse.json({ error: "非法路径" }, { status: 403 });
  }

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const buffer = await readFile(filePath);
  const ext = filePath.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
  };

  // 可选下载：?download=1 时提示浏览器下载
  const download = req.nextUrl.searchParams.get("download");
  const fileName = filePath.split(sep).pop() ?? "video.mp4";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeTypes[ext || ""] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      ...(download ? { "Content-Disposition": `attachment; filename="${fileName}"` } : {}),
    },
  });
}
