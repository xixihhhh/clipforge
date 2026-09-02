import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { apiError, errText } from "@/lib/api-error";

const ALLOWED = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/aac", "audio/mp4", "audio/x-m4a"];

// Upload background music (mixed in during composition with auto-ducking to make room for voiceover)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return apiError(req, "无效的项目ID", "Invalid project ID", 400);
    }
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return apiError(req, "未收到音频文件", "No audio file received", 400);
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
    const ALLOWED_EXT = ["mp3", "wav", "aac", "m4a"];
    // Accept if either MIME type or extension matches (some uploads lack an accurate MIME type)
    if (!ALLOWED.includes(file.type) && !ALLOWED_EXT.includes(ext)) {
      return apiError(req, "仅支持 mp3/wav/aac/m4a 音频", "Only mp3/wav/aac/m4a audio is supported", 400);
    }
    if (file.size > 20 * 1024 * 1024) {
      return apiError(req, "音频不超过 20MB", "Audio must not exceed 20MB", 400);
    }

    const dir = join(getDataDir(), "uploads", id);
    await mkdir(dir, { recursive: true });
    const fileName = `bgm.${ext}`;
    await writeFile(join(dir, fileName), Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({ success: true, path: `/api/files/${id}/${fileName}`, name: file.name });
  } catch (error) {
    console.error("BGM 上传失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : errText(req, "上传失败", "Upload failed") },
      { status: 500 }
    );
  }
}
