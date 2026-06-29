import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { writeFile, mkdir, readdir } from "fs/promises";
import { join } from "path";
import { classifyMaterial } from "@/lib/providers/local-stock";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;
/** 单文件上限 80MB（视频较大，与素材下载上限一致） */
const MAX_FILE_SIZE = 80 * 1024 * 1024;
/** 允许的视频/图片 MIME 白名单 */
const ALLOWED_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime", // .mov
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** 项目本地素材池目录：uploads/{id}/materials/ */
function materialsDir(projectId: string) {
  return join(getDataDir(), "uploads", projectId, "materials");
}

/** GET /api/project/[id]/materials —— 列出该项目本地素材池（自带 B-roll） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });
  let names: string[] = [];
  try {
    names = await readdir(materialsDir(id));
  } catch {
    /* 无目录 = 空池 */
  }
  const materials = names
    .map((name) => ({ name, mediaType: classifyMaterial(name) }))
    .filter((m) => m.mediaType !== null)
    .map((m) => ({ name: m.name, mediaType: m.mediaType, url: `/api/files/${id}/materials/${m.name}` }));
  return NextResponse.json({ materials });
}

/**
 * POST /api/project/[id]/materials —— 上传自有视频/图片 B-roll 到本地素材池。
 * 对标 an open-source short-video tool 的 a local source：用自拍/自有素材配画面，免网络免 Key。
 * multipart：files=<File[]>。落到 uploads/{id}/materials/，文件名重命名（不用原名，防安全问题）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return NextResponse.json({ error: "无效的项目ID" }, { status: 400 });

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];
  if (!files.length) return NextResponse.json({ error: "请上传至少一个视频或图片文件" }, { status: 400 });

  const dir = materialsDir(id);
  await mkdir(dir, { recursive: true });

  const saved: { name: string; mediaType: string; url: string }[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `文件 ${file.name} 超过 80MB 大小限制` }, { status: 400 });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: `文件 ${file.name} 类型不支持，仅允许 mp4/webm/mov 视频或 jpg/png/webp 图片` }, { status: 400 });
    }
    const rawName = file.name.replace(/[/\\]/g, ""); // 去路径分隔符
    const mediaType = classifyMaterial(rawName);
    if (!mediaType) return NextResponse.json({ error: `文件 ${file.name} 扩展名不支持` }, { status: 400 });

    const ext = rawName.split(".").pop()!.toLowerCase();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await writeFile(join(dir, fileName), Buffer.from(await file.arrayBuffer()));
    saved.push({ name: fileName, mediaType, url: `/api/files/${id}/materials/${fileName}` });
  }
  return NextResponse.json({ materials: saved });
}
