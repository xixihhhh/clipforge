import { requireProjectAccess } from "@/lib/saas/authorization";
import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { writeFile, mkdir, readdir } from "fs/promises";
import { join } from "path";
import { classifyMaterial } from "@/lib/providers/local-stock";
import { apiError } from "@/lib/api-error";

const SAFE_ID = /^[a-zA-Z0-9\-]+$/;
/** Single-file size limit: 80 MB (videos can be large; matches the asset-download limit) */
const MAX_FILE_SIZE = 80 * 1024 * 1024;
/** Allowlist of accepted video/image MIME types */
const ALLOWED_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime", // .mov
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Project-local material pool directory: uploads/{id}/materials/ */
function materialsDir(projectId: string) {
  return join(getDataDir(), "uploads", projectId, "materials");
}

/** GET /api/project/[id]/materials —— list the project's local material pool (built-in B-roll) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);
  let names: string[] = [];
  try {
    names = await readdir(materialsDir(id));
  } catch {
    /* no directory = empty pool */
  }
  const materials = names
    .map((name) => ({ name, mediaType: classifyMaterial(name) }))
    .filter((m) => m.mediaType !== null)
    .map((m) => ({ name: m.name, mediaType: m.mediaType, url: `/api/files/${id}/materials/${m.name}` }));
  return NextResponse.json({ materials });
}

/**
 * POST /api/project/[id]/materials —— upload user-owned video/image B-roll to the local material pool.
 * Use self-shot or personally owned footage for scene visuals: uploaded to the project pool, no network or API key needed.
 * multipart: files=<File[]>. Written to uploads/{id}/materials/ with renamed filenames (original names not used to avoid security issues).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: accessProjectId } = await params;
  const projectAccess = await requireProjectAccess(accessProjectId);
  if (!projectAccess.ok) return projectAccess.response;
  const { id } = await params;
  if (!id || !SAFE_ID.test(id)) return apiError(req, "无效的项目ID", "Invalid project ID", 400);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError(req, "无效的表单数据，请检查上传的文件", "Invalid form data, please check the uploaded files", 400);
  }
  const files = formData.getAll("files") as File[];
  if (!files.length) return apiError(req, "请上传至少一个视频或图片文件", "Please upload at least one video or image file", 400);

  const dir = materialsDir(id);
  await mkdir(dir, { recursive: true });

  const saved: { name: string; mediaType: string; url: string }[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      return apiError(req, `文件 ${file.name} 超过 80MB 大小限制`, `File ${file.name} exceeds the 80MB size limit`, 400);
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return apiError(req, `文件 ${file.name} 类型不支持，仅允许 mp4/webm/mov 视频或 jpg/png/webp 图片`, `File ${file.name} has an unsupported type; only mp4/webm/mov videos or jpg/png/webp images are allowed`, 400);
    }
    const rawName = file.name.replace(/[/\\]/g, ""); // strip path separators
    const mediaType = classifyMaterial(rawName);
    if (!mediaType) return apiError(req, `文件 ${file.name} 扩展名不支持`, `File ${file.name} has an unsupported extension`, 400);

    const ext = rawName.split(".").pop()!.toLowerCase();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await writeFile(join(dir, fileName), Buffer.from(await file.arrayBuffer()));
    saved.push({ name: fileName, mediaType, url: `/api/files/${id}/materials/${fileName}` });
  }
  return NextResponse.json({ materials: saved });
}
