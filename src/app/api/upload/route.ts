import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { apiError } from "@/lib/api-error";
import { requireProjectAccess } from "@/lib/saas/authorization";

/** Whitelist of allowed upload MIME types */
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/bmp",
]);

/** Whitelist of allowed file extensions */
const ALLOWED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "svg", "bmp",
]);

/** Maximum size per file (20 MB) */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// Upload product images
export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError(req, "无效的表单数据，请检查上传的文件", "Invalid form data, please check the uploaded files");
  }
  const files = formData.getAll("files") as File[];
  const projectId = formData.get("projectId") as string;

  if (!files.length) {
    return apiError(req, "请上传至少一张图片", "Please upload at least one image");
  }

  if (!projectId) {
    return apiError(req, "缺少项目ID", "Missing project ID");
  }

  // Validate projectId to prevent path traversal (only UUID format or alphanumeric-hyphen allowed)
  if (!/^[a-zA-Z0-9\-]+$/.test(projectId)) {
    return apiError(req, "无效的项目ID格式", "Invalid project ID format");
  }

  const access = await requireProjectAccess(projectId);
  if (!access.ok) return access.response;

  // Create upload directory
  const uploadDir = join(getDataDir(), "uploads", projectId);
  await mkdir(uploadDir, { recursive: true });

  const savedPaths: string[] = [];

  for (const file of files) {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return apiError(
        req,
        `文件 ${file.name} 超过 20MB 大小限制`,
        `File ${file.name} exceeds the 20MB size limit`
      );
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return apiError(
        req,
        `文件 ${file.name} 类型不支持，仅允许图片文件`,
        `File ${file.name} type is not supported; only image files are allowed`
      );
    }

    // Extract and validate file extension from the original filename (prevent path traversal)
    const rawName = file.name.replace(/[/\\]/g, ""); // strip path separators
    const ext = rawName.split(".").pop()?.toLowerCase() || "jpg";
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return apiError(
        req,
        `文件 ${file.name} 扩展名不支持`,
        `File ${file.name} extension is not supported`
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate a unique filename (avoid using the original name for security)
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = join(uploadDir, fileName);

    await writeFile(filePath, buffer);
    savedPaths.push(`/api/files/${projectId}/${fileName}`);
  }

  return NextResponse.json({ paths: savedPaths });
}
