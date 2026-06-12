import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { createProvider } from "@/lib/providers";

/**
 * 把本地 /api/files/{...} 路径转 base64 data URI，供远程 provider 做 image-to-image。
 * 远程平台无法访问 localhost，必须传 data URI 或公网 URL。
 */
async function toRemoteUsableImage(ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  if (ref.startsWith("http") || ref.startsWith("data:")) return ref;
  const m = ref.match(/\/api\/files\/(.+)/);
  if (!m) return ref;
  try {
    const filePath = join(process.cwd(), "data", "uploads", m[1]);
    const buf = await readFile(filePath);
    const ext = filePath.split(".").pop()?.toLowerCase() || "png";
    const mime =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return ref;
  }
}

// AI 生图
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { provider: providerName, model, prompt, imageUrl, mode, apiKey, baseUrl, options } = body;

  if (!providerName || !model || !prompt) {
    return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: "缺少 API Key，请先在设置中配置对应平台" }, { status: 400 });
  }

  try {
    const provider = createProvider({ name: providerName, apiKey, baseUrl });

    // image-to-image 时把本地参考图转为 data URI
    const referenceImageUrl = await toRemoteUsableImage(imageUrl);

    const result = await provider.generateImage({
      modelId: model,
      mode: mode || "text-to-image",
      prompt,
      referenceImageUrl,
      ...options,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("生图失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生图失败" },
      { status: 500 }
    );
  }
}
