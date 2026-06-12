import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { getDb } from "@/lib/db";
import { compositions } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

const execAsync = promisify(exec);

// 各平台目标尺寸（带货主流竖屏/3:4）
const PLATFORM_SIZE: Record<string, { w: number; h: number; name: string }> = {
  douyin: { w: 1080, h: 1920, name: "抖音" },
  kuaishou: { w: 1080, h: 1920, name: "快手" },
  xiaohongshu: { w: 1080, h: 1440, name: "小红书" },
};

/**
 * 把成片重编码到指定平台比例。
 * 用「模糊填充」：放大裁切的模糊背景 + 等比适配的前景居中叠加，
 * 既不裁掉字幕/贴片，也不留黑边（带货短视频常见处理）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });
    }
    const { platform } = await req.json();
    const target = PLATFORM_SIZE[platform];
    if (!target) {
      return NextResponse.json({ error: "不支持的平台" }, { status: 400 });
    }

    // 取最新成片
    const db = getDb();
    const rows = await db
      .select()
      .from(compositions)
      .where(eq(compositions.projectId, id))
      .orderBy(desc(compositions.createdAt))
      .limit(1);
    const src = rows[0]?.outputPath;
    if (!src || !existsSync(src)) {
      return NextResponse.json({ error: "还没有成片，请先合成视频" }, { status: 400 });
    }

    const { w, h } = target;
    const outFile = join(process.cwd(), "data", "output", id, `${platform}-${Date.now()}.mp4`);
    // 模糊填充：[bg]放大裁切+模糊；[fg]等比适配；居中叠加
    const filter =
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=24:4[bg];` +
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
    const cmd =
      `ffmpeg -y -i "${src}" -filter_complex "${filter}" ` +
      `-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart ` +
      `-c:a aac -b:a 192k "${outFile}"`;

    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

    const fileName = outFile.split("/").pop() ?? "";
    return NextResponse.json({
      success: true,
      platform,
      platformName: target.name,
      url: `/api/output/${id}/${fileName}`,
      size: `${w}x${h}`,
    });
  } catch (error) {
    console.error("多平台导出失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导出失败" },
      { status: 500 }
    );
  }
}
