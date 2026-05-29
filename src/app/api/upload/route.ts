import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

/** 允许上传的文件类型白名单 */
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/bmp",
]);

/** 允许的文件扩展名白名单 */
const ALLOWED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "svg", "bmp",
]);

/** 单文件最大大小（20MB） */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

// 上传商品图片
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const projectId = formData.get("projectId") as string;

    if (!files.length) {
    return NextResponse.json({ error: "请上传至少一张图片" }, { status: 400 });
  }

  if (!projectId) {
    return NextResponse.json({ error: "缺少项目ID" }, { status: 400 });
  }

  // 校验 projectId 防止路径穿越（只允许 UUID 格式或字母数字连字符）
  if (!/^[a-zA-Z0-9\-]+$/.test(projectId)) {
    return NextResponse.json({ error: "无效的项目ID格式" }, { status: 400 });
  }

  // 创建上传目录
  const uploadDir = join(process.cwd(), "data", "uploads", projectId);
  await mkdir(uploadDir, { recursive: true });

  const savedPaths: string[] = [];

  for (const file of files) {
    // 校验文件大小
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `文件 ${file.name} 超过 20MB 大小限制` },
        { status: 400 }
      );
    }

    // 校验 MIME 类型
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `文件 ${file.name} 类型不支持，仅允许图片文件` },
        { status: 400 }
      );
    }

    // 从原始文件名提取扩展名并校验（防止路径穿越）
    const rawName = file.name.replace(/[/\\]/g, ""); // 移除路径分隔符
    const ext = rawName.split(".").pop()?.toLowerCase() || "jpg";
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `文件 ${file.name} 扩展名不支持` },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 生成唯一文件名（不使用原始文件名，避免安全问题）
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = join(uploadDir, fileName);

    await writeFile(filePath, buffer);
    savedPaths.push(`/api/files/${projectId}/${fileName}`);
  }

    return NextResponse.json({ paths: savedPaths });
  } catch (error) {
    console.error("上传失败:", error);
    return NextResponse.json(
      { error: "上传失败，请稍后重试" },
      { status: 500 }
    );
  }
}
export const dynamic = 'force-static';
