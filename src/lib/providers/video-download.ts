import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getUploadsDir } from "@/lib/paths";
import { validateOrDelete } from "@/lib/media-validate";
import { MAX_DOWNLOAD_BYTES } from "./stock-types";

/** Authenticated content becomes a local URL; credentials and base64 never enter task rows. */
export async function downloadProviderVideo(url: string, headers: Record<string, string>): Promise<string> {
  const directory = join(getUploadsDir(), "provider-videos");
  const name = `${createHash("sha256").update(url).update(JSON.stringify(headers)).digest("hex")}.mp4`;
  const target = join(directory, name);
  const localUrl = `/api/files/provider-videos/${name}`;
  if (existsSync(target)) return localUrl;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000), redirect: "error" });
  if (!response.ok) throw new Error(`视频下载失败: ${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_DOWNLOAD_BYTES || !response.body) throw new Error("视频下载为空或超过大小限制");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOWNLOAD_BYTES) throw new Error("视频超过下载大小限制");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  await mkdir(directory, { recursive: true });
  const temporary = `${target}.${randomUUID()}.mp4`;
  try {
    await writeFile(temporary, Buffer.concat(chunks), { flag: "wx" });
    if (!(await validateOrDelete(temporary, "video"))) throw new Error("视频下载内容无效");
    // Another poll may have completed the same download while this one was validating.
    if (!existsSync(target)) await rename(temporary, target);
    return localUrl;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
