import { NextRequest, NextResponse } from "next/server";
import { getDataDir } from "@/lib/paths";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { apiError } from "@/lib/api-error";
import { isSaasMode } from "@/lib/saas/runtime";
import { requireApiIdentity } from "@/lib/saas/authorization";

/** Allowlist of permitted upload MIME types */
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/bmp",
]);

/** Allowlist of permitted file extensions */
const ALLOWED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "svg", "bmp",
]);

/** Maximum size per file (20 MB) */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// Upload product-library images: not tied to a project; written to disk at data/uploads/products/<productId>/ by productId.
// The returned /api/files/products/... path is served by the existing static-file route and stays valid across page reloads and navigation (replacing short-lived blob: URLs).
export async function POST(req: NextRequest) {
  if (isSaasMode()) {
    const access = await requireApiIdentity();
    if (!access.ok) return access.response;
    return apiError(
      req,
      "SaaS 第一阶段尚未迁移共享商品库，请在项目内上传素材",
      "The shared product library is not available in SaaS phase one; upload media inside a project",
      501,
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError(req, "无效的表单数据，请检查上传的文件", "Invalid form data, please check the uploaded files");
  }
  const files = formData.getAll("files") as File[];
  const productId = formData.get("productId") as string;

  if (!files.length) {
    return apiError(req, "请上传至少一张图片", "Please upload at least one image");
  }

  if (!productId) {
    return apiError(req, "缺少商品ID", "Missing product ID");
  }

  // Validate productId to prevent path traversal (only UUID format or alphanumeric hyphens allowed)
  if (!/^[a-zA-Z0-9\-]+$/.test(productId)) {
    return apiError(req, "无效的商品ID格式", "Invalid product ID format");
  }

  // Product images are stored under uploads/products/<productId>/, isolated from the per-project upload directories
  const uploadDir = join(getDataDir(), "uploads", "products", productId);
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

    // Extract and validate the extension from the original filename (prevent path traversal)
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

    // Generate a unique filename (do not use the original filename to avoid security issues)
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = join(uploadDir, fileName);

    await writeFile(filePath, buffer);
    savedPaths.push(`/api/files/products/${productId}/${fileName}`);
  }

  return NextResponse.json({ paths: savedPaths });
}
