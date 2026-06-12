import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const ALLOWED = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac", "audio/mp4", "audio/x-m4a"];

// 上传背景音乐（合成时混入并自动压低，让位配音）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });
    }
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "未收到音频文件" }, { status: 400 });
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
    const ALLOWED_EXT = ["mp3", "wav", "aac", "m4a"];
    // mime 或扩展名任一匹配即可（部分上传不带准确 mime）
    if (!ALLOWED.includes(file.type) && !ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: "仅支持 mp3/wav/aac/m4a 音频" }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "音频不超过 20MB" }, { status: 400 });
    }

    const dir = join(process.cwd(), "data", "uploads", id);
    await mkdir(dir, { recursive: true });
    const fileName = `bgm.${ext}`;
    await writeFile(join(dir, fileName), Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({ success: true, path: `/api/files/${id}/${fileName}`, name: file.name });
  } catch (error) {
    console.error("BGM 上传失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传失败" },
      { status: 500 }
    );
  }
}
