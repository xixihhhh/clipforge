import { readFile } from "fs/promises";
import { join, sep } from "path";
import { getDataDir } from "@/lib/paths";

/**
 * 把本地 `/api/files/{相对路径}` 解析成 uploads 目录下的安全绝对路径。
 *
 * 安全要点：`m[1]` 来自请求体、攻击者可控。若含 `../` 会让 join 解析到 uploads 之外，
 * 读到任意文件（再被 toRemoteUsableImage 转 base64 外泄给攻击者配置的远程 provider）。
 * 这里 join 已归一化 `..`，再校验结果仍在 uploads 内——逃逸则返回 null（拒绝）。
 *
 * 纯函数、便于单测（无需触盘）。返回安全绝对路径，或 null（非 /api/files 路径 / 路径穿越）。
 */
export function resolveUploadFilePath(ref: string): string | null {
  const m = ref.match(/\/api\/files\/(.+)/);
  if (!m) return null;
  const uploadsRoot = join(getDataDir(), "uploads");
  const filePath = join(uploadsRoot, m[1]);
  if (filePath !== uploadsRoot && !filePath.startsWith(uploadsRoot + sep)) return null; // 路径穿越，拒绝
  return filePath;
}

/**
 * 本地 `/api/files` 路径转 base64 data URI（远程 provider 无法访问 localhost，须传 data URI 或公网 URL）。
 * http(s)/data URI 原样透传；非本地或路径穿越则原样返回 ref（不读盘）。
 */
export async function toRemoteUsableImage(ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  if (ref.startsWith("http") || ref.startsWith("data:")) return ref;
  const filePath = resolveUploadFilePath(ref);
  if (!filePath) return ref; // 非 /api/files 路径或路径穿越——不读盘，原样返回
  try {
    const buf = await readFile(filePath);
    const ext = filePath.split(".").pop()?.toLowerCase() || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return ref;
  }
}
